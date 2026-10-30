import {
  bizTable,
  mutatedMigration,
  mutatedTexts,
  rewriteSent,
  runsOnOwnConnection,
} from "@pg-outbox/conformance";
import type {
  Built,
  ErrorClass,
  Kind,
  Mutation,
  StatementRecord,
  Subject,
  SuiteOutbox,
  Tx,
} from "@pg-outbox/conformance";
import type { Now, Param, RawRow } from "@pg-outbox/core";
import { failureOfSqlError } from "@pg-txmode/effect";
import type { LayerError, TxClient } from "@pg-txmode/effect";
import { Cause, Effect, Exit } from "effect";
import type { Context, ManagedRuntime } from "effect";
import { SqlClient } from "effect/sql";
import { isSqlError } from "effect/sql/SqlError";
import type { SqlError } from "effect/sql/SqlError";

import { make, OutboxClock, transaction } from "../src/index.ts";
import type { ClaimLost, EffectOutbox, InTransaction } from "../src/index.ts";

/** What a conformance body threw: carried through the transaction as a typed failure and handed back unchanged. */
class BodyFailure {
  readonly original: unknown;

  constructor(original: unknown) {
    this.original = original;
  }
}

/** What a falsifier reads of a failure: a driver error with its SQLSTATE in `code`, as `pg` gives it. */
const asRejection = (error: unknown): Error => {
  if (error instanceof BodyFailure) {
    return error.original instanceof Error
      ? error.original
      : new Error(String(error.original));
  }

  if (isSqlError(error)) {
    return Object.assign(new Error(error.message), {
      code: failureOfSqlError(error)?.sqlState,
    });
  }

  return error instanceof Error ? error : new Error(String(error));
};

const settled = <A, E>(exit: Exit.Exit<A, E>): Promise<A> =>
  Exit.isSuccess(exit)
    ? Promise.resolve(exit.value)
    : Promise.reject(asRejection(Cause.squash(exit.cause)));

/** The services of a running transaction: what the falsifier's `Tx` runs its statements and the outbox's calls in. */
type InTx = InTransaction | SqlClient.SqlClient;

/** The runtime of one file: the layers of one connection mode, built once. */
export type Runtime = ManagedRuntime.ManagedRuntime<
  SqlClient.SqlClient | TxClient,
  LayerError
>;

/** The time of one call, as the reference the adapter reads it from. */
const at = <A, E, R>(effect: Effect.Effect<A, E, R>, now: Now) =>
  Effect.provideService(effect, OutboxClock, Effect.succeed(now));

const delivered = { _tag: "Delivered" } as const;
const buried = { _tag: "Buried" } as const;
const holding = { _tag: "Holding" } as const;
const lost = { _tag: "ClaimLost" } as const;

/** The adapter's `ClaimLost` error as the core's value (the falsifiers speak the core's results); every other failure stays. */
const claimLost = <A, R>(effect: Effect.Effect<A, ClaimLost | SqlError, R>) =>
  Effect.catchTag(effect, "ClaimLost", () => Effect.succeed(lost));

/**
 * The conformance subject of the Effect adapter. The falsifiers speak promises; every call here runs an Effect of the
 * adapter on a shared `ManagedRuntime` (one pool for the whole file), with the clock of the call provided as `OutboxClock`.
 * The `SqlClient` handed to the adapter is a wrapper that records each statement, per connection, and applies a control's
 * rewrite to the statement the adapter built (found by its text): the adapter itself knows nothing of controls.
 */
export const effectSubject = (
  outbox: SuiteOutbox,
  runtime: Runtime,
  mutation?: Mutation
): Built => {
  const log: StatementRecord[] = [];
  const rewrite = rewriteSent(outbox, mutation);
  const labels = new WeakMap<object, string>();
  let connections = 0;

  const fresh = (): string => {
    connections += 1;

    return `c${connections}`;
  };

  /** One label per connection: a transaction's statements share the label of its connection, and its first one logs `BEGIN`. */
  const labelOf = (connection: object | undefined): string => {
    if (connection === undefined) {
      return fresh();
    }

    const known = labels.get(connection);

    if (known !== undefined) {
      return known;
    }

    const label = fresh();

    labels.set(connection, label);
    log.push({ session: label, sql: "BEGIN" });

    return label;
  };

  /** The client with every statement recorded and rewritten; everything else is the client's own. */
  const spied = (sql: SqlClient.SqlClient): SqlClient.SqlClient =>
    new Proxy(sql, {
      get: (target, property, receiver): unknown =>
        property === "unsafe"
          ? <A extends object>(text: string, params?: readonly Param[]) =>
              Effect.flatMap(
                Effect.serviceOption(target.transactionService),
                (held) => {
                  const sent = rewrite(text);

                  log.push({
                    session: labelOf(
                      held._tag === "Some" ? held.value[0] : undefined
                    ),
                    sql: sent,
                  });

                  return target.unsafe<A>(sent, params);
                }
              )
          : Reflect.get(target, property, receiver),
    });

  const ready = runtime.runPromise(
    Effect.gen(function* () {
      const sql = spied(yield* SqlClient.SqlClient);

      return {
        adapter: yield* make({ outbox }).pipe(
          Effect.provideService(SqlClient.SqlClient, sql)
        ),
        sql,
      };
    })
  );

  const withReady = <A, E, R>(
    use: (built: {
      readonly adapter: EffectOutbox<Kind, ErrorClass>;
      readonly sql: SqlClient.SqlClient;
    }) => Effect.Effect<A, E, R>
  ) =>
    Effect.flatMap(
      Effect.promise(() => ready),
      use
    );

  /** A call outside any transaction of the caller's. */
  const alone = <A, E>(
    now: Now,
    use: (adapter: EffectOutbox<Kind, ErrorClass>) => Effect.Effect<A, E>
  ): Promise<A> =>
    runtime
      .runPromiseExit(
        at(
          withReady(({ adapter }) => use(adapter)),
          now
        )
      )
      .then(settled);

  const contexts = new WeakMap<Tx, Context.Context<InTx>>();

  /** A call inside the transaction that opened `tx`: its services (the proof, the connection) are the call's. */
  const within = <A, E>(
    tx: Tx,
    now: Now,
    use: (
      adapter: EffectOutbox<Kind, ErrorClass>
    ) => Effect.Effect<A, E, InTransaction>
  ): Promise<A> => {
    const context = contexts.get(tx);

    return context === undefined
      ? Promise.reject(
          new Error("this transaction was not opened by this subject")
        )
      : runtime
          .runPromiseExit(
            Effect.provideContext(
              at(
                withReady(({ adapter }) => use(adapter)),
                now
              ),
              context
            )
          )
          .then(settled);
  };

  const migration = mutatedMigration(outbox, mutation);

  const subject: Subject = {
    ack: ({ now, ...args }, on) =>
      on === undefined || runsOnOwnConnection(mutation, "ack")
        ? alone(now, (adapter) =>
            claimLost(Effect.as(adapter.ack(args), delivered))
          )
        : within(on, now, (adapter) =>
            claimLost(Effect.as(adapter.ack(args), delivered))
          ),
    bury: ({ now, ...args }, on) =>
      on === undefined
        ? alone(now, (adapter) =>
            claimLost(Effect.as(adapter.bury(args), buried))
          )
        : within(on, now, (adapter) =>
            claimLost(Effect.as(adapter.bury(args), buried))
          ),
    claimBatch: ({ now, ...args }) =>
      alone(now, (adapter) => adapter.claimBatch(args)),
    claimById: ({ now, ...args }) =>
      alone(now, (adapter) => adapter.claimById(args)),
    cleanup: ({ now, ...args }) =>
      alone(now, (adapter) => adapter.cleanup(args)),
    counts: ({ now }) => alone(now, (adapter) => adapter.counts),
    enqueue: (tx, { now, ...args }) =>
      runsOnOwnConnection(mutation, "enqueue")
        ? runtime
            .runPromiseExit(
              at(
                withReady(({ adapter }) => transaction(adapter.enqueue(args))),
                now
              )
            )
            .then(settled)
        : within(tx, now, (adapter) => adapter.enqueue(args)),
    holdClaim: (tx, args) =>
      within(tx, { source: "database" }, (adapter) =>
        claimLost(Effect.as(adapter.holdClaim(args), holding))
      ),
    markQueued: ({ now, ...args }) =>
      alone(now, (adapter) => adapter.markQueued(args)),
    migrate: () =>
      runtime
        .runPromiseExit(
          withReady(({ sql }) =>
            Effect.gen(function* () {
              yield* sql.unsafe(`DROP TABLE IF EXISTS biz, ${outbox.table}`);
              yield* sql.unsafe(bizTable);

              for (const statement of migration) {
                yield* sql.unsafe(statement);
              }
            })
          )
        )
        .then(settled),
    open: ({ now, ...args }) => alone(now, (adapter) => adapter.open(args)),
    outbox,
    release: ({ now, ...args }, on) =>
      on === undefined
        ? alone(now, (adapter) => claimLost(adapter.release(args)))
        : within(on, now, (adapter) => claimLost(adapter.release(args))),
    sql: (text, values) =>
      runtime
        .runPromiseExit(
          withReady(({ sql }) => sql.unsafe<RawRow>(text, values))
        )
        .then(settled),
    stale: ({ now, ...args }) => alone(now, (adapter) => adapter.stale(args)),
    transaction: (body) =>
      runtime
        .runPromiseExit(
          withReady(({ sql }) =>
            transaction(
              Effect.gen(function* () {
                const context = yield* Effect.context<InTx>();

                const tx: Tx = {
                  query: (text, values) =>
                    runtime
                      .runPromiseExit(
                        Effect.provideContext(
                          sql.unsafe<RawRow>(text, values),
                          context
                        )
                      )
                      .then(settled),
                };

                contexts.set(tx, context);

                return yield* Effect.tryPromise({
                  catch: (error) => new BodyFailure(error),
                  try: () => body(tx),
                });
              })
            )
          )
        )
        .then(settled),
  };

  return { log, migration, subject, texts: mutatedTexts(outbox, mutation) };
};

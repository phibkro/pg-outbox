import { operationIds, refusalOf } from "@pg-outbox/core";
import type {
  WithoutClock,
  Buried,
  ClaimResult,
  Claimed,
  Counts,
  EnqueueResult,
  Now,
  OpenRow,
  OperationId,
  Outbox,
  OutboxId,
  RawRow,
  UnsupportedOperationError,
  Released,
  Statement,
} from "@pg-outbox/core";
import { TxClient } from "@pg-txmode/effect";
import { Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";

import { OutboxClock } from "./clock.ts";
import {
  ClaimLost,
  NotInTransactionDefect,
  OperationRefusedError,
  StandaloneInTransactionDefect,
} from "./errors.ts";
import type { InTransaction } from "./transaction.ts";

export interface OutboxOptions<Kind extends string, ErrorClass extends string> {
  /** The declaration: the table, the closed sets and the retry policy. */
  readonly outbox: Outbox<Kind, ErrorClass>;
  /**
   * The operations this process uses; every operation by default. An operation whose catalogue cell is not `works` for the
   * `TxClient`'s mode is refused when the outbox is built (`OperationRefusedError`), unless `allowUnverified`. A process that only
   * enqueues on Hyperdrive says `["enqueue"]`.
   */
  readonly operations?: readonly OperationId[];
  /** Accept an operation that the catalogue marks `unverified` for the mode. Off by default. */
  readonly allowUnverified?: boolean;
}

/**
 * The protocol as Effects, over the `SqlClient` and the `TxClient` of one connection mode. Contract:
 *
 * - **A transaction is in the type.** `enqueue` and `holdClaim` require `InTransaction`, which only `transaction` provides: a
 *   program that enqueues outside a transaction does not run. The claims, receipt, sweep, reports and cleanup refuse to run
 *   inside one (`StandaloneInTransactionDefect`: a claim in an open transaction is invisible to every other claimer until it
 *   ends). `ack`, `release` and `bury` join the ambient transaction when there is one (one conditional write that commits or
 *   rolls back with it) and commit alone otherwise.
 * - **Claim lost is an error, not an empty result.** `ack`, `release`, `bury` and `holdClaim` fail with `ClaimLost` when the
 *   token is not current. Inside a transaction that rolls it back. Recover it by tag to treat it as a value.
 * - **Errors.** `SqlError` is the driver's, unchanged; nothing is retried here (the transaction's own retry on 40001 and
 *   40P01 is `transaction`'s, and runs the whole body again). An argument the protocol cannot send and a row that is not the
 *   promised shape are defects (`InvalidArgumentError`, `ProtocolError` of the core), as are the two guards above.
 * - **Time** comes from the `OutboxClock` reference: the database's clock by default, `effectClock` for Effect's `Clock`.
 * - **Nothing runs when it is built** except the mode check; every method does nothing until run; interruption is the
 *   driver's (`SqlClient`'s statements are interruptible, a transaction rolls back).
 */
export interface EffectOutbox<Kind extends string, ErrorClass extends string> {
  readonly enqueue: (
    args: WithoutClock<Kind, ErrorClass, "enqueue">
  ) => Effect.Effect<EnqueueResult, SqlError, InTransaction>;
  readonly claimById: (
    args: WithoutClock<Kind, ErrorClass, "claimById">
  ) => Effect.Effect<ClaimResult<Kind>, SqlError>;
  readonly claimBatch: (
    args: WithoutClock<Kind, ErrorClass, "claimBatch">
  ) => Effect.Effect<readonly Claimed<Kind>[], SqlError>;
  readonly ack: (
    args: WithoutClock<Kind, ErrorClass, "ack">
  ) => Effect.Effect<void, ClaimLost | SqlError>;
  readonly release: (
    args: WithoutClock<Kind, ErrorClass, "release">
  ) => Effect.Effect<Buried | Released, ClaimLost | SqlError>;
  readonly bury: (
    args: WithoutClock<Kind, ErrorClass, "bury">
  ) => Effect.Effect<void, ClaimLost | SqlError>;
  readonly holdClaim: (
    args: WithoutClock<Kind, ErrorClass, "holdClaim">
  ) => Effect.Effect<void, ClaimLost | SqlError, InTransaction>;
  readonly markQueued: (
    args: WithoutClock<Kind, ErrorClass, "markQueued">
  ) => Effect.Effect<number, SqlError>;
  readonly stale: (
    args: WithoutClock<Kind, ErrorClass, "stale">
  ) => Effect.Effect<readonly OutboxId[], SqlError>;
  readonly counts: Effect.Effect<Counts, SqlError>;
  readonly open: (
    args: WithoutClock<Kind, ErrorClass, "open">
  ) => Effect.Effect<readonly OpenRow<Kind, ErrorClass>[], SqlError>;
  readonly cleanup: (
    args: WithoutClock<Kind, ErrorClass, "cleanup">
  ) => Effect.Effect<number, SqlError>;
}

type Settle = "ack" | "bury" | "holdClaim" | "release";

/** The error of a settle statement that matched no row. */
const lost = (operation: Settle, id: string): ClaimLost =>
  new ClaimLost({
    id,
    message: `${operation} of ${id}: the claim token is not the row's current one; nothing was written`,
    operation,
  });

const refusal = (error: UnsupportedOperationError): OperationRefusedError =>
  new OperationRefusedError({
    message: error.message,
    operation: error.operation,
    rows: [...error.rows],
    support: error.support === "no" ? "no" : "unverified",
  });

/**
 * Builds the outbox over the `SqlClient` and `TxClient` in the context. Fails with `OperationRefusedError` when the mode
 * cannot honour an operation the process uses. Provide it as a service of your own (a `Context.Service` class whose layer is
 * `Layer.effect(Tag, make({ outbox }))`): the service type carries your `Kind` and `ErrorClass`.
 */
export const make = <
  const Kind extends string,
  const ErrorClass extends string,
>(
  options: OutboxOptions<Kind, ErrorClass>
): Effect.Effect<
  EffectOutbox<Kind, ErrorClass>,
  OperationRefusedError,
  SqlClient.SqlClient | TxClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const client = yield* TxClient;
    const { outbox } = options;

    for (const id of options.operations ?? operationIds) {
      const refused = refusalOf(client.mode, id, {
        allowUnverified: options.allowUnverified === true,
      });

      if (refused !== undefined) {
        return yield* refusal(refused);
      }
    }

    const isOpen = Effect.map(
      Effect.serviceOption(sql.transactionService),
      Option.isSome
    );

    const requireOpen = (operation: string) =>
      Effect.flatMap(isOpen, (open) =>
        open
          ? Effect.void
          : Effect.die(
              new NotInTransactionDefect({
                message: `${operation} ran with the InTransaction proof but no transaction of this client is open`,
                operation,
              })
            )
      );

    const requireClosed = (operation: string) =>
      Effect.flatMap(isOpen, (open) =>
        open
          ? Effect.die(
              new StandaloneInTransactionDefect({
                message: `${operation} ran inside a transaction: its claim would be invisible to every other claimer until the transaction ends`,
                operation,
              })
            )
          : Effect.void
      );

    const at: Effect.Effect<Now> = Effect.flatten(OutboxClock);

    const interpret = <A>(
      statement: Statement<A>
    ): Effect.Effect<A, SqlError> =>
      Effect.flatMap(
        sql.unsafe<RawRow>(statement.text, statement.values),
        (rows) => {
          const step = statement.decode(rows);

          return step.done ? Effect.succeed(step.value) : interpret(step.next);
        }
      );

    const enqueue = Effect.fn("Outbox.enqueue")(function* (
      args: WithoutClock<Kind, ErrorClass, "enqueue">
    ) {
      yield* requireOpen("enqueue");

      return yield* interpret(outbox.enqueue({ ...args, now: yield* at }));
    });

    const claimById = Effect.fn("Outbox.claimById")(function* (
      args: WithoutClock<Kind, ErrorClass, "claimById">
    ) {
      yield* requireClosed("claimById");

      return yield* interpret(outbox.claimById({ ...args, now: yield* at }));
    });

    const claimBatch = Effect.fn("Outbox.claimBatch")(function* (
      args: WithoutClock<Kind, ErrorClass, "claimBatch">
    ) {
      yield* requireClosed("claimBatch");

      return yield* interpret(outbox.claimBatch({ ...args, now: yield* at }));
    });

    const ack = Effect.fn("Outbox.ack")(function* (
      args: WithoutClock<Kind, ErrorClass, "ack">
    ) {
      const result = yield* interpret(outbox.ack({ ...args, now: yield* at }));

      return result._tag === "ClaimLost"
        ? yield* lost("ack", args.id)
        : undefined;
    });

    const release = Effect.fn("Outbox.release")(function* (
      args: WithoutClock<Kind, ErrorClass, "release">
    ) {
      const result = yield* interpret(
        outbox.release({ ...args, now: yield* at })
      );

      return result._tag === "ClaimLost"
        ? yield* lost("release", args.id)
        : result;
    });

    const bury = Effect.fn("Outbox.bury")(function* (
      args: WithoutClock<Kind, ErrorClass, "bury">
    ) {
      const result = yield* interpret(outbox.bury({ ...args, now: yield* at }));

      return result._tag === "ClaimLost"
        ? yield* lost("bury", args.id)
        : undefined;
    });

    const holdClaim = Effect.fn("Outbox.holdClaim")(function* (
      args: WithoutClock<Kind, ErrorClass, "holdClaim">
    ) {
      yield* requireOpen("holdClaim");

      const result = yield* interpret(outbox.holdClaim(args));

      return result._tag === "ClaimLost"
        ? yield* lost("holdClaim", args.id)
        : undefined;
    });

    const markQueued = Effect.fn("Outbox.markQueued")(function* (
      args: WithoutClock<Kind, ErrorClass, "markQueued">
    ) {
      yield* requireClosed("markQueued");

      return yield* interpret(outbox.markQueued({ ...args, now: yield* at }));
    });

    const stale = Effect.fn("Outbox.stale")(function* (
      args: WithoutClock<Kind, ErrorClass, "stale">
    ) {
      yield* requireClosed("stale");

      return yield* interpret(outbox.stale({ ...args, now: yield* at }));
    });

    const counts = Effect.fn("Outbox.counts")(function* () {
      yield* requireClosed("counts");

      return yield* interpret(outbox.counts({ now: yield* at }));
    });

    const open = Effect.fn("Outbox.open")(function* (
      args: WithoutClock<Kind, ErrorClass, "open">
    ) {
      yield* requireClosed("open");

      return yield* interpret(outbox.open({ ...args, now: yield* at }));
    });

    const cleanup = Effect.fn("Outbox.cleanup")(function* (
      args: WithoutClock<Kind, ErrorClass, "cleanup">
    ) {
      yield* requireClosed("cleanup");

      return yield* interpret(outbox.cleanup({ ...args, now: yield* at }));
    });

    return {
      ack,
      bury,
      claimBatch,
      claimById,
      cleanup,
      counts: counts(),
      enqueue,
      holdClaim,
      markQueued,
      open,
      release,
      stale,
    };
  });

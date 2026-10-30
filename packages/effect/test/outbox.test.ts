import { assert, layer } from "@effect/vitest";
import { declareOutbox } from "@pg-outbox/core";
import type { ClaimResult, Claimed, EnqueueResult } from "@pg-outbox/core";
import type { TxClient } from "@pg-txmode/effect";
import { hyperdriveLayer } from "@pg-txmode/effect";
import { Cause, Effect, Exit, Layer, Redacted, Schema } from "effect";
import { SqlClient } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";
import { TestClock } from "effect/testing";
import { expectTypeOf } from "vite-plus/test";

import type { ClaimLost } from "../src/index.ts";
import {
  effectClock,
  InTransaction,
  make,
  NotInTransactionDefect,
  OutboxClock,
  StandaloneInTransactionDefect,
  transaction,
} from "../src/index.ts";
import { fixture } from "./stack.ts";

const declaration = declareOutbox({
  errorClasses: ["rejected", "timeout"],
  kinds: ["Mail"],
  retry: { delaysMs: [1000], maxAttempts: 2 },
  table: "outbox",
});

/** A fresh table of the outbox and of the business, and the outbox built over the client. */
const tables = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql.unsafe("DROP TABLE IF EXISTS biz, outbox");
    yield* sql.unsafe("CREATE TABLE biz (n int NOT NULL)");

    for (const statement of declaration.migration) {
      yield* sql.unsafe(statement);
    }
  })
).pipe(Layer.provideMerge(fixture));

const counted = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const rows = yield* sql.unsafe<{ readonly n: number }>(
      `SELECT count(*)::int AS n FROM ${table}`
    );

    return rows[0]?.n;
  });

const mail = { kind: "Mail", payload: { to: "someone" } } as const;

/** An outbox over the client, with one message (id 1) enqueued in its own transaction. */
const withMessage = Effect.gen(function* () {
  const outbox = yield* make({ outbox: declaration });

  yield* transaction(outbox.enqueue(mail));

  return outbox;
});

type Mailbox = Effect.Success<typeof withMessage>;

const isClaimed = (claim: ClaimResult<"Mail">): claim is Claimed<"Mail"> =>
  claim._tag === "Claimed";

/** The claim of row 1, which `withMessage` enqueued: a claim that is not `Claimed` is a defect of the test. */
const claimOne = (outbox: Mailbox) =>
  Effect.filterOrElse(
    outbox.claimById({ id: "1", leaseMs: 1000 }),
    isClaimed,
    (claim) => Effect.die(`expected a claim of row 1, got ${claim._tag}`)
  );

type ClaimOfOne = Effect.Success<ReturnType<typeof claimOne>>;

/** Each call that settles or holds a claim, given a token that is no longer the row's. */
const lostCalls = [
  [
    "ack",
    (outbox: Mailbox, claim: ClaimOfOne) =>
      outbox.ack({ id: claim.id, token: claim.token }),
  ],
  [
    "bury",
    (outbox: Mailbox, claim: ClaimOfOne) =>
      outbox.bury({ errorClass: "rejected", id: claim.id, token: claim.token }),
  ],
  [
    "holdClaim",
    (outbox: Mailbox, claim: ClaimOfOne) =>
      outbox.holdClaim({ id: claim.id, token: claim.token }),
  ],
  [
    "release",
    (outbox: Mailbox, claim: ClaimOfOne) =>
      outbox.release({
        attempts: claim.attempts,
        errorClass: "timeout",
        id: claim.id,
        token: claim.token,
      }),
  ],
] as const;

/** Each operation that must not run inside a caller's transaction. */
const standaloneCalls = [
  [
    "claimBatch",
    (outbox: Mailbox) => outbox.claimBatch({ leaseMs: 1000, limit: 1 }),
  ],
  [
    "claimById",
    (outbox: Mailbox) => outbox.claimById({ id: "1", leaseMs: 1000 }),
  ],
  [
    "cleanup",
    (outbox: Mailbox) => outbox.cleanup({ limit: 1, olderThanMs: 0 }),
  ],
  ["counts", (outbox: Mailbox) => outbox.counts],
  ["markQueued", (outbox: Mailbox) => outbox.markQueued({ ids: ["1"] })],
  ["open", (outbox: Mailbox) => outbox.open({ limit: 1 })],
  ["stale", (outbox: Mailbox) => outbox.stale({ limit: 1, olderThanMs: 0 })],
] as const;

/** The calls above return different effects: as one type they can be passed on. */
const widen = (effect: Effect.Effect<unknown, SqlError>) => effect;

/** The operation named by the defect of that class that ended a run, or `undefined` when the run did not end in it. */
const defectOperation = (
  exit: Exit.Exit<unknown, unknown>,
  defect: typeof NotInTransactionDefect | typeof StandaloneInTransactionDefect
) => {
  const end = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

  return Schema.is(defect)(end) ? end.operation : undefined;
};

layer(tables)("the Effect adapter against PostgreSQL", (it) => {
  /** Every scenario starts on empty tables: they share one database, not their rows. */
  const scenario = <E>(
    name: string,
    body: () => Effect.Effect<void, E, SqlClient.SqlClient | TxClient>
  ) => {
    it.effect(name, () =>
      Effect.andThen(
        Effect.andThen(SqlClient.SqlClient, (sql) =>
          sql.unsafe("TRUNCATE biz, outbox RESTART IDENTITY")
        ),
        body()
      )
    );
  };

  scenario(
    "enqueue in `transaction` commits with the business write, and a failure rolls both back",
    () =>
      Effect.gen(function* () {
        const outbox = yield* make({ outbox: declaration });
        const sql = yield* SqlClient.SqlClient;

        const failed = yield* transaction(
          Effect.gen(function* () {
            yield* sql.unsafe("INSERT INTO biz (n) VALUES (1)");
            yield* outbox.enqueue(mail);

            return yield* Effect.fail("the command fails" as const);
          })
        ).pipe(Effect.flip);

        assert.strictEqual(failed, "the command fails");
        assert.strictEqual(yield* counted("biz"), 0);
        assert.strictEqual(yield* counted("outbox"), 0);

        const stored: EnqueueResult = yield* transaction(
          Effect.gen(function* () {
            yield* sql.unsafe("INSERT INTO biz (n) VALUES (2)");

            return yield* outbox.enqueue(mail);
          })
        );

        assert.strictEqual(stored._tag, "Enqueued");
        assert.strictEqual(yield* counted("biz"), 1);
        assert.strictEqual(yield* counted("outbox"), 1);
      })
  );

  scenario(
    "enqueue without the proof does not type-check as a runnable program, and `transaction` provides it",
    () =>
      Effect.gen(function* () {
        const outbox = yield* make({ outbox: declaration });
        const bare = outbox.enqueue(mail);

        expectTypeOf<
          Effect.Services<typeof bare>
        >().toEqualTypeOf<InTransaction>();

        const inside = transaction(bare);

        expectTypeOf<
          Effect.Services<typeof inside>
        >().toEqualTypeOf<TxClient>();
        expectTypeOf<Effect.Error<typeof bare>>().toEqualTypeOf<SqlError>();
        assert.strictEqual((yield* inside)._tag, "Enqueued");
      })
  );

  scenario(
    "a proof that outlived its transaction is a defect: enqueue checks that a transaction is open",
    () =>
      Effect.gen(function* () {
        const outbox = yield* make({ outbox: declaration });

        // The only way to hold an `InTransaction` is to read it inside `transaction`: leak it past the commit.
        const stale = yield* transaction(Effect.service(InTransaction));

        const exit = yield* Effect.exit(
          Effect.provideService(outbox.enqueue(mail), InTransaction, stale)
        );

        assert.isTrue(Exit.isFailure(exit));
        assert.isTrue(
          Exit.isFailure(exit) &&
            Schema.is(NotInTransactionDefect)(Cause.squash(exit.cause))
        );
        assert.strictEqual(yield* counted("outbox"), 0);
      })
  );

  scenario(
    "a claim inside a transaction is a defect, and one outside is fine",
    () =>
      Effect.gen(function* () {
        const outbox = yield* withMessage;

        const exit = yield* Effect.exit(
          transaction(outbox.claimById({ id: "1", leaseMs: 1000 }))
        );

        assert.isTrue(
          Exit.isFailure(exit) &&
            Schema.is(StandaloneInTransactionDefect)(Cause.squash(exit.cause))
        );

        const claim = yield* outbox.claimById({ id: "1", leaseMs: 1000 });

        assert.strictEqual(claim._tag, "Claimed");
      })
  );

  scenario(
    "a lost claim is an error that rolls the caller's transaction back, and a value when it is recovered by tag",
    () =>
      Effect.gen(function* () {
        const outbox = yield* withMessage;
        const sql = yield* SqlClient.SqlClient;

        const first = yield* outbox.claimById({ id: "1", leaseMs: 1000 });

        assert.strictEqual(first._tag, "Claimed");

        if (first._tag === "Claimed") {
          // The lease of 1 s has not lapsed: a second claim is told `Held`; `release` returns the row and a late ack is lost.
          yield* outbox.release({
            attempts: first.attempts,
            errorClass: "timeout",
            id: first.id,
            token: first.token,
          });

          const lost = yield* transaction(
            Effect.gen(function* () {
              yield* sql.unsafe("INSERT INTO biz (n) VALUES (9)");
              yield* outbox.ack({ id: first.id, token: first.token });
            })
          ).pipe(Effect.flip);

          assert.strictEqual(lost._tag, "ClaimLost");
          assert.strictEqual(yield* counted("biz"), 0);

          const recovered = yield* outbox
            .ack({ id: first.id, token: first.token })
            .pipe(
              Effect.as("acked"),
              Effect.catchTag("ClaimLost", () => Effect.succeed("lost"))
            );

          assert.strictEqual(recovered, "lost");
        }
      })
  );

  scenario(
    "with `effectClock` the TestClock moves leases: a lapsed lease is claimed again",
    () =>
      Effect.gen(function* () {
        const outbox = yield* withMessage;

        const first = yield* outbox.claimById({ id: "1", leaseMs: 1000 });

        assert.strictEqual(first._tag, "Claimed");

        yield* TestClock.adjust(500);
        assert.strictEqual(
          (yield* outbox.claimById({ id: "1", leaseMs: 1000 }))._tag,
          "Held"
        );

        yield* TestClock.adjust(600);

        const again = yield* outbox.claimById({ id: "1", leaseMs: 1000 });

        assert.strictEqual(again._tag, "Claimed");
        assert.strictEqual(again._tag === "Claimed" ? again.attempts : 0, 2);
      }).pipe(Effect.provideService(OutboxClock, effectClock))
  );

  scenario(
    "the default clock is the database's: with the TestClock at 1970, a row is created now, by PostgreSQL's time",
    () =>
      Effect.gen(function* () {
        const outbox = yield* make({ outbox: declaration });
        const sql = yield* SqlClient.SqlClient;

        yield* transaction(outbox.enqueue(mail));

        const rows = yield* sql.unsafe<{ readonly recent: boolean }>(
          "SELECT (created_at > now() - interval '1 minute') AS recent FROM outbox"
        );

        assert.deepStrictEqual(rows, [{ recent: true }]);
      })
  );

  scenario(
    "holdClaim, like enqueue, has the proof in its type, and a proof that outlived its transaction is a defect for it too",
    () =>
      Effect.gen(function* () {
        const outbox = yield* withMessage;
        const claim = yield* claimOne(outbox);
        const hold = outbox.holdClaim({ id: claim.id, token: claim.token });

        expectTypeOf<
          Effect.Services<typeof hold>
        >().toEqualTypeOf<InTransaction>();
        expectTypeOf<Effect.Error<typeof hold>>().toEqualTypeOf<
          ClaimLost | SqlError
        >();

        const stale = yield* transaction(Effect.service(InTransaction));

        const exit = yield* Effect.exit(
          Effect.provideService(hold, InTransaction, stale)
        );

        assert.strictEqual(
          defectOperation(exit, NotInTransactionDefect),
          "holdClaim"
        );
        assert.strictEqual(
          yield* transaction(hold.pipe(Effect.as("held"))),
          "held"
        );
      })
  );

  scenario(
    "every claim of a row that was lost rolls the caller's transaction back: ack, release, bury and holdClaim",
    () =>
      Effect.forEach(lostCalls, ([name, call]) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;

          yield* sql.unsafe("TRUNCATE biz, outbox RESTART IDENTITY");

          const outbox = yield* withMessage;
          const claim = yield* claimOne(outbox);

          // The claim is given back: its token is no longer the row's.
          yield* outbox.release({
            attempts: claim.attempts,
            errorClass: "timeout",
            id: claim.id,
            token: claim.token,
          });

          const lost = yield* transaction(
            Effect.gen(function* () {
              yield* sql.unsafe("INSERT INTO biz (n) VALUES (9)");
              yield* call(outbox, claim);
            })
          ).pipe(Effect.flip);

          assert.strictEqual(lost._tag, "ClaimLost", name);
          assert.strictEqual(
            yield* counted("biz"),
            0,
            `${name} rolled the write back`
          );
        })
      )
  );

  scenario(
    "every claim, receipt, sweep, report and cleanup is a defect inside a transaction",
    () =>
      Effect.forEach(standaloneCalls, ([name, call]) =>
        Effect.gen(function* () {
          const outbox = yield* withMessage;

          const exit = yield* Effect.exit(transaction(widen(call(outbox))));

          assert.strictEqual(
            defectOperation(exit, StandaloneInTransactionDefect),
            name
          );
          yield* widen(call(outbox));
        })
      )
  );
});

/** The Hyperdrive client is built lazily: no connection is made until a statement runs. */
const behindHyperdrive = hyperdriveLayer({
  url: Redacted.make("postgres://nobody@127.0.0.1:1/none"),
});

layer(behindHyperdrive)("the mode check", (it) => {
  it.effect(
    "building the outbox on Hyperdrive refuses what the catalogue cannot vouch for, with its words",
    () =>
      Effect.gen(function* () {
        const refused = yield* make({ outbox: declaration }).pipe(Effect.flip);

        assert.strictEqual(refused._tag, "OperationRefusedError");
        assert.match(refused.message, /catalogue/u);
      })
  );

  it.effect(
    "a process that only enqueues is refused too, with the gap of the recorded run; allowUnverified accepts it; a claim brings its follow-up read",
    () =>
      Effect.gen(function* () {
        const enqueueOnly = yield* make({
          operations: ["enqueue"],
          outbox: declaration,
        }).pipe(Effect.flip);

        assert.strictEqual(enqueueOnly.support, "unverified");
        assert.match(
          enqueueOnly.message,
          /concurrent DO NOTHING claim, with exactly one winner, was not run/u
        );
        yield* make({
          allowUnverified: true,
          operations: ["enqueue"],
          outbox: declaration,
        });

        const withClaim = yield* make({
          operations: ["claimById"],
          outbox: declaration,
        }).pipe(Effect.flip);

        assert.match(withClaim.message, /may run classify after itself/u);
        yield* make({ allowUnverified: true, outbox: declaration });
      })
  );
});

# 0002 The `pg` adapter

Status: **spec** (frozen when its PR opens). Date: 2026-10-30. Decided by: the operator's decision of 2026-10-29 (a narrow client-neutral core with "thin Effect and pg adapters", operator log line 112) and the assignment's deliverable 3.
Process: [spec 0000](0000-development-lifecycle.md). Stacked on the branch of PR "spec 0001" (the core).
Depends on: [spec 0001](0001-core.md) (the statements, `Statement`, the mode check, the conformance suite), `@pg-txmode/pg` (pinned submodule, spec 0001 "Dependency on pg-txmode").
Verify skill: `verify-pg-outbox` (path row for `packages/pg/**`).

## Problem

The core states the protocol and runs nothing. A `pg` (node-postgres) user needs functions that take a client and a transaction and return the typed answers, without learning the statements, and without a place to put a second copy of the SQL. The two failure modes of an adapter are to re-implement the protocol (a second source of the statements, free to drift from the model) and to be easy to call wrongly (an `enqueue` that commits alone, a claim that runs inside a caller's transaction).

## Goal

`@pg-outbox/pg`: `createPgOutbox({ outbox, db })` returns one function per operation over a `@pg-txmode/pg` client, and nothing else. It adds **no SQL and no pooler fact**: every statement is a builder of the declaration run by the core's `execute`; the mode check is the core's `requireOperation` over the client's own `mode`.

## Journey

```ts
import { declareOutbox } from "@pg-outbox/core";
import { createPgOutbox } from "@pg-outbox/pg";
import { createDatabase } from "@pg-txmode/pg";
import { neonPooler } from "@pg-txmode/core";

const db = createDatabase({ connectionString, mode: neonPooler });
const outbox = createPgOutbox({ db, outbox: declareOutbox({ table: "outbox", errorClasses: ["rejected", "timeout"], retry: { maxAttempts: 8, delaysMs: [300_000, 3_600_000] } }) });

// 1. the business transaction writes the message (a Transaction is required by the type)
await db.transaction(async (tx) => {
  await tx.query("INSERT INTO orders …", […]);
  await outbox.enqueue(tx, { kind: "Mail", payload: { orderId } });          // Enqueued(id) | Duplicate
});
// 2. after commit, a wake-up delivers the id (the caller's transport). 3. the worker:
const claim = await outbox.claimById({ id, leaseMs: 60_000 });               // Claimed | Held | NotDue | Settled
if (claim._tag === "Claimed") {
  await send(claim.payload, { idempotencyKey: claim.id, fence: claim.attempts });
  await outbox.ack({ id: claim.id, token: claim.token });                    // Delivered | ClaimLost
}
```

An `ack` in the caller's own transaction (the effect is in the database): `db.transaction(async (tx) => { await outbox.holdClaim(tx, {id, token}); …writes…; await outbox.ack({id, token}, tx); })`.

## Constraints and values

- **Transactions are in the types.** `enqueue` and `holdClaim` take the `Transaction` of `db.transaction`; `ack`, `release` and `bury` take it optionally; the claims, receipt, sweep, reports and cleanup take none (spec 0001, "Transaction column"). A `TxClient` is not a `Transaction`, so `outbox.enqueue(db, …)` does not type-check.
- **No SQL, no pooler fact.** A test fails when a source of an adapter holds a statement; the pooler-fact test of spec 0000 already covers `packages/*/src`.
- **The clock is an argument**; the adapter's default is `databaseNow` (spec 0001). A call may pass `now` (`fixedNow(at)`); there is no clock option on the adapter, so there is one way to set the time.
- **The mode check runs when the outbox is built, for the operations the process uses** (all by default; `operations: ["enqueue"]` for a process that only enqueues). An operation whose catalogue cell is not `works` for `db.mode` is refused with the catalogue's words unless `allowUnverified`. `claimById` carries `classify` (a read) with it (`follows` in `operations.ts`).
- **Failures are the caller's.** A rejection of the driver reaches the caller unchanged; the adapter does not retry (the transaction's own retry on 40001 and 40P01 is `db.transaction`'s, and runs the whole body again, so a body that enqueues must be safe to run twice). A row that is not the promised shape is a `ProtocolError`; an argument that cannot be sent is an `InvalidArgumentError` before any statement runs.
- **Nothing runs at construction** except the mode check (it reads the catalogue and sends nothing).
- **Cancellation** is not added: a transaction is cancelled through `db.transaction`'s `signal`; a single statement is not cancelled by this adapter.
- The adapter depends on the core and on `@pg-txmode/pg`; no Effect (the boundary gate).

## What is built

| Part | Content |
| --- | --- |
| `packages/pg` (`@pg-outbox/pg`) | `createPgOutbox`, `PgOutbox`, `PgOutboxOptions` (about 180 lines with its contract, no statement) |
| core | `execute` and `Query` (the interpreter, five lines, one source for every adapter and the suite); `BuilderName`, `BuilderArgs`; `follows` in `operations.ts` and `isOperationId`; `claimById`'s support is no stronger than `classify`'s |
| `packages/conformance` | `defineSubjectConformance(name, build, rounds)`: the suite for any subject; `Built`, `mutatedTexts`, `mutatedMigration`, `rewriteSent`, `runsOnOwnConnection`; `coreSubject` rewritten on them and on `execute` (same 72 tests) |
| `packages/pg/test` | `pgSubject` (the adapter as a conformance subject over a recording proxy of the client), `direct.test.ts` and `pooled.test.ts` (the whole suite through the adapter), `adapter.test.ts` (8 tests: construction, mode, clock, types, failures) |
| gates | `tools/quality`: "an adapter adds no SQL" (with a control); `model/confirmed.json` re-recorded (`operations.ts` changed); `eslint/require-await` off as in pg-txmode |

## Falsifiers

Every falsifier of spec 0001 runs again **through the adapter**, on PostgreSQL 18 directly and behind PgBouncer 1.25 in transaction mode (Neon's settings, three server connections, an adapter pool of eight): the same 14 falsifiers and 22 controls, 72 tests. A control is applied to the statement the adapter built (found by its text) at the client proxy, so the adapter knows nothing of controls; `enqueue` and `ack` "on their own connection" are the adapter's calls without the caller's transaction.

| # | Falsifier (must hold) | Gate | Negative control (must fail) |
| --- | --- | --- | --- |
| A1 | F1 to F15 hold through the adapter, and each control still fails through it | `packages/pg/test/direct.test.ts`, `pooled.test.ts` | the 22 controls of spec 0001 |
| A2 | `enqueue` and `holdClaim` cannot be called without a `Transaction`; `ack`, `release`, `bury` take one optionally; the standalone operations take none | `adapter.test.ts` (type-checked by `vp check`; `expectTypeOf`) | `expectTypeOf(adapter.enqueue).parameter(0)` is not a `TxClient` |
| A3 | The mode check runs at construction: Hyperdrive refuses an unverified operation with the catalogue's words; `operations: ["enqueue"]` is accepted there; `claimById` brings `classify`; `allowUnverified` accepts | `adapter.test.ts` | build on Hyperdrive with the defaults: `UnsupportedOperationError`, message names the catalogue |
| A4 | A call without `now` sends a null time (the database's clock); a call with `fixedNow` sends the instant | `adapter.test.ts` | the last bind value of the first call is `null`, of the second the ISO instant |
| A5 | A rejection of the driver is the caller's, unchanged, and is not retried; a wrong-shaped answer is a `ProtocolError`; a bad argument fails before any statement | `adapter.test.ts` | a stub client that rejects: the same object comes back, one statement sent |
| A6 | Building the outbox sends nothing and opens no transaction | `adapter.test.ts` | the stub counts zero statements and zero transactions |
| A7 | An adapter's source holds no SQL | `tools/quality/test/effectBoundary.test.ts` | a fixture with a `SELECT`, an `UPDATE`, an `INSERT`, `BEGIN` and a CTE in a string is reported; a sentence about "the update of the row" is not |
| A8 | `bun run ready` exits 0 on the head | `ready` | the controls above |

## Constraints on the implementation

- Free on mechanism, specific on behaviour. The adapter is a thin function set; a new operation arrives in the core and its builder, and here only as one line.
- The tests start their own servers on free ports.

## Risks

| Risk | Mitigation |
| --- | --- |
| `db.transaction` retries a body on 40001 and 40P01, so an `enqueue` can run twice | Said in the contract; the retry sits where the transaction is, not in the adapter; `dedupeKey` makes an enqueue idempotent |
| The adapter's own pool size and PgBouncer's server pool interact (a hold waits while the competing claim holds a server connection) | The suite runs with a pool of eight clients over three server connections: the holder, the waiting claim and the observer fit |
| Statements are not cancelled | Said; a transaction is cancelled through `signal` |
| Nothing was run through Hyperdrive | Said in spec 0001; the adapter only forwards the mode check |
| The proxy of the test subject records `BEGIN` and `COMMIT` itself (the adapter of pg-txmode sends its opening script internally), so F8 lints a log that is not the wire | Said; the SQL of the opening script is pg-txmode's (`openingScript`) and is linted there |

## Open questions for the operator

None.

## Revisions

- **2026-10-30, plan written** with the build, after the core was frozen in PR #3.
- **2026-10-30, found while building.**
  1. **`claimById` follows `classify`.** `claimById` runs a read when it misses, so its support is no stronger than the read's behind a read cache. The core's `operations.ts` gained `follows`, `operationSupport` and the refusal message follow it, and the digest of `model/confirmed.json` was re-recorded after re-reading the model (no protocol statement changed). Today the answer does not change (`outbox-lease` is already `unverified` on Hyperdrive); it matters the day that cell becomes `works`.
  2. **`execute` moved into the core** (spec 0001 had the loop in `coreSubject` only): the adapter, the suite and the Effect adapter run one interpreter.
  3. **`eslint/require-await` is off** in `vite.config.ts`, as in pg-txmode's: `typescript/promise-function-async` makes a promise-returning function async and `require-await` then rejects it.
  4. The test subject needed the suite to take any subject (`defineSubjectConformance`), so `coreSubject` returns the same `Built` and is rewritten on shared helpers (`mutated.ts`); the 72 tests of the core are unchanged.
  5. **A control that deadlocks hung the suite.** Mutating the adapter's `ack` to ignore the caller's transaction made the falsifier "an ack in the transaction that holds the claim" wait for ever (the ack waits for the lock that its own caller holds; the caller waits for the ack): the test timeout is 300 s. The ack in that falsifier is now bounded by `within(5000, …)` and fails in 5 s with "did not finish in 5000 ms (a deadlock?)". The change is in the suite of spec 0001 (`claims.ts`, `fixtures.ts`); no statement and no other falsifier changed.

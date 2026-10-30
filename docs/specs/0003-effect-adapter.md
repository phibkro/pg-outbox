# 0003 The Effect adapter

Status: **spec** (frozen when its PR opens). Date: 2026-10-30. Decided by: the operator's decision of 2026-10-29 (a narrow client-neutral core with "thin Effect and pg adapters", operator log line 112) and the assignment's deliverable 3 (`enqueue` that requires a transaction in its type, a typed `claimLost`, hold and ack in the caller's transaction, built on `@pg-txmode/effect`'s layers).
Process: [spec 0000](0000-development-lifecycle.md). Stacked on the branch of PR "spec 0002" (the `pg` adapter).
Depends on: [spec 0001](0001-core.md) (the statements, `execute`'s model of a `Statement`, the mode check, the conformance suite), [spec 0002](0002-pg-adapter.md) (`defineSubjectConformance`, the subject helpers), `@pg-txmode/effect` (pinned submodule: `TxClient`, the four mode layers, `failureOfSqlError`).
Effect: **4.1.0** (installed; the package pins `>=4.1.0 <4.2.0` because it uses unstable modules: `effect/sql/SqlClient`, `effect/sql/SqlError`, `@effect/sql-pg`).
Verify skill: `verify-pg-outbox` (path row for `packages/effect/**`).

## Problem

The `pg` adapter is promise-shaped: `enqueue(tx, …)` takes a `Transaction` object, and a `ClaimLost` is a value that a caller can read or ignore. In Effect the same two rules can be stated more strongly. A message written outside the business transaction, and a claim lost without the caller's transaction rolling back, are both *representable* in the `pg` adapter; an Effect adapter should make the first a program that does not run (a missing requirement) and the second a failure that rolls back by itself. The other failure mode is the one of spec 0002: an adapter that re-implements the protocol.

## Goal

`@pg-outbox/effect`: `make({ outbox })` returns an `EffectOutbox`, one Effect-returning function per operation over the `SqlClient` and the `TxClient` of `@pg-txmode/effect`, and adds **no SQL and no pooler fact**. What it adds over the `pg` adapter is only what Effect can say in types and channels:

1. **A transaction is in the type.** `enqueue` and `holdClaim` require `InTransaction`, a service that only `transaction(body)` provides. A program that enqueues outside `transaction` has an unsatisfied requirement.
2. **Claim lost is an error.** `ack`, `release`, `bury` and `holdClaim` fail with `ClaimLost` (a tagged error). Inside the caller's transaction that rolls the transaction back, which is what a worker that lost its claim wants: its writes under the claim do not commit. A caller that wants a value recovers it by tag.
3. **Time is a reference.** `OutboxClock` supplies the `Now` of a call: the database's clock by default, `effectClock` for Effect's `Clock` (so `TestClock` moves leases), a fixed instant for a test.

## Journey

```ts
import { declareOutbox } from "@pg-outbox/core";
import { make, transaction } from "@pg-outbox/effect";
import { directLayer } from "@pg-txmode/effect"; // or pgBouncerLayer, neonLayer, hyperdriveLayer
import { Context, Effect, Layer, Redacted } from "effect";
import { SqlClient } from "effect/sql";

const declaration = declareOutbox({ table: "outbox", kinds: ["Mail"], errorClasses: ["rejected", "timeout"], retry: { maxAttempts: 8, delaysMs: [300_000, 3_600_000] } });

// the outbox is a service of yours (the type carries your kinds and classes)
const makeMailbox = make({ outbox: declaration });

class Mailbox extends Context.Service<Mailbox, Effect.Success<typeof makeMailbox>>()("app/Mailbox") {
  static readonly layer = Layer.effect(Mailbox, makeMailbox);
}

const placeOrder = Effect.gen(function* () {
  const mailbox = yield* Mailbox;
  const sql = yield* SqlClient.SqlClient;
  // 1. the business write and the message commit together; `enqueue` outside `transaction` does not run
  return yield* transaction(Effect.gen(function* () {
    yield* sql`INSERT INTO orders …`;
    return yield* mailbox.enqueue({ kind: "Mail", payload: { orderId } }); // Enqueued | Duplicate
  }));
});

const deliver = (id: string) => Effect.gen(function* () {
  const mailbox = yield* Mailbox;
  const claim = yield* mailbox.claimById({ id, leaseMs: 60_000 });       // Claimed | Held | NotDue | Settled
  if (claim._tag === "Claimed") {
    yield* send(claim.payload, { idempotencyKey: claim.id, fence: claim.attempts });
    yield* mailbox.ack({ id: claim.id, token: claim.token });            // fails with ClaimLost when the claim was lost
  }
});
```

A worker whose effect is in the database holds the claim inside its own transaction, and a lost claim rolls its writes back:

```ts
transaction(Effect.gen(function* () {
  yield* mailbox.holdClaim({ id, token });   // ClaimLost here ends the transaction, nothing below runs
  …writes…
  yield* mailbox.ack({ id, token });         // joins this transaction
}));
```

## Constraints and values

- **No Effect in the core; Effect only here.** The boundary gate of spec 0000 already fails when another package depends on `effect` or an `@effect/*` package, or imports it. This spec adds the other direction: **no suppression directive in `packages/effect`** (the house rule: no `@effect-diagnostics` directive, and no registry entry stands in for one).
- **`make` is not a service.** It returns a plain `EffectOutbox<Kind, ErrorClass>`; the application wraps it in its own `Context.Service` class. The `genericEffectServices` diagnostic of the Effect language service forbids a generic service, and a library cannot know the application's kinds.
- **`InTransaction` is the proof, and the type is the guarantee.** It is a `Context.Service` whose value is keyed by a symbol this module does not export, so a proof cannot be built without a cast. `transaction` provides it. `enqueue` and `holdClaim` still check at run time that a transaction of their client is open (`NotInTransactionDefect`): a proof read inside a transaction and used after it is a defect, not an unchecked write.
- **The claims, receipt, sweep, reports and cleanup refuse a transaction** (`StandaloneInTransactionDefect`): a claim inside an open transaction is invisible to every other claimer until it ends and keeps its row lock while the worker sends (spec 0001, "Transaction column"). `ack`, `release` and `bury` join the ambient transaction when there is one and commit alone otherwise.
- **Errors keep their channels.** The driver's `SqlError` is unchanged and not retried (the whole-body retry on 40001 and 40P01 is `TxClient.transaction`'s, and runs the body again: a body that enqueues must be safe to run twice; `dedupeKey` makes an enqueue idempotent). `ClaimLost` is expected and typed. A row that is not the promised shape (`ProtocolError`) and an argument that cannot be sent (`InvalidArgumentError`) are defects, as are the two guards above. `OperationRefusedError` fails `make` when the mode cannot honour an operation the process uses.
- **Nothing runs when it is built.** `make` only checks the mode (it reads the catalogue and sends nothing). Every operation is an Effect value that does nothing until run. Interruption is the driver's: a statement is interruptible and a transaction rolls back.
- **The mode check is the core's** (`requireOperation` over the `TxClient`'s `mode`), run when the outbox is built, for the operations the process says it uses (`operations: ["enqueue"]` on Hyperdrive), unless `allowUnverified`.
- **The clock is one reference.** `OutboxClock` is a `Context.Reference<Effect<Now>>`; the default is `databaseNow`; `effectClock` reads Effect's `Clock`; a test provides `Effect.succeed(fixedNow(at))`. There is no clock option on `make`.
- **The Effect diagnostics are errors.** `packages/effect/tsconfig.json` turns the language-service diagnostics of pg-txmode's Effect package to errors, and `bun run check:effect` (`effect-tsgo tsc -p packages/effect`) runs them; so does `ready` and CI. The Oxlint Effect plugin's rule groups apply to `packages/effect/**`.

## What is built

| Part | Content |
| --- | --- |
| `packages/effect` (`@pg-outbox/effect`) | `make`, `EffectOutbox`, `OutboxOptions`; `transaction`, `InTransaction`, `TransactionError`; `OutboxClock`, `effectClock`; `ClaimLost`, `OperationRefusedError`, `NotInTransactionDefect`, `StandaloneInTransactionDefect` (`Schema.TaggedError`) |
| core | the decoder of an integer column accepts a `bigint` (`@effect/sql-pg` returns `bigint` for `bigint` columns where `pg` returns text); `WithoutClock` (the builder's argument without `now`), shared by both adapters |
| `packages/effect/test` | `effectSubject` (the adapter as a conformance subject over a recording `Proxy` of the `SqlClient`, on one `ManagedRuntime` per file), `direct.test.ts`, `pooled.test.ts` (the whole suite through the adapter), `outbox.test.ts` (8 tests: the Effect-specific rules), `stack.ts` (a throwaway PostgreSQL as a layer) |
| gates | root script `check:effect` (in `ready` and CI); the Oxlint Effect plugin and its overrides in `vite.config.ts`; knip's workspace entry |

## Falsifiers

| # | Falsifier (must hold) | Gate | Negative control (must fail) |
| --- | --- | --- | --- |
| E1 | F1 to F15 of spec 0001 hold **through the adapter**, on PostgreSQL 18 directly and behind PgBouncer 1.25 in transaction mode (Neon's settings, three server connections, a pool of eight): 14 falsifiers and 22 controls, 72 tests | `packages/effect/test/direct.test.ts`, `pooled.test.ts` | the 22 controls of spec 0001, applied to the statement the adapter built (found by its text) at the client wrapper; plus the mutations of E4 and E6 |
| E2 | `enqueue` and `holdClaim` require exactly `InTransaction`; `transaction` removes it and adds `TxClient`; `enqueue`'s error is `SqlError` | `outbox.test.ts` (`expectTypeOf`, checked by `check:effect` and `vp check`) | drop `InTransaction` from `enqueue`'s declared type: `check:effect` fails at the type test |
| E3 | A proof that outlived its transaction is a defect (`NotInTransactionDefect`) and writes nothing | `outbox.test.ts` | make `requireOpen` accept every call: the test fails |
| E4 | A claim lost is the typed error `ClaimLost`; inside the caller's transaction it rolls the business write back; recovered by tag it is a value | `outbox.test.ts`, and F3 through the adapter | make `ack` return success on a lost claim: the test and F3 (both modes) fail |
| E5 | A claim inside a transaction is a defect (`StandaloneInTransactionDefect`); the same claim outside is fine | `outbox.test.ts` | make `requireClosed` accept every call: the test fails |
| E6 | With `effectClock`, `TestClock.adjust` moves a lease: held, then claimed again with `attempts` 2; the default is the database's clock | `outbox.test.ts` | ignore the reference and always use the database's clock: the test and F3, F4, F6 to F10, F15 fail (17 tests) |
| E7 | An enqueue and a business write commit together, and a failing body rolls both back | `outbox.test.ts` | the control of F1 that runs `enqueue` on its own connection fails F1 through the adapter (spec 0001) |
| E8 | The mode check runs at construction on a lazily built Hyperdrive client (no connection is made): refused with the catalogue's words; `operations: ["enqueue"]` and `allowUnverified` accepted; `claimById` brings `classify` | `outbox.test.ts` | build on Hyperdrive with the defaults: `OperationRefusedError` |
| E9 | The Effect diagnostics have teeth, and no directive stands in `packages/effect` | `check:effect`; `tools/quality/test/effectBoundary.test.ts` | a scratch file with an `async` function and a `Promise` constructor fails with TS377081 and TS377143; a fixture with a directive in `packages/effect` is reported |
| E10 | An adapter's source holds no SQL, and the core's imports stay `@pg-txmode/core` and `zod` | `tools/quality/test/effectBoundary.test.ts` | the controls of spec 0002 |
| E11 | `bun run ready` exits 0 on the head, in CI, and the heavy run (300 rounds) passes through the adapter | `ready`, CI | the controls above |

## Constraints on the implementation

- Free on mechanism, specific on behaviour. The adapter is a thin function set over the core's builders and `execute`'s model of a statement (one interpreter loop over `sql.unsafe`); a new operation arrives in the core and here as one method.
- The tests start their own servers on free ports. Test files in `packages/effect` use no `async` function (the language service's `asyncFunction` diagnostic): promise-shaped helpers use `.then`.

## Installed guidance consulted

Effect **4.1.0**: `node_modules/effect/AGENTS.md`, the `ai-docs/src` examples for services and layers (`01_effect/02_services`), errors (`Schema.TaggedError`), `Effect.fn`, layer tests (`09_testing`), and `40_sql` for `SqlClient`; the source of `effect/sql/SqlClient`, `effect/sql/SqlError`, `Effect`, `Context`, `TestClock`, `ManagedRuntime` and `@effect/sql-pg`; and pg-txmode's `@pg-txmode/effect` (the `TxClient`, the layers, the brand pattern of its tagged errors, its `tsconfig.json`).

**APIs used for which the installed `ai-docs` has no entry** (read from the source instead): `Effect.serviceOption` (to ask whether the client's `transactionService` holds a connection, which is how "a transaction is open" is observed), `Effect.provideContext`, `Effect.context`, `Effect.service`, `Effect.flatten` (the `OutboxClock` reference holds an `Effect`), `Clock.currentTimeMillis`, `Effect.exit`, `Exit.isFailure`, `Schema.is` (instead of `instanceof`, which the `instanceOfSchema` diagnostic forbids), `ManagedRuntime.runPromiseExit`, `sql.unsafe` and `sql.transactionService`. `Context.Reference` with an `Effect` default has one example with a plain value only.

## Risks

| Risk | Mitigation |
| --- | --- |
| `InTransaction` proves that *a* transaction was opened by `transaction`, not that it is the caller's current one: a proof can leak out of its body | The run-time check (`NotInTransactionDefect`) rejects a proof used when no transaction of the client is open; a proof used inside another open transaction of the same client is the same transaction by construction (one connection per fiber's transaction) |
| A caller can wrap `enqueue` in `Effect.catch` and drop `ClaimLost` | It is an expected error in the type, so the handler is the caller's explicit choice; the language service flags a catch that only re-fails |
| `@effect/sql-pg` returns `bigint` where `pg` returns text | The core's decoder accepts both, with a test per shape |
| `TxClient.transaction` retries the body on 40001 and 40P01 | Said in the contract; the body must be safe to run twice |
| Nothing was run through Hyperdrive | Said in spec 0001; the adapter only forwards the mode check and the refusal is tested on a lazily built client |
| The wrapper of the test subject records `BEGIN` itself on the first statement of a transaction's connection, so F8 lints a log that is not the wire | Said, as in spec 0002; `COMMIT` is not recorded |
| The unstable modules of Effect move between minors | The package pins `>=4.1.0 <4.2.0`; an upgrade reopens this spec's revisions |

## Open questions for the operator

None.

## Revisions

- **2026-10-30, plan written** with the build, after the `pg` adapter was frozen in PR #4.
- **2026-10-30, found while building.**
  1. **`@effect/sql-pg` returns `bigint`.** The first run through the adapter failed in `classify` and `open` (`unexpected columns: due_ms, held_ms`): the core's integer decoder took numbers and text only. It now takes a `bigint` too, with a core test per shape (a change to `decode.ts`, not to a statement: the model's digest is unchanged).
  2. **`WithoutClock` moved into the core** (`outboxType.ts`): the copy-paste gate found the same `Omit<BuilderArgs, "now">` alias in both adapters.
  3. **The forged-proof test became a stale-proof test.** A proof cannot be forged without a cast (the symbol is not exported), and the lint forbids the cast; the test reads the proof inside `transaction` and uses it after, which is the way a proof can really leak.
  4. **A failure of the body is wrapped for the promise-shaped suite.** The suite's falsifiers throw and compare; `effectSubject` carries a thrown value through the transaction as a typed failure (`BodyFailure`) and hands it back unchanged, and maps a `SqlError` to an `Error` with its SQLSTATE in `code`, as `pg` gives it.
  5. **Four `anti-slop` rules are off for `packages/effect/test/effectSubject.ts` only** (`no-object-parameters`, `no-reflect-get`, `no-unknown-parameters`, `no-unknown-returns`): the file is the boundary between a promise-shaped suite and Effect, and wraps the client in a `Proxy`. The reason is in `vite.config.ts`; it is a rule setting, not a suppression directive.
  6. **The Effect diagnostics gate runs in CI** as the step "Effect diagnostics" (`bun run check:effect`), before the exception registry.

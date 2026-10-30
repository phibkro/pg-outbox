# pg-outbox

A narrow, client-neutral **PostgreSQL outbox** that writes a message in your business transaction and delivers it **at least once** through a transaction pooler (PgBouncer in transaction mode, Supavisor, Cloudflare Hyperdrive), with a stale consumer unable to harm a newer one.

**Status: in development; nothing is published to npm.** Specs 0000 to 0003 (the development lifecycle, the core with its conformance suite and model, the `pg` adapter, the Effect adapter) are merged; spec 0004 (the Hyperdrive probe) is in review. One run of the suite through Cloudflare Hyperdrive (caching enabled, Free plan, a direct Neon endpoint) is recorded, and what it covers is named in spec 0004.

## What it is

The protocol is stated once (SQL, a formal model, a conformance suite) and adapters are thin:

- a **core** (`@pg-outbox/core`) with no driver and no Effect: the table and its migration, the claim / fence / hold / ack / release / bury statements as data with typed answers (`ClaimLost` is a case you must handle, never an empty result), the retry policy as data, and the mode check against the [pg-txmode](https://github.com/phibkro/pg-txmode) catalogue. Every statement takes its clock as an argument (`databaseNow` or `fixedNow`);
- a **conformance suite** (`@pg-outbox/conformance`) that runs 15 falsifiers on PostgreSQL directly and behind PgBouncer in transaction mode, with 28 negative controls (deliberate defects) that must each make a falsifier fail;
- a **TLA+ model** (`model/ClaimFence.tla`) of the claim and fence protocol: the correct model has no error, six broken variants each have the counterexample they name, eight reach cases show the model can do what its invariants are about;
- a thin **`pg`** adapter (`@pg-outbox/pg`, spec 0002): one function per operation over a `@pg-txmode/pg` client, no SQL of its own, `enqueue` and `holdClaim` take the `Transaction` (a `TxClient` does not type-check); the same 14 falsifiers and 26 controls run through it;
- a thin **Effect** adapter (`@pg-outbox/effect`, spec 0003, Effect 4.1) over `@pg-txmode/effect`'s layers: `enqueue` and `holdClaim` require `InTransaction`, which only `transaction(…)` provides, so a message written outside the business transaction is a program that does not run; `ClaimLost` is a typed error that rolls the caller's transaction back; time is the `OutboxClock` reference: an **ambient** `Context.Reference` (the database's clock by default, `effectClock` for Effect's `Clock` so that `TestClock` moves leases, or a fixed instant), set for a whole program, **with no per-call `now`** as the `pg` adapter has. The same 14 falsifiers and 26 controls run through it, plus twelve Effect-specific tests.

It is deliberately not a queue runtime: no worker loop, no cron, no ordering, no exactly-once, no `LISTEN`, no session advisory locks.

## Try it

```sh
git clone https://github.com/phibkro/pg-outbox
cd pg-outbox
devenv shell -- bun install --frozen-lockfile
devenv shell -- bun run ready           # every gate: lint, tests (conformance included), the model, build, knip, cpd, secrets
devenv shell -- bun run model           # TLC: one line per case, the counterexamples as action names
PG_OUTBOX_ROUNDS=300 devenv shell -- bash -c 'cd packages/conformance && bunx vp test run'
```

pg-txmode (`@pg-txmode/core`, `pg`, `effect`, `lint`, `harness`) comes from the npm registry at one exact alpha version, `0.1.0-alpha.1` (spec 0005; an alpha promises nothing between versions, so no range). There is no submodule.

## Roadmap

1. Spec 0000: development lifecycle and scaffold (copied from pg-txmode, with provenance). Merged.
2. Spec 0001: the core, the schema, the model and the conformance suite. Merged.
3. Spec 0002: the `pg` adapter. Merged.
4. Spec 0003: the Effect adapter. Merged.
5. Spec 0004: the Hyperdrive probe (`apps/hyperdrive-probe`): the whole suite through a Worker and Hyperdrive in front of a throwaway Neon branch. In review. It ran once, on 2026-10-30, and the raw output is under `docs/evidence/hyperdrive/`: the suite (15 falsifiers, 28 controls) passed 43 of 43 through Hyperdrive with caching enabled, twice, after two earlier runs found a defect of the suite (its own reads were served from the cache) and one lost connection. All 13 operations are now `yes` on Hyperdrive, **under the conditions of that run** (caching enabled, Workers Free, a direct Neon endpoint, 24 sockets, 20 rounds; not covered: caching disabled, the pooled endpoint, other plans, regions or origins): every measurement carries them (`covers`), and the outbox you build returns them as `measuredUnder`. The Worker, the Hyperdrive configuration and the credentials are gone.

## Licence

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

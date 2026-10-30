# @pg-outbox/core

The protocol of a Postgres outbox as statements and types, with no driver and no Effect: a message is written in your business transaction and delivered **at least once** through a transaction pooler. `declareOutbox` takes the table, the closed sets of kinds and failure classes, and the retry policy; it gives one statement per operation (`enqueue`, `claimById`, `claimBatch`, `ack`, `release`, `bury`, `holdClaim`, `markQueued`, `stale`, `counts`, `open`, `cleanup`), the typed results (a lost claim is a value, `ClaimLost`, never an empty array), the migration, and the mode check. Run the statements with [`@pg-outbox/pg`](https://www.npmjs.com/package/@pg-outbox/pg) or [`@pg-outbox/effect`](https://www.npmjs.com/package/@pg-outbox/effect), or with a client of your own.

```sh
npm i @pg-outbox/core@alpha
```

This is an **alpha** (`0.1.0-alpha.N`): no promise of compatibility between alphas. An untagged `npm i @pg-outbox/core` may install the first alpha; use `@alpha`. It depends on `@pg-txmode/core` at one exact alpha version: pg-txmode's catalogue says what each pooler can do, and a changed catalogue changes this package's mode check, so the pin moves only in a reviewed release.

## The mode check, and what a Hyperdrive `yes` covers

`operationSupport(mode, operation)` answers `yes`, `unverified` or `no` for a connection mode, from pg-txmode's catalogue **and** from recorded runs of this library's own conformance suite. For PgBouncer in transaction mode and direct connections the answer rests on the catalogue and the suite on PostgreSQL 18 and PgBouncer 1.25. For **Cloudflare Hyperdrive** the answer is `yes` for every operation only because of one recorded run, and that run has conditions: **Hyperdrive caching enabled (its default), Cloudflare Workers Free plan, one Worker placed `aws:eu-central-1`, 24 sockets, a Neon direct endpoint (PostgreSQL 18.6), 20 rounds of each race, no `LISTEN` and no session advisory lock.** Not covered: caching disabled, the pooled Neon endpoint, another plan, region or origin, a long or loaded run. Every measurement carries those conditions (`measuredUnder(mode, operations)` returns them, each with its date, "measured on 2026-10-30", and the evidence file), a refusal quotes them, and the outboxes of `@pg-outbox/pg` and `@pg-outbox/effect` expose them as `measuredUnder`: log it where you choose a mode. Supavisor has no run: every operation is `unverified` there, and the adapters refuse it unless you pass `allowUnverified`.

Source, the specs, the recorded runs and the conformance suite: <https://github.com/phibkro/pg-outbox>. Licence: Apache-2.0.

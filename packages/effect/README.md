# @pg-outbox/effect

The [`@pg-outbox/core`](https://www.npmjs.com/package/@pg-outbox/core) protocol as an Effect service over [`@pg-txmode/effect`](https://www.npmjs.com/package/@pg-txmode/effect)'s layers (`SqlClient`). `make({ outbox })` builds the outbox; `enqueue` and `holdClaim` **require `InTransaction` in their type**, which only `transaction(...)` provides, so a message cannot be written outside the business transaction; a lost claim is a typed value; `ack`, `release` and `bury` join the caller's transaction when there is one.

```sh
npm i @pg-outbox/effect@alpha @pg-outbox/core@alpha effect@">=4.1.0 <4.2.0"
```

An **alpha**: no promise of compatibility between alphas; install with `@alpha`. `effect` is a peer at `>=4.1.0 <4.2.0` because the adapter uses Effect's unstable modules, which may break in a minor release (a caret would admit 4.2). `@pg-txmode/effect` is an exact dependency and itself needs `@effect/sql-pg` at the same range.

## What a Hyperdrive `yes` covers

`make` runs the mode check and fails with `OperationRefusedError` for an operation the mode cannot honour or that is only `unverified` (`allowUnverified: true` accepts that). Behind **Cloudflare Hyperdrive** every operation is `yes` because of one recorded run with these conditions: caching enabled (the default), Workers Free plan, one Worker placed `aws:eu-central-1`, 24 sockets, a Neon direct endpoint (PostgreSQL 18.6), 20 rounds of each race, no `LISTEN`, no session advisory lock. Not covered: caching disabled, the pooled Neon endpoint, another plan, region or origin, a long or loaded run. The built outbox has `measuredUnder`: the runs its `yes` stands on, each "measured on <date> (the recorded run: 2026-10-30)" with the conditions and the evidence file; log it where you pick a mode. Supavisor has no run and is refused unless you accept `unverified`.

Source, specs and evidence: <https://github.com/phibkro/pg-outbox>. Licence: Apache-2.0.

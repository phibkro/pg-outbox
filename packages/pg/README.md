# @pg-outbox/pg

The [`@pg-outbox/core`](https://www.npmjs.com/package/@pg-outbox/core) protocol over a [`@pg-txmode/pg`](https://www.npmjs.com/package/@pg-txmode/pg) client (node-postgres): `createPgOutbox({ db, outbox })` gives one function per operation and no SQL of its own. `enqueue` and `holdClaim` **take the `Transaction`** of `db.transaction(...)`, so a message cannot be written outside the business transaction; `ack`, `release` and `bury` join it when given one; a lost claim is `{ _tag: "ClaimLost" }`, never an empty result.

```sh
npm i @pg-outbox/pg@alpha @pg-outbox/core@alpha
```

An **alpha**: no promise of compatibility between alphas; install with `@alpha`. It depends on `@pg-txmode/pg` and `@pg-outbox/core` at exact versions.

## What a Hyperdrive `yes` covers

Building the outbox checks the connection mode against the catalogue and the recorded runs and throws `UnsupportedOperationError` for an operation the mode cannot honour or that is only `unverified` (pass `allowUnverified: true` to accept that). Behind **Cloudflare Hyperdrive** every operation is `yes` because of one recorded run with these conditions: caching enabled (the default), Workers Free plan, one Worker placed `aws:eu-central-1`, 24 sockets, a Neon direct endpoint (PostgreSQL 18.6), 20 rounds of each race, no `LISTEN`, no session advisory lock. Not covered: caching disabled, the pooled Neon endpoint, another plan, region or origin, a long or loaded run. The outbox you build has `measuredUnder`: the runs its `yes` stands on, each with "measured on <date>", the conditions and the evidence file; log it where you pick a mode. Supavisor has no run and is refused unless you accept `unverified`.

Source, specs and evidence: <https://github.com/phibkro/pg-outbox>. Licence: Apache-2.0.

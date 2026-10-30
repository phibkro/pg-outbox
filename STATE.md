# State

Lifecycle: build

Now:

pg-outbox is a narrow Postgres outbox with a client-neutral core and thin `pg` and Effect adapters, built on pg-txmode. Specs 0000 (development lifecycle and scaffold), 0001 (the core: protocol, schema, conformance suite, TLA+ model), 0002 (the `pg` adapter), 0003 (the Effect adapter) and 0004 (the Hyperdrive probe: the suite through a deployed Worker and Hyperdrive; every operation measured) are merged. Spec 0005 (pg-txmode from the registry) is in review.

Next:

- The operator should revoke the Cloudflare API token the probe used (it expires by itself in 1 to 2 days); the Neon branch expires by itself.
- Spec 0005 (pg-txmode from the registry; the submodule goes): in review. Merge with `merge.sh` once a round passes.
- Spec 0006 (the npm release path for `@pg-outbox/{core,pg,effect}`): in review, stacked on spec 0005. Then a version PR (`bun run release:version`), then the operator dispatches `check` and `publish`.

Blocked:

- Nothing is blocked on Hyperdrive any more: the run of 2026-10-30 is recorded (spec 0004). What it did not cover (the pooled Neon endpoint behind Hyperdrive, caching off, other plans or regions, a longer run) stays unverified, and pg-txmode's catalogue still shows `unknown` cells for Hyperdrive: a follow-up there should carry the measured cells (a per-cell "covers" and "measured on").
- Publishing pg-outbox to npm: approved by the operator (D1); the first publish is the operator's dispatch of the workflow `Release` in `publish` mode after the version PR (spec 0006). Nothing is published yet.
- Nothing else is blocked on pg-txmode: spec 0005 is in review.

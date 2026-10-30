# State

Lifecycle: build

Now:

pg-outbox is a narrow Postgres outbox with a client-neutral core and thin `pg` and Effect adapters, built on pg-txmode. Specs 0000 (development lifecycle and scaffold), 0001 (the core: protocol, schema, conformance suite, TLA+ model), 0002 (the `pg` adapter) and 0003 (the Effect adapter) are merged. Spec 0004 (the Hyperdrive probe: the suite through a deployed Worker and Hyperdrive; every operation measured) is built and in review.

Next:

- Merge spec 0004 with `merge.sh` once a round passes.
- The operator should revoke the Cloudflare API token the probe used (it expires by itself in 1 to 2 days); the Neon branch expires by itself.
- Spec 0005 (pg-txmode from the registry; the submodule goes): in review. Merge with `merge.sh` once a round passes.
- Then: pg-outbox's own first release path (a spec modelled on pg-txmode's spec 0006).

Blocked:

- Nothing is blocked on Hyperdrive any more: the run of 2026-10-30 is recorded (spec 0004). What it did not cover (the pooled Neon endpoint behind Hyperdrive, caching off, other plans or regions, a longer run) stays unverified, and pg-txmode's catalogue still shows `unknown` cells for Hyperdrive: a follow-up there should carry the measured cells (a per-cell "covers" and "measured on").
- Publishing pg-outbox to npm needs the operator's authority (a separate spec, modelled on pg-txmode's spec 0006).
- Nothing else is blocked on pg-txmode: spec 0005 is in review.

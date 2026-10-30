# State

Lifecycle: build

Now:

pg-outbox is a narrow Postgres outbox with a client-neutral core and thin `pg` and Effect adapters, built on pg-txmode. Specs 0000 (development lifecycle and scaffold), 0001 (the core: protocol, schema, conformance suite, TLA+ model), 0002 (the `pg` adapter) and 0003 (the Effect adapter) are built and in review, stacked in that order.

Next:

- Review spec 0000, then merge it with `merge.sh` once a round passes; retarget the stacked PR of each spec above it to the branch below it, up the stack (0001, 0002, 0003).
- Spec 0004 (the Hyperdrive probe): the deployed run waits for a working Cloudflare credential for the profile `default` (its OAuth login is expired); everything that runs on this machine is built and passes.
- After the merges: the replacement of `vendor/pg-txmode` (spec 0001) once pg-txmode publishes, with the operator's authority.

Blocked:

- The Hyperdrive column of every claim stays `unverified` until the pg-txmode probe Worker runs; it needs the operator's Cloudflare credentials (pg-txmode's wizard `docs/wizard/hyperdrive-probe.md`). Nothing here has run through Hyperdrive.
- Publishing to npm needs the operator's authority; it also retires the `vendor/pg-txmode` submodule (spec 0001, "Dependency on pg-txmode").

# State

Lifecycle: build

Now:

pg-outbox is a narrow Postgres outbox with a client-neutral core and thin `pg` and Effect adapters, built on pg-txmode. Specs 0000 (development lifecycle and scaffold), 0001 (the core: protocol, schema, conformance suite, TLA+ model) and 0002 (the `pg` adapter) are built and in review, stacked in that order. Spec 0003 (the Effect adapter) follows.

Next:

- Review spec 0000, then merge it with `merge.sh` once a round passes; retarget the stacked PR of spec 0001 to `main`, and so on up the stack.
- Spec 0003 (the Effect adapter) on its own stacked branch.

Blocked:

- The Hyperdrive column of every claim stays `unverified` until the pg-txmode probe Worker runs; it needs the operator's Cloudflare credentials (pg-txmode's wizard `docs/wizard/hyperdrive-probe.md`). Nothing here has run through Hyperdrive.
- Publishing to npm needs the operator's authority; it also retires the `vendor/pg-txmode` submodule (spec 0001, "Dependency on pg-txmode").

# pg-outbox

A narrow, client-neutral **PostgreSQL outbox** that writes a message in your business transaction and delivers it **at least once** through a transaction pooler (PgBouncer in transaction mode, Supavisor, Cloudflare Hyperdrive), with a stale consumer unable to harm a newer one.

**Status: in development; nothing is published to npm, and nothing has run through Hyperdrive.** Spec 0000 (the development lifecycle), spec 0001 (the core, its conformance suite and its model) and spec 0002 (the `pg` adapter) are in review. The Effect adapter (spec 0003) is planned.

## What it is

The protocol is stated once (SQL, a formal model, a conformance suite) and adapters are thin:

- a **core** (`@pg-outbox/core`) with no driver and no Effect: the table and its migration, the claim / fence / hold / ack / release / bury statements as data with typed answers (`ClaimLost` is a case you must handle, never an empty result), the retry policy as data, and the mode check against the [pg-txmode](https://github.com/phibkro/pg-txmode) catalogue. Every statement takes its clock as an argument (`databaseNow` or `fixedNow`);
- a **conformance suite** (`@pg-outbox/conformance`) that runs 14 falsifiers on PostgreSQL directly and behind PgBouncer in transaction mode, with 26 negative controls (deliberate defects) that must each make a falsifier fail;
- a **TLA+ model** (`model/ClaimFence.tla`) of the claim and fence protocol: the correct model has no error, six broken variants each have the counterexample they name, eight reach cases show the model can do what its invariants are about;
- a thin **`pg`** adapter (`@pg-outbox/pg`, spec 0002): one function per operation over a `@pg-txmode/pg` client, no SQL of its own, `enqueue` and `holdClaim` take the `Transaction` (a `TxClient` does not type-check); the same 14 falsifiers and 22 controls run through it;
- a thin **Effect** adapter (planned, spec 0003): the `enqueue` will not type-check outside a transaction.

It is deliberately not a queue runtime: no worker loop, no cron, no ordering, no exactly-once, no `LISTEN`, no session advisory locks.

## Try it

```sh
git clone --recurse-submodules https://github.com/phibkro/pg-outbox
cd pg-outbox
devenv shell -- bun install
devenv shell -- bun run ready           # every gate: lint, tests (conformance included), the model, build, knip, cpd, secrets
devenv shell -- bun run model           # TLC: one line per case, the counterexamples as action names
PG_OUTBOX_ROUNDS=300 devenv shell -- bash -c 'cd packages/conformance && bunx vp test run'
```

`vendor/pg-txmode` is a git submodule pinned by commit: pg-txmode is not published yet, and a normal dependency replaces the submodule when it is (spec 0001 names the trigger).

## Roadmap

1. Spec 0000: development lifecycle and scaffold (copied from pg-txmode, with provenance). In review.
2. Spec 0001: the core, the schema, the model and the conformance suite. In review.
3. Spec 0002: the `pg` adapter. In review.
4. Spec 0003: the Effect adapter. Planned.
5. Hyperdrive: pg-txmode's deployed probe Worker needs the operator's Cloudflare credentials; until it runs, every Hyperdrive cell is `unverified`.

## Licence

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

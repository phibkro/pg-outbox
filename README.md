# pg-outbox

A narrow, client-neutral **PostgreSQL outbox** that writes a message in your business transaction and delivers it **at least once** through a transaction pooler (PgBouncer in transaction mode, Supavisor, Cloudflare Hyperdrive), with a stale consumer unable to harm a newer one.

**Status: nothing is built yet.** This repository holds only its licence and this page. The plan is a sequence of specs, one pull request each (see the roadmap). Nothing is published to npm, and nothing here has been run through Hyperdrive.

## What it will be

The protocol is stated once (SQL, a formal model, a conformance suite) and adapters are thin:

- a **core** with no driver and no Effect: the table and its migration, the claim / fence / hold / ack / release / bury statements as data, typed results, and the mode check against the [pg-txmode](https://github.com/phibkro/pg-txmode) catalogue;
- a **conformance harness** that runs the same falsifiers against PostgreSQL directly and behind PgBouncer in transaction mode, each with a negative control that must fail;
- a **TLA+ model** of the claim and fence protocol, with broken variants that TLC must reject;
- a thin **`pg` (node-postgres)** adapter and a thin **Effect** adapter whose `enqueue` cannot be called outside a transaction, by its type.

It is deliberately not a queue runtime: no worker loop, no cron, no ordering, no exactly-once, no `LISTEN`, no session advisory locks.

## Roadmap

Planned only; nothing below is built.

1. Spec 0000: development lifecycle and scaffold (copied from pg-txmode, with provenance).
2. Spec 0001: the core, the schema, the model and the conformance harness.
3. Spec 0002: the `pg` adapter.
4. Spec 0003: the Effect adapter.

## Licence

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

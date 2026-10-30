# 0004 The Hyperdrive probe

Status: **spec** (frozen when its PR opens). Date: 2026-10-30. Decided by: the operator's decision D2 (a throwaway Worker and a disposable PostgreSQL, using the operator's Alchemy credentials, torn down afterwards; relayed by the lead, 2026-10-30) and spec 0001 ("Hyperdrive: declared, unverified", F12).
Process: [spec 0000](0000-development-lifecycle.md). Branch `feat/0004-hyperdrive-probe` from `main`.
Depends on: [spec 0001](0001-core.md) (the suite, `operationSupport`), [spec 0002](0002-pg-adapter.md) (`createPgOutbox`, `pgSubject`).
Prior art, reused and not rebuilt: pg-txmode's wizard `docs/wizard/hyperdrive-probe.md` (the shape: the Worker's only database address is the binding, a client is opened inside the handler, the runner compares), pg-txmode's recorded run `docs/evidence/hyperdrive/vektorprogrammet-reimagined-0000-results.md` (the flags and the format of a recorded run), and `phibkro/vektorprogrammet-reimagined` spec 0025 (a deployed route, a Hyperdrive configuration with caching off in front of a Neon branch, the placement next to the database).
Verify skill: `verify-pg-outbox` (path row for `apps/hyperdrive-probe/**`).

## Problem

Every Hyperdrive cell of `operationSupport` is `unverified` (spec 0001, round 1): the catalogue's `outbox-lease`, `skip-locked` and `row-locks` cells for Hyperdrive are `unknown`, and its `on-conflict` cell is `works` from a run that never raced a concurrent `ON CONFLICT DO NOTHING`. So a process that runs this library behind Hyperdrive must say `allowUnverified`, and nobody can say whether the claim, the fence, the hold and the deduplication hold there. The only way to know is to run the suite through Hyperdrive.

The suite cannot run inside a Worker as it is (it is promise-shaped, uses vitest's `expect`, and a falsifier's transaction body is arbitrary code). A transaction cannot span HTTP requests either: it needs one connection from its first statement to its `COMMIT`.

## Goal

A runner on this machine runs the **unchanged conformance suite**, through the `pg` adapter, against a Worker deployed on Cloudflare whose only database address is a Hyperdrive binding in front of a disposable Neon branch; every statement of every falsifier and every control reaches the database that way. The raw output is recorded under `docs/evidence/hyperdrive/`, the Worker, the Hyperdrive configuration and the Neon branch are gone afterwards, and the cells that the run settled stop being `unverified`.

## Journey

```sh
devenv shell -- bun run --cwd apps/hyperdrive-probe probe local     # 1. the same Worker code under workerd, on this machine: not Hyperdrive
devenv shell -- bun run --cwd apps/hyperdrive-probe probe up        # 2. deploy ONE Worker and ONE Hyperdrive configuration (Alchemy)
devenv shell -- bun run --cwd apps/hyperdrive-probe probe run       # 3. the suite through them; raw output in .probe/
devenv shell -- bun run --cwd apps/hyperdrive-probe probe record    # 4. the output under docs/evidence/hyperdrive/
devenv shell -- bun run --cwd apps/hyperdrive-probe probe down      # 5. destroy both, then check by name that nothing remains
```

`up`, `run` and `down` need the operator's credentials and are run by the author of this spec once, with the operator's approval, never in CI and never by `bun run ready`. `local` and the unit tests need nothing but this repository.

## Design

```text
runner (this machine)                          Cloudflare                                    Neon
vitest: the suite, unchanged                   Worker `pg-outbox-probe`
  pgSubject -> createPgOutbox(remote client)     GET /health                              branch `probe/pg-outbox-<date>`
  remote client: a pool of WebSockets   ──────►  GET /session (WebSocket)  ──► pg Client ──► Hyperdrive config ──► its own database
  one socket = one Worker invocation             {id, text, values} → rows | {code, message}  `pg-outbox-probe`        and its own role
                                                 no SQL of its own, no decisions               caching disabled
```

- **One socket is one Worker invocation and one connection of its binding.** A transaction is a run of statements on one socket, exactly as a Worker holds a client for a transaction. A concurrent claimer is another socket, hence another invocation: a Worker invocation can have only six connections *waiting for response headers* at once (Cloudflare's Workers limits), and the Hyperdrive origin pool is about 20 connections on the Free plan (Hyperdrive's limits), so the race of 20 claimers is 20 invocations and the origin pool is where they meet, as in production.
- **The Worker adds no SQL and decides nothing** (`apps/hyperdrive-probe/src/worker.ts`, `session.ts`): it runs what it is sent and answers rows or a failure with its SQLSTATE. The statements are the core's, the transactions' opening script and retry are `@pg-txmode/core`'s, the control rewrites are applied by the runner before a statement is sent.
- **The client is a `@pg-txmode/pg` `TxClient`** (`src/remote.ts`) of the mode `hyperdrive` over that pool of sockets, so `pgSubject` (spec 0002) and the whole suite run through it as through any other client. `local.test.ts` runs the suite through it over a local twin of the Worker (`src/localTwin.ts`: the same `openSession` on a WebSocket server of this machine) in front of a PostgreSQL 18 of this machine, as part of `bun run test`: a failure there is a failure of the probe, not of Hyperdrive.
- **The disposable database.** The operator made the Neon branch `probe/pg-outbox-<date>` of the project `bold-poetry-64036846` with its own database and role and a **24 h expiry**, and put its direct connection string in a file of mode 0600 (`~/.config/pg-outbox-probe/neon-connection-string`). The probe reads the file by parts, never prints it, and deletes it at teardown; the branch expires by itself. The origin of the Hyperdrive configuration is that direct endpoint (the pooled one is a pooler of its own behind Hyperdrive: catalogue row `pooled-endpoint-behind-hyperdrive`).
- **The infrastructure is two resources** (`deploy/alchemy.run.ts`, Alchemy `2.0.0-beta.84`, `npm view alchemy dist-tags` of 2026-10-30: `latest` beta.84, `next` beta.72): the Worker `pg-outbox-probe` (compatibility date 2026-10-01, flags `nodejs_compat` and `enable_request_signal`, placed next to the Neon region) and the Hyperdrive configuration `pg-outbox-probe` (caching disabled). State is a local file. **The stack lives in `apps/hyperdrive-probe/deploy/`, outside the workspace, with its own `package.json` and lockfile**: Alchemy beta.84 imports `effect/Crypto`, which `effect` 4.1.0 (this repository's version) no longer has, so it needs `effect` 4.0.7 (and `@effect/platform-node-shared` 4.0.7, pinned by an override). The repository stays on 4.1.0.
- **Access.** The Worker's address is public. Every route needs the run's token (a random value written to a 0600 file by `up`), carried in `Sec-WebSocket-Protocol` for the socket and for `/health`; a request without it answers 401 and touches no database.
- **The budget.** The Workers Free plan counts every statement through Hyperdrive, cached or not: 100,000 a day (Cloudflare's Hyperdrive pricing). The runner counts each statement before it sends it, keeps the day's count in a file, and **stops at 80,000** with `BudgetExceededError`. The default is 20 rounds of a race, which this spec estimates (and the first local run measures) well under that.

## Constraints and values

- **Nothing is shown that was not run.** A cell stops being `unverified` only for an operation whose falsifiers **all** passed through the Worker, with the raw output recorded and named by the cell. A falsifier that could not run this way is listed, with its operation, and its cells stay `unverified`.
- **One source per fact.** The measured cells are data of the core (`measuredOn`, next to `coverageGaps`), each naming its evidence file; a test fails when the file is missing, does not name the operation, or lacks a passing line for each of its falsifiers. pg-txmode's catalogue is where the fact belongs, and a follow-up there turns its `unknown` cells into `hyperdrive-probe` cells with the same evidence; until that is merged this repository carries the fact (the same trade as `coverageGaps`).
- **Credentials.** Read by key names and lengths only; never printed, logged, committed or sent to the lead. The Cloudflare credentials are the Alchemy profile `default`; the Neon one is the operator's file. Both are deleted or expire at teardown.
- **Cost and footprint.** One Worker and one Hyperdrive configuration, destroyed afterwards, and checked by name through the Cloudflare API; no R2, KV, queue, DNS or domain. The Free plan's 100,000 queries a day and its 10 ms of CPU per request are limits of the account, not choices of this spec (see Risks).
- **No second copy of the suite.** The app imports `pgSubject` from `packages/pg/test/` and `defineSubjectConformance` from `@pg-outbox/conformance`; it adds a transport and nothing else.
- The app is a private workspace package, `apps/*` is a new category beside `packages/*` and `tools/*`: it depends on libraries and on the harness, nothing depends on it. Its Worker bundle imports `pg` and `zod` only.

## What is built

| Part | Content |
| --- | --- |
| `apps/hyperdrive-probe/src` | `protocol.ts` (the wire), `session.ts` (the session handler shared by the Worker and the twin), `worker.ts` (the Worker), `localTwin.ts`, `remote.ts` (the `TxClient` over sockets), `budget.ts` (the day's count), `workerd.ts` (the Worker under `wrangler dev`) |
| `apps/hyperdrive-probe/test` | `local.test.ts` (the suite through the twin; part of `bun run test`), `hyperdrive.test.ts` (the suite through a Worker; run only by `probe`), unit tests of the budget and the protocol |
| `apps/hyperdrive-probe/deploy` | `alchemy.run.ts`, its own `package.json` and lockfile |
| `apps/hyperdrive-probe/scripts` | `probe.ts` (`local`, `up`, `run`, `record`, `down`, `status`), `spike.ts` (`select 1` and a transaction under workerd), `wrangler.dev.jsonc` |
| core | `measuredOn` and the lift of an `unverified` cell by recorded evidence (after the run) |
| `docs/evidence/hyperdrive/` | the raw output of the run (after the run) |
| gates | `packages/pg/test/pgSubject.ts` takes `allowUnverified`; the pooler-fact test and the boundary tests know the new category; the verify skill |

## Falsifiers

| # | Falsifier (must hold) | Gate | Negative control (must fail) |
| --- | --- | --- | --- |
| P1 | The runner, the protocol and the remote client are right: the suite (14 falsifiers, 26 controls) passes through the twin | `local.test.ts` | break the client's transaction (omit `COMMIT`): F1, F5 and others fail |
| P2 | The Worker's own code runs under workerd: `/health`, `select 1` and a transaction answer | `scripts/spike.ts` | a wrong token answers 401; a request without the upgrade answers 426 |
| P3 | The suite passes under workerd (the real Worker code in the Workers runtime; still not Hyperdrive) | `probe local` | as P1 |
| P4 | The budget stops a run before the limit and counts across runs of the day | `budget.test.ts` | a limit of 3 stops the fourth statement; a day's file of yesterday counts as 0 |
| P5 | **Through Hyperdrive**: for each operation, the falsifiers that exercise it pass, and the 26 controls still fail through it | `probe run` | the controls themselves; a control that passes is a finding |
| P6 | The evidence is the run: the file names the Worker's compatibility flags, the PostgreSQL version of the origin, the caching setting and the rounds, and holds the suite's raw lines; no identifier, hostname or secret | `probe record` and a test that scans the file | a fixture with a hostname or a token-shaped string is refused |
| P7 | A measured cell is backed by its evidence: the file exists, names the operation, has a passing line for each falsifier | `support.test.ts` | point a cell at a missing file; remove a falsifier's line |
| P8 | Teardown is complete and checked by name: the Worker and the Hyperdrive configuration are absent from the account, the token file and the Neon string file are deleted | `probe down`, `probe status` | `status` after `up` lists both; after `down` lists none |
| P9 | `bun run ready` exits 0 on the head, and CI passes | `ready`, CI | the controls above |

## Risks

| Risk | Mitigation |
| --- | --- |
| The Free plan allows 10 ms of CPU per request; a long WebSocket session may exceed it | Find out on the first deploy (the Worker's CPU time is small: it parses, forwards and serialises). If a session is cut, the spec records which plan limit did it, and the run is repeated on a Paid plan only with the operator's approval |
| The OAuth profile `default` has no Hyperdrive scope in its list, and its token had expired | A read-only API call comes first (list Hyperdrive configurations); a 403 stops the run and names the permission to give |
| Hyperdrive's pool is shared between concurrent claimers: a stalled transaction can starve a claim | That is the behaviour under test; the suite's own timeouts and the `within` bounds of spec 0002 turn a hang into a failure |
| A statement through Hyperdrive is slow (a round trip each), and 20-round races multiply it | Rounds default to 20; `PG_OUTBOX_ROUNDS` raises them while the budget allows |
| The result of one run on one day is evidence of that day | The file records the date, the flags and the versions; a cell's note says "measured on <date>" |
| The public Worker URL could be probed by others during the run | A token on every route; the Worker lives for the minutes of the run |
| A leftover resource (a failed `up`, a failed `down`) | `down` is idempotent; `status` checks by name; the Neon branch expires by itself in 24 h |

## Open questions for the operator

None open. Settled by the operator before this spec: the Cloudflare profile (`default`), the Neon branch and its string, the teardown.

## Revisions

- **2026-10-30, plan written** with the first local runs: the suite passes through the twin (40 tests) and `select 1` and a transaction pass under workerd. Alchemy beta.84 does not run with `effect` 4.1.0 (`effect/Crypto`), which is why the stack has its own directory.

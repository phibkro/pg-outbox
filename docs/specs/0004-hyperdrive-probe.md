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
                                                 no SQL of its own, no decisions               caching ENABLED (the default)
```

- **One socket is one Worker invocation and one connection of its binding.** A transaction is a run of statements on one socket, exactly as a Worker holds a client for a transaction. A concurrent claimer is another socket, hence another invocation: a Worker invocation can have only six connections *waiting for response headers* at once (Cloudflare's Workers limits), and the Hyperdrive origin pool is about 20 connections on the Free plan (Hyperdrive's limits), so the race of 20 claimers is 20 invocations and the origin pool is where they meet, as in production.
- **The Worker adds no SQL and decides nothing** (`apps/hyperdrive-probe/src/worker.ts`, `session.ts`): it runs what it is sent and answers rows or a failure with its SQLSTATE. The statements are the core's, the transactions' opening script and retry are `@pg-txmode/core`'s, the control rewrites are applied by the runner before a statement is sent.
- **The client is a `@pg-txmode/pg` `TxClient`** (`src/remote.ts`) of the mode `hyperdrive` over that pool of sockets, so `pgSubject` (spec 0002) and the whole suite run through it as through any other client. `local.test.ts` runs the suite through it over a local twin of the Worker (`src/localTwin.ts`: the same `openSession` on a WebSocket server of this machine) in front of a PostgreSQL 18 of this machine, as part of `bun run test`: a failure there is a failure of the probe, not of Hyperdrive.
- **The disposable database.** The operator made the Neon branch `probe/pg-outbox-<date>` of the project `bold-poetry-64036846` with its own database and role and a **24 h expiry**, and put its direct connection string in a file of mode 0600 (`~/.config/pg-outbox-probe/neon-connection-string`). The probe reads the file by parts, never prints it, and deletes it at teardown; the branch expires by itself. The origin of the Hyperdrive configuration is that direct endpoint (the pooled one is a pooler of its own behind Hyperdrive: catalogue row `pooled-endpoint-behind-hyperdrive`).
- **The infrastructure is two resources** (`deploy/alchemy.run.ts`, Alchemy `2.0.0-beta.84`, `npm view alchemy dist-tags` of 2026-10-30: `latest` beta.84, `next` beta.72): the Worker `pg-outbox-probe` (compatibility date 2026-10-01, flags `nodejs_compat` and `enable_request_signal`, placed next to the Neon region) and the Hyperdrive configuration `pg-outbox-probe` with **caching enabled, Hyperdrive's default**: the library runs behind Hyperdrive as deployed, with its read cache on; the run measures the writes and claims, and whether the reads (`classify`, `stale`, `counts`, `open`, which call `statement_timestamp()`, a function that makes Hyperdrive skip its cache) are ever served stale. A run with the cache off would settle only the writes, and `claimById` follows `classify`, a read. State is a local file. **The stack lives in `apps/hyperdrive-probe/deploy/`, outside the workspace, with its own `package.json` and lockfile**: Alchemy beta.84 imports `effect/Crypto`, which `effect` 4.1.0 (this repository's version) no longer has, so it needs `effect` 4.0.7 (and `@effect/platform-node-shared` 4.0.7, pinned by an override). The repository stays on 4.1.0.
- **Access.** The Worker's address is public. Every route needs the run's token (a random value written to a 0600 file by `up`), carried in `Sec-WebSocket-Protocol` for the socket and for `/health`; a request without it answers 401 and touches no database.
- **The budget.** The Workers Free plan counts every statement through Hyperdrive, cached or not: 100,000 a day (Cloudflare's Hyperdrive pricing). The runner counts each statement before it sends it, keeps the day's count in a file, and **stops at 80,000** with `BudgetExceededError`. The default is 20 rounds of a race, which this spec estimates (and the first local run measures) well under that.

## Constraints and values

- **Nothing is shown that was not run.** A cell stops being `unverified` only for an operation whose falsifiers **all** passed through the Worker, with the raw output recorded and named by the cell. A falsifier that could not run this way is listed, with its operation, and its cells stay `unverified`.
- **One source per fact.** The measured cells are data of the core (`measurements`, next to `coverageGaps`), each naming its evidence file; a test fails when the file is missing, does not show caching enabled, or lacks a passing line for each falsifier of the operation. pg-txmode's catalogue is where the fact belongs, and a follow-up there turns its `unknown` cells into `hyperdrive-probe` cells with the same evidence; until that is merged this repository carries the fact (the same trade as `coverageGaps`).
- **Credentials.** Read by key names and lengths only; never printed, logged, committed or sent to the lead. The Cloudflare one is the operator's scoped API token in a 0600 file (Revisions); the Neon one is the operator's file. Both files are deleted at teardown, and the token expires by itself.
- **Cost and footprint.** One Worker and one Hyperdrive configuration, destroyed afterwards, and checked by name through the Cloudflare API; no R2, KV, queue, DNS or domain. The Free plan's 100,000 queries a day and its 10 ms of CPU per request are limits of the account, not choices of this spec (see Risks).
- **No second copy of the suite.** The app imports `pgSubject` from `packages/pg/test/` and `defineSubjectConformance` from `@pg-outbox/conformance`; it adds a transport and nothing else.
- The app is a private workspace package, `apps/*` is a new category beside `packages/*` and `tools/*`: it depends on libraries and on the harness, nothing depends on it. Its Worker bundle imports `pg` and `zod` only.

## What a passing run settles

The falsifiers that exercise each operation are listed in `exercisedBy` (core). An operation is measured when all of its falsifiers passed through the Worker **with caching enabled**:

| Operation | Falsifiers |
| --- | --- |
| `enqueue` | F1, F14, **F19 (new: ten concurrent transactions enqueue one key; exactly one wins)** |
| `claimById` | F2, F3, F6, F7, F15 |
| `classify` | F2, F4, F6, F7, F15 |
| `claimBatch` | F2, F7 |
| `ack` | F3, F5, F15 |
| `release` | F3, F7, F15 |
| `bury` | F3, F7, F10 |
| `holdClaim` | F3, F4 |
| `markQueued`, `stale` | F9 |
| `cleanup` | F10, F14 |
| `counts` | F10 |
| `open` | F15 (new in this spec: the report of open rows) |

The table is not a claim: `packages/conformance/test/exercised.test.ts` runs each falsifier once and fails when a listed operation's statement was not sent by it (the first draft of this table was wrong in four places, found that way: `F8` sends everything but asserts only a lint, so it is not listed; `open` had no behavioural falsifier at all). F19 and the `open` check of F15 are new in this spec: the suite had no concurrent `ON CONFLICT DO NOTHING` (F14 is sequential), which is the gap the catalogue's own note names, and nothing that asserted what `open` returns. They have controls (`no-dedupe-arbiter-race`: no unique index, so every racer stores a row; `open-lists-settled`) and run on every subject; the suite is now 15 falsifiers and 28 controls, 43 tests per target.

## What is built

| Part | Content |
| --- | --- |
| `apps/hyperdrive-probe/src` | `protocol.ts` (the wire), `session.ts` (the session handler shared by the Worker and the twin), `worker.ts` (the Worker), `localTwin.ts`, `remote.ts` (the `TxClient` over sockets), `budget.ts` (the day's count), `workerd.ts` (the Worker under `wrangler dev`) |
| `apps/hyperdrive-probe/test` | `local.test.ts` (the suite through the twin; part of `bun run test`), `hyperdrive.test.ts` (the suite through a Worker; run only by `probe`), unit tests of the budget and the protocol |
| `apps/hyperdrive-probe/deploy` | `alchemy.run.ts`, its own `package.json` and lockfile |
| `apps/hyperdrive-probe/scripts` | `probe.ts` (`local`, `up`, `run`, `record`, `down`, `status`), `spike.ts` (`select 1` and a transaction under workerd), `wrangler.dev.jsonc` |
| `packages/conformance` | F19 and its control |
| core | `measurements`, `exercisedBy` and `supportGiven`: the lift of an `unverified` cell by recorded evidence |
| `docs/evidence/hyperdrive/` | the raw output of the four runs (two of them failed, and say so in their `Note` row) |
| gates | `packages/pg/test/pgSubject.ts` takes `allowUnverified`; the pooler-fact test and the boundary tests know the new category; the verify skill |

## Falsifiers

| # | Falsifier (must hold) | Gate | Negative control (must fail) |
| --- | --- | --- | --- |
| P1 | The runner, the protocol and the remote client are right: the suite (15 falsifiers, 28 controls, 43 tests) passes through the twin | `local.test.ts` | break the client's transaction (omit `COMMIT`): F1, F5 and others fail |
| P2 | The Worker's own code runs under workerd: `/health`, `select 1` and a transaction answer | `scripts/spike.ts` | a wrong token answers 401; a request without the upgrade answers 426 |
| P3 | The suite passes under workerd (the real Worker code in the Workers runtime; still not Hyperdrive) | `probe local` | as P1 |
| P4 | The budget stops a run before the limit and counts across runs of the day | `budget.test.ts` | a limit of 3 stops the fourth statement; a day's file of yesterday counts as 0 |
| P5 | **Through Hyperdrive**: for each operation, the falsifiers that exercise it pass, and the 28 controls still fail through it | `probe run` | the controls themselves; a control that passes is a finding (run 1 found that the suite's own reads were cached) |
| P6 | The evidence is the run: the file names the Worker's compatibility flags, the PostgreSQL version of the origin, the caching setting and the rounds, and holds the suite's raw lines; no identifier, hostname or secret | `probe record` and a test that scans the file | a fixture with a hostname or a token-shaped string is refused |
| P7 | A measured cell is backed by its evidence: the file exists, names the operation, has a passing line for each falsifier | `support.test.ts` | point a cell at a missing file; remove a falsifier's line |
| P8 | Teardown is complete and checked by name: the Worker and the Hyperdrive configuration are absent from the account, the token file and the Neon string file are deleted | `probe down`, `probe status` | `status` after `up` lists both; after `down` lists none |
| P9 | `bun run ready` exits 0 on the head, and CI passes | `ready`, CI | the controls above |

## Risks

| Risk | Mitigation |
| --- | --- |
| The Free plan allows 10 ms of CPU per request; a long WebSocket session may exceed it | Find out on the first deploy (the Worker's CPU time is small: it parses, forwards and serialises). If a session is cut, the spec records which plan limit did it, and the run is repeated on a Paid plan only with the operator's approval |
| The OAuth profile `default` had no Hyperdrive scope in its list, and its token had expired | Replaced by the operator's scoped API token (Revisions). A read-only API call comes first (list Hyperdrive configurations); a 403 stops the run and names the permission to give. It did, once, and the operator added the group |
| Hyperdrive's pool is shared between concurrent claimers: a stalled transaction can starve a claim | That is the behaviour under test; the suite's own timeouts and the `within` bounds of spec 0002 turn a hang into a failure |
| A statement through Hyperdrive is slow (a round trip each), and 20-round races multiply it | Rounds default to 20; `PG_OUTBOX_ROUNDS` raises them while the budget allows |
| The result of one run on one day is evidence of that day | The file records the date, the flags and the versions; a cell's note says "measured on <date>" |
| The public Worker URL could be probed by others during the run | A token on every route; the Worker lives for the minutes of the run |
| A leftover resource (a failed `up`, a failed `down`) | `down` is idempotent; `status` checks by name; the Neon branch expires by itself in 24 h |

## Open questions for the operator

None open. Settled by the operator before this spec: the Cloudflare profile (`default`), the Neon branch and its string, the teardown.

## Revisions

- **2026-10-30, plan written** with the first local runs: the suite passes through the twin (40 tests) and `select 1` and a transaction pass under workerd. Alchemy beta.84 does not run with `effect` 4.1.0 (`effect/Crypto`), which is why the stack has its own directory.
- **2026-10-30, credentials.** The Alchemy profile `default` was an expired OAuth login without a Hyperdrive scope. The operator stored a scoped API token (Workers Scripts Edit, Hyperdrive Edit, Account Settings Read; one account; expires in 1 to 2 days) in a 0600 file (`~/.config/pg-outbox-probe/cloudflare-api-token`). `probe` reads it by shape and length only, finds the one account it sees with a read-only call, and gives both to Alchemy through `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the child's environment (Alchemy: environment credentials take precedence over any profile), never on a command line. Its first Hyperdrive call answered `403 10000 Authentication error` until the operator added the Hyperdrive group; then `200`, with no configuration and no Worker in the account. `down` deletes the token file and the Neon string file only after `status` shows nothing of the probe in the account.
- **2026-10-30, the run, and what it found.** Four runs of the suite through the deployed Worker (all raw output under `docs/evidence/hyperdrive/`): run 1 failed F1, F5, F7 and F19: the suite's own ground-truth reads (`count`, `stateOf`: a plain `SELECT` of the table) were **served from Hyperdrive's cache**, which says what the catalogue says about reads; they now call `clock_timestamp()` on every target (`fixtures.ts`), and run 1 is evidence for no operation. Run 2 lost one connection of the Worker at F2 ("Connection terminated unexpectedly", cause not established: one run, one occurrence) and every later statement of that socket failed ("not queryable"): a failure without a SQLSTATE now ends the session (`session.ts` closes the socket, the remote client discards it), and run 2 is evidence for no operation. Runs 3 and 4, on the redeployed Worker, passed 43 of 43 (15 falsifiers and 28 controls, 20 rounds of a race, 24 sockets): the first on the new Worker, the second a minute later. Run 4 is the one `measurements` cites.
- **2026-10-30, what the cells say now.** `measurements` (core) holds one entry per operation, through Hyperdrive, naming `docs/evidence/hyperdrive/2026-10-30-pg-outbox-probe.md`; all 13 operations are measured, so `operationSupport(hyperdrive, …)` is `yes` for every one and a process behind Hyperdrive no longer says `allowUnverified`. F12 follows the data: Hyperdrive accepts exactly the operations a recorded run measured, Supavisor (nothing ran) refuses every one; the tests of the adapters that built an outbox on Hyperdrive to see a refusal use Supavisor. The data is named `measurements`, not `measuredOn` (the plan's word). What it does **not** say: that every statement of every use is safe behind Hyperdrive on any plan, any database or any cache setting (one run set: caching enabled, Free plan, one origin region, a direct Neon endpoint, 20 rounds), nor anything about the pooled Neon endpoint behind Hyperdrive, nor `LISTEN` or session advisory locks (excluded by design, F8).
- **2026-10-30, the suite grew.** F19 and the `open` assertion of F15 (see "What a passing run settles"), `exercisedBy` and its test, `Measurement`/`supportGiven` and their tests, and `tools/quality/test/evidence.test.ts` (a recorded run names no Worker address, no database host, no connection string, no 32-digit identifier, apart from the commit row).
- **2026-10-30, CI saw what the author's tree hid.** `checks` failed on the PR: type-aware lint read `apps/hyperdrive-probe/deploy/alchemy.run.ts`, whose imports were `error` types because CI installs the workspace and not `deploy/` (its own manifest, outside the workspace). It passed locally because `deploy/node_modules` existed there. The lint now skips `apps/*/deploy/**` (a reason in `vite.config.ts`); the stack file is formatted and type-checks where it is installed. `bun run ready` was then run in a **fresh clone** (`bun install --frozen-lockfile`, nothing else): exit 0. Also: 22 files of wrangler's local state, tracked by the first commit, are untracked and ignored; the evidence files hold no UUID (a claim token in a failure diff was flagged by gitleaks, and `scrub` replaces UUIDs now).

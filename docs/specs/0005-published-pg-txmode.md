# 0005 pg-txmode from the registry

Status: **spec** (frozen when its PR opens). Date: 2026-10-30. Decided by: spec 0001's named trigger ("Dependency on pg-txmode": when pg-txmode publishes, each `workspace:*` becomes a version range and the submodule goes), and the lead's decisions of 2026-10-30 (pg-txmode publishes `@pg-txmode/harness` as a documented test tool; pg-outbox depends on it as a dependency).
Process: [spec 0000](0000-development-lifecycle.md). Branch `feat/0005-published-pg-txmode` from `main` (`e7e2f3f`).
Depends on: [spec 0001](0001-core.md) ("Dependency on pg-txmode", which this spec carries out), pg-txmode `0.1.0-alpha.0` of `@pg-txmode/core`, `pg`, `effect` and `lint` (published 2026-10-30, provenance attached) and a published `@pg-txmode/harness` (see "Gate on the harness").
Verify skill: `verify-pg-outbox` (path row for the submodule is replaced).

## Problem

pg-outbox builds on pg-txmode through a git submodule at `vendor/pg-txmode`, pinned at `12f1aba`, whose `packages/*` are workspaces here (spec 0001: a stopgap until pg-txmode publishes). The submodule makes a fresh clone need `--recurse-submodules`, makes CI check it out, makes every gate skip `vendor/**`, and repeats pg-txmode's `catalog` in this repository's root manifest. pg-txmode has published `@pg-txmode/core`, `pg`, `effect` and `lint` at `0.1.0-alpha.0`, so the stopgap has run its course.

## Goal

A fresh `git clone` (no submodule) and `bun install --frozen-lockfile` give a tree on which `bun run ready` exits 0, and CI passes without a submodule checkout. Every `@pg-txmode/*` dependency is a version of the registry, nothing of pg-txmode is a workspace, and `vendor/`, `.gitmodules` and the gates' `vendor/**` exceptions are gone.

## Journey

```sh
git clone https://github.com/phibkro/pg-outbox          # no --recurse-submodules
cd pg-outbox
devenv shell -- bun install --frozen-lockfile
devenv shell -- bun run ready
```

Everything is real: the packages come from the npm registry, the tests run on a PostgreSQL 18 and a PgBouncer of this machine through the harness.

## Constraints and values

- **The pin is exact: `0.1.0-alpha.0`, no range.** The published pg-txmode packages pin each other exactly (`@pg-txmode/pg` depends on `@pg-txmode/core` `0.1.0-alpha.0`), and an alpha carries no promise of compatibility between alphas: a range such as `~0.1.0-alpha.0` would accept `alpha.1` and later `0.1.x` unseen, and this repository's catalogue-driven mode check (spec 0001) is exactly what a changed catalogue changes. Moving the pin is a reviewed diff. When pg-txmode reaches a stable `0.1.0`, a `~0.1.0` range is the next choice, and this spec's Revisions say so then.
- **`@pg-txmode/effect` keeps its own Effect range.** It declares peers `effect` and `@effect/sql-pg` at `>=4.1.0 <4.2.0`; `@pg-outbox/effect` declares `effect` at the same range (spec 0003), and the root `catalog` keeps `4.1.0` for both. Nothing here widens it.
- **One source per fact.** No copy of a pg-txmode file: the harness is the one test tool this repository uses, and it comes from the registry too (copying it was rejected: two copies of the harness can drift).
- **The root `catalog` shrinks** to what this repository's own manifests use (`libpg-query` and `@effect/platform-node`, which only pg-txmode's workspaces used, go).
- **`test` and `build` keep `-F '@pg-outbox/*'`.** Every workspace is now this repository's; the filter stays because it names the packages (the app and tools have other scripts) and changing it is not this spec's problem.
- The boundary tests keep their meaning: the core still imports only `@pg-txmode/core` and `zod`; the pooler-fact scan still covers `packages/*/src`.

## Gate on the harness

`@pg-txmode/harness` is private in pg-txmode `12f1aba` and is not on the registry on 2026-10-30 (`npm view @pg-txmode/harness` answers 404). The conformance suite (`startPostgres`, `startStack`, `pgConnect`), the tests of both adapters and the probe use it. **This spec's PR does not open before `@pg-txmode/harness@0.1.0-alpha.x` is published** (pg-txmode's own spec for it is under way); until then this branch carries everything else and the harness manifests name `0.1.0-alpha.0`, which is the version this branch expects and changes if the published one differs. Nothing is merged or opened on a guess.

## What is built

| Part | Content |
| --- | --- |
| manifests | `workspace:*` of `@pg-txmode/{core,pg,effect,lint,harness}` becomes `0.1.0-alpha.0` in `packages/{core,conformance,pg,effect}` and `apps/hyperdrive-probe`; the root `workspaces` lose `vendor/pg-txmode/packages/*`; the root `catalog` loses two unused entries |
| `vendor/pg-txmode`, `.gitmodules` | removed (`git rm`) |
| gates | `knip.json`, `.jscpd.json` and `vite.config.ts` lose their `vendor/**` entries; `.github/workflows/checks.yml` loses `submodules: true` |
| lockfile | `bun.lock` regenerated: the `@pg-txmode/*` entries resolve to the registry |
| docs | `README.md` (clone without `--recurse-submodules`, the Roadmap), `STATE.md`, `AGENTS.md` (stack paragraph), `PROVENANCE.md` (the submodule row becomes a registry dependency), the verify skill (the `vendor/**` path row becomes a row for `package.json`, the lockfile and the pg-txmode pin), spec 0001 (one Revisions entry that points here) |

## Falsifiers

| # | Falsifier (must hold) | Gate | Negative control (must fail) |
| --- | --- | --- | --- |
| S1 | No `workspace:*` names a `@pg-txmode/*` package, none is `workspace:` at all, and every `@pg-txmode/*` dependency in the repository is one exact version (the same everywhere) | a test in `tools/quality/test/` that reads every manifest | a manifest with `workspace:*`, a range, or two different versions is refused |
| S2 | The repository has no submodule: no `.gitmodules`, no `vendor/`, no `submodules:` in the workflow, no `vendor/**` in a gate's config | the same test | a fixture with each is found |
| S3 | `bun install --frozen-lockfile` in a fresh clone (no submodule) succeeds, and every `@pg-txmode/*` entry of `bun.lock` is a registry package (a version, no `workspace:`) | the fresh clone of the journey; the test reads `bun.lock` | a lockfile entry `workspace:` is refused |
| S4 | The full suite passes as before: 15 falsifiers and 28 controls on PostgreSQL directly and behind PgBouncer, through the core, the `pg` adapter and the Effect adapter, with the same counts as on `main` | `bun run test` | none new: the controls are those of specs 0001 to 0004 |
| S5 | `bun run ready` exits 0 on a fresh clone of the head, and CI passes | `ready`, CI | the controls above |

## Constraints on the implementation

The code that uses pg-txmode changes only where the published API differs from `12f1aba`. The published packages are bundles (`index.mjs`, `index.d.mts`), not sources; a type that differs is fixed at its use, never by a cast.

## Risks

| Risk | Mitigation |
| --- | --- |
| The published `0.1.0-alpha.0` differs from `12f1aba` (release commits came after it) | The whole suite runs against the published packages; S4 fails if behaviour moved. A difference found is recorded in Revisions |
| The published harness differs in API from the submodule's | The conformance, adapter and probe tests use `startPostgres`, `startStack`, `pgConnect`, `Session`, `Connect`, `Postgres`, `Stack`; they fail to type-check, not to run, if one moved |
| The lockfile records a registry integrity that the registry later withdraws | An exact pin and a frozen lockfile make the failure loud; a withdrawn version is the operator's and pg-txmode's call |
| A step of the journey needs the harness before it is published | The gate above: the PR does not open until it is on the registry |

## Open questions for the operator

None. The harness publication is pg-txmode's spec; this spec waits for it.

## Revisions

- **2026-10-30, plan written** on the branch while `@pg-txmode/harness` was unpublished; the harness manifests name `0.1.0-alpha.0` as a placeholder for the version that will be published.

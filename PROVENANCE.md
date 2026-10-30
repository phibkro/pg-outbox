# Provenance

The development lifecycle (spec 0000) is copied from [`phibkro/pg-txmode`](https://github.com/phibkro/pg-txmode) at commit `12f1abac1eb9d3ebad7e123a12f56896f896a272` (`main`, 2026-10-29; "pg-txmode"). pg-txmode copied it from [`reebeat/studio`](https://github.com/reebeat/studio) at `d4fd75eaca83b9e8a98f073d5b1d957da5d6b8b8`, which copied it from [`reebeat/reebeat`](https://github.com/reebeat/reebeat) at `f7c348877585f54b6bf00651608726dd7e5044d3`, which adapted most of it from [`phibkro/vektorprogrammet-reimagined`](https://github.com/phibkro/vektorprogrammet-reimagined) at `797e9e41d96194b9479ff224ac1c40bbc0545888` and `1104c3019a76c619c4c8e9ee04c71ce191467ed4` (the donor); the headers that name them were kept. Third-party licences stay with their code.

**Identical** means the file's git blob hash equals pg-txmode's at `12f1aba`, checked with `git hash-object <file>` against `git rev-parse 12f1aba:<file>` in a pg-txmode checkout (the hash list is in spec 0000's PR body).

| File | Source (pg-txmode `12f1aba`) | Deviation |
| --- | --- | --- |
| `.vite-hooks/pre-commit`, `commit-msg`, `pre-push` | same paths | identical |
| `commitlint.config.ts`, `devenv.yaml`, `devenv.lock`, `CLAUDE.md`, `.jscpd.json`, `tsconfig.json` | same paths | identical |
| `.agents/skills/review-pr/merge.sh`, `record-round.sh` | same paths | identical |
| `.agents/skills/review-pr/SKILL.md`, `reviewers.md`, `.agents/skills/pr-create/SKILL.md` | same paths | adapted: the repository's names; the verify skill is `verify-pg-outbox`; the vocabulary points at spec 0001; a claim about a pooler must cite its pg-txmode catalogue row |
| `.agents/skills/verify-pg-outbox/scripts/headroom.sh`, `lib.sh` | `.agents/skills/verify-pg-txmode/scripts/` | adapted: names, headers and the evidence root `~/.local/state/pg-outbox-verify`; the demand figures and the four limits are pg-txmode's |
| `.agents/skills/verify-pg-outbox/SKILL.md` | `.agents/skills/verify-pg-txmode/SKILL.md` (shape only) | new text: headroom, gates, path table; spec 0001 adds the conformance and model sections |
| `.github/workflows/checks.yml` | same path (spec 0000 version, `f5efb53`) | the header only; commands and pins are the same (spec 0001 adds the submodule checkout and the model step) |
| `package.json` | same path (spec 0000 version) | name; `catalog` cut to what spec 0000 uses |
| `vite.config.ts` | same path (spec 0000 version) | the restricted source paths name `@pg-outbox/` and `@pg-txmode/` |
| `.gitleaks.toml` | same path | the title |
| `knip.json` | same path (spec 0000 version) | none |
| `devenv.nix` | same path (spec 0000 version) | one comment names the conformance harness of spec 0001 instead of the probe harness |
| `AGENTS.md` | same path | gates, stack and emergency command rewritten for this repository; the pooler-fact gate covers every package |
| `docs/specs/0000-development-lifecycle.md` | pg-txmode's spec 0000 | rewritten: it records what is the same, what differs and why |
| `tools/quality/checkExceptions.ts`, `exceptions.json`, `tsconfig.json`, `vite.config.ts`, `test/exceptions.test.ts`, `test/recordRound.test.ts` | same paths | identical |
| `tools/quality/exceptions.ts`, `package.json`, `test/headroom.test.ts`, `test/scriptHarness.ts` | same paths | names only (`@pg-outbox/quality`, `verify-pg-outbox`, `pg-outbox-quality-`, comments) |
| `tools/quality/test/effectBoundary.test.ts` | same path | the pooler-fact test covers `packages/*/src`, not only the Effect adapter |

## Licence texts

`LICENSE` is the Apache License 2.0, verbatim from <https://www.apache.org/licenses/LICENSE-2.0.txt> (SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`, 2026-10-29). `NOTICE` names the copyright holder.

## Added by spec 0001

| File | Source | Deviation |
| --- | --- | --- |
| `vendor/pg-txmode` | [`phibkro/pg-txmode`](https://github.com/phibkro/pg-txmode) `12f1abac1eb9d3ebad7e123a12f56896f896a272` (Apache-2.0, the operator's), a git submodule | a stopgap until pg-txmode publishes (spec 0001, "Dependency on pg-txmode"); its `packages/*` are workspaces here, and its root `catalog` is repeated in this `package.json` |
| `.github/workflows/checks.yml` | as in spec 0000 | `submodules: true` and the step `bun run model` |
| `vite.config.ts`, `knip.json`, `.jscpd.json` | as in spec 0000 | the submodule is ignored (`vendor/**`); knip's `catalog` check is off (the vendored manifests use the entries); the lint rules that ask for loops over `await`, no promise constructor and no `.then` are off for `packages/conformance` and tests, as in pg-txmode's `vite.config.ts` for its harness and tests |
| `devenv.nix` | as in spec 0000 | `tlaplus` (TLC 2.19) and `jre8`, with the Java heap capped; vektorprogrammet-reimagined keeps the same two packages in a `formal` profile (`devenv.nix`, `profiles.formal`) |
| `tools/quality/test/effectBoundary.test.ts` | as in spec 0000 | adds the boundary of the core (`@pg-txmode/core` and `zod` only) |
| `tools/quality/test/manifest.ts` | none | original (the schema of a manifest, shared by the two boundary tests) |
| `package.json` | as in spec 0000 | `workspaces` list the submodule's packages; `test` and `build` run only `@pg-outbox/*`; `catalog` is pg-txmode's; script `model` and its place in `ready` |
| `model/ClaimFence.tla`, `cases.json`, `confirmed.json`, `tools/model/*` | none | original. The method (a TLA+ model of the statements, broken variants that TLC must reject, reach cases, a digest of the covered files that fails the run when the code moves) is that of `phibkro/vektorprogrammet-reimagined`'s skill `verify-membership-writes` (`run.sh`, `SKILL.md`, coverage block) at `3aec40b`; no file of it is copied |
| `packages/core/*`, `packages/conformance/*` | none | original. The protocol and its guarantees LS1 to LS5 are those of `phibkro/vektorprogrammet-reimagined` `packages/db/src/repositories/outbox.ts` and `docs/system/store-guarantees.md` at `3aec40b`; the statements are written anew (claim by id, fence by token, hold by `FOR NO KEY UPDATE` are the same constructs), and pg-txmode's `outboxDelivery` pattern (`packages/core/src/patterns.ts` at `12f1aba`) is the other source of the SQL |

## Third-party packages used by spec 0001 (installed, not copied)

| Package | Licence | Used for |
| --- | --- | --- |
| `zod` 4.6.7 | MIT | decoding result rows (`@pg-outbox/core`), the shape of `model/cases.json` (`tools/model`) |
| `pg` 8.23.1, `libpg-query` 18.2.1, `oxc-parser` 0.153.0 | MIT | through pg-txmode's harness and lint (the conformance suite); not dependencies of `@pg-outbox/core` |
| TLA+ tools 1.7.4 (TLC 2.19), OpenJDK 8 | MIT (TLA+ tools), GPL-2.0 with the Classpath Exception (OpenJDK) | the model, from nixpkgs through `devenv.nix`; not redistributed |

## Added by spec 0002

| File | Source | Deviation |
| --- | --- | --- |
| `packages/pg/*` | none | original. It runs the statements of `@pg-outbox/core` over `@pg-txmode/pg` (pg-txmode `12f1aba`, the submodule); the shape (a client of a mode, a transaction as a parameter, no session API on a pooled mode) follows pg-txmode's `packages/pg` |
| `vite.config.ts` | as in spec 0001 | `eslint/require-await` is off, as in pg-txmode's `vite.config.ts` (the same two rules conflict) |
| `tools/quality/test/effectBoundary.test.ts` | as in spec 0001 | adds "an adapter adds no SQL" |

## Added by spec 0003

| File | Source | Deviation |
| --- | --- | --- |
| `packages/effect/src/*` | none | original. It runs the statements of `@pg-outbox/core` over `@pg-txmode/effect` (pg-txmode `12f1aba`, the submodule); the brand pattern of its tagged errors (`Schema.TaggedError<Self, { readonly brand: unique symbol }>`) and the use of `TxClient.transaction` follow pg-txmode's `packages/effect/src` |
| `packages/effect/tsconfig.json` | phibkro/pg-txmode `12f1aba`, `packages/effect/tsconfig.json` | the Effect language service's diagnostics as errors, the same list; `allowedUnstableApis` names the modules this package imports |
| `packages/effect/vite.config.ts` | phibkro/pg-txmode `12f1aba`, `packages/effect/vite.config.ts` | the test timeouts are those of this repository's other packages (hooks 120 s, tests 300 s; pg-txmode's are 60 s), because each test file starts PostgreSQL and PgBouncer |
| `packages/effect/test/stack.ts` | the pattern of pg-txmode's `packages/effect/test/stack.ts` (a throwaway server as a layer) | one PostgreSQL, no pooler (the pooled suite starts its own through `@pg-txmode/harness`) |
| `vite.config.ts` | as in spec 0002 | the Oxlint Effect plugin (`@phibkro/oxlint-effect-plugin` 0.2.0, as in pg-txmode) with its groups for `packages/effect/**`; overrides for the tagged-error file and, for one test module, four `anti-slop` rules (the reason is in the file) |
| `package.json`, `.github/workflows/checks.yml` | as in spec 0002 | `@effect/tsgo` and the Oxlint Effect plugin as root devDependencies; script `check:effect` in `ready`; the CI step "Effect diagnostics" |
| `vite.config.ts` (rule overrides) | as above | five rules are off for `packages/effect/**` (round 1 of spec 0003 records them; the reason of each is in the file): `eslint/func-names` (30 errors without the override; `Effect.gen(function* () {})` is anonymous), `typescript/promise-function-async` (29; the language-service diagnostic `asyncFunction` forbids `async`), `unicorn/no-array-method-this-argument` (5; it misreads Effect's data-first `Array.every(xs, fn)`), and for `src/errors.ts` only `eslint/max-classes-per-file` (1) and `unicorn/throw-new-error` (4: a `Schema.TaggedError` body reads as a throw site). Rule settings, not suppression directives |
| `.agents/skills/verify-pg-outbox/scripts/mutate-effect.sh` | none | original: applies each mutation of spec 0003 to `packages/effect/src`, runs its check, restores the file |
| `knip.json` | as in spec 0002 | a workspace entry for `packages/effect`; `@effect/language-service` is ignored as a dependency (it is the plugin named in `tsconfig.json`), as in pg-txmode's `knip.json` |

Third-party packages used by spec 0003 (installed, not copied): `effect` 4.1.0, `@effect/sql-pg` 4.1.0, `@effect/vitest` 4.1.0 (MIT); `@effect/tsgo` 0.63.0 and `@phibkro/oxlint-effect-plugin` 0.2.0 (the operator's, as in pg-txmode).

## Added by spec 0004

| File | Source | Deviation |
| --- | --- | --- |
| `apps/hyperdrive-probe/src/*`, `test/*`, `scripts/probe.ts` | none | original. The shape (the Worker's only database address is the binding; a client is opened inside the handler; the runner compares) is that of pg-txmode's `docs/wizard/hyperdrive-probe.md` at `12f1aba`; the compatibility flags and the placement next to the database follow the recorded run in `docs/evidence/hyperdrive/vektorprogrammet-reimagined-0000-results.md` |
| `apps/hyperdrive-probe/deploy/alchemy.run.ts` | the Hyperdrive configuration and Worker declarations of `phibkro/vektorprogrammet-reimagined` `apps/web/alchemy.run.ts` at `1104c30` | one Worker and one Hyperdrive configuration only; local state; its own manifest and lockfile (Alchemy `2.0.0-beta.84` with `effect` 4.0.7) |
| `apps/hyperdrive-probe/scripts/wrangler.dev.jsonc` | Cloudflare's `wrangler` configuration format | a local Hyperdrive binding for the workerd run |
| `vite.config.ts`, `knip.json`, `.gitignore`, `package.json` | as in spec 0003 | the new category `apps/*` (workspaces); the app's promise-rule override (a promise per socket event); knip's workspace entry; `.probe/` and `.alchemy/` ignored |
| `tools/quality/test/effectBoundary.test.ts` | as in spec 0003 | scans `apps/` too; an app's `deploy/` directory may import Effect (Alchemy) |

Third-party packages used by spec 0004 (installed, not copied): `ws` 8.22.0 (MIT), `wrangler` 4.156.0 through `bunx` (Apache-2.0 or MIT), `@cloudflare/workers-types` 5.20261030.1 (Apache-2.0 or MIT), and in `deploy/`: `alchemy` and `@alchemy.run/cloudflare` 2.0.0-beta.84 (Apache-2.0), `effect` 4.0.7 (MIT).

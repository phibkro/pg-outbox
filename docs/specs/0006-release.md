# 0006 Publish `@pg-outbox/*` pre-releases to npm

Status: **spec** (frozen when its PR opens). Date: 2026-10-30. Decided by: the operator's decision D1 (publishing pg-outbox is approved; a separate npm organisation `pg-outbox`, owned by `phibkro`; the GitHub environment `npm-release` with the secret `NPM_TOKEN` exists on `phibkro/pg-outbox`, and the operator tested the token locally for the organisation), relayed by the lead on 2026-10-30.
Process: [spec 0000](0000-development-lifecycle.md). Stacked on the branch of [spec 0005](0005-published-pg-txmode.md) (pg-txmode from the registry), which is open as PR #8. Copies the **final** pattern of `phibkro/pg-txmode` specs 0006 and 0007 (`main` at `23be53c`), including the lessons of its review rounds; [`PROVENANCE.md`](../../PROVENANCE.md) lists what was copied and how it differs.
Depends on: [spec 0001](0001-core.md), [0002](0002-pg-adapter.md), [0003](0003-effect-adapter.md) (the packages), [0004](0004-hyperdrive-probe.md) (the measured Hyperdrive `yes` the READMEs describe), [0005](0005-published-pg-txmode.md) (the exact pg-txmode pin).
Verify skill: `verify-pg-outbox` (updated in this PR: a path-table row for the release files).

## Problem

The packages exist only in this repository: every manifest says `private`, `exports` point at `.ts` sources, and nothing builds what a consumer installs. Nobody can install the outbox.

## Goal

A maintainer runs one workflow on `main`, after a version commit, and three packages appear on npm as `0.1.0-alpha.N` under the dist-tag `alpha`, built (ESM and declarations), with a provenance attestation, published by GitHub Actions. **This PR publishes nothing and bumps no version** (every version stays `0.0.0`); the version commit is the next PR.

```text
bun run release:stage            builds packages/<name>/dist for the three published packages and refuses anything that should not ship
bun run release:version          changeset version: 0.1.0-alpha.N in lockstep, a CHANGELOG.md per package   (the next PR)
Actions > Release > Run workflow  mode=check    dry-run publish of each package, the token's identity and reach; publishes nothing
                                  mode=publish  npm publish of each dist, --tag alpha
npm i @pg-outbox/core@alpha @pg-outbox/pg@alpha @pg-outbox/effect@alpha
```

## Journey

```sh
git checkout feat/0006-release
devenv shell -- bun install --frozen-lockfile
devenv shell -- bun run release:stage                         # three dist directories, a clean tarball listing, every import declared
cd /tmp && npm publish <repo>/packages/core/dist --dry-run --tag alpha --access public     # outside the repository, see "Decisions"
cd tools/quality && devenv shell -- bunx vp test run          # the token, mode, hold and manifest rules and their controls
```

Then read [`docs/evidence/release/README.md`](../evidence/release/README.md): the three tarballs installed from a local registry, used and type-checked, and the version-and-publish path run against it.

## Decisions

### Which packages are published

| Package | Published | Why |
| --- | --- | --- |
| `@pg-outbox/core` | yes | The protocol as statements and types, the migration, the mode check, `measuredUnder`. One entry. Depends on `@pg-txmode/core` (exact) and `zod` (`^4.6.7`). |
| `@pg-outbox/pg` | yes | The node-postgres adapter. Its declarations name types of `@pg-txmode/pg`, which ships `@types/pg` itself, so this package needs no `@types/pg` of its own; `importFindings` fails the stage if a declaration ever imports a package whose types are not shipped. |
| `@pg-outbox/effect` | yes | The Effect adapter. `effect` is a peer at `>=4.1.0 <4.2.0`: the adapter uses `@stability unstable` modules (its `tsconfig.json` lists them in `allowedUnstableApis`), which may break in a minor release; a caret would admit 4.2. `release.test.ts` fails an unbounded peer. `@pg-txmode/effect` brings its own peers (`effect`, `@effect/sql-pg`, the same range) and is an exact dependency; this package does **not** repeat `@effect/sql-pg` as a peer, because it imports nothing from it (a consumer needs it to build the layers of `@pg-txmode/effect`, which the README says). |
| `@pg-outbox/conformance` | **no** | The suite is a test tool: it imports `vite-plus/test`'s `expect`, starts PostgreSQL and PgBouncer through `@pg-txmode/harness` and is written for this repository's runner. Publishing it would make its test-runner and harness dependencies a consumer's concern, and nobody has asked to run it. Its results are public as evidence (`docs/evidence/`), and the source is in the repository. Revisit when someone needs to run the suite against a client of their own. |
| `@pg-outbox/hyperdrive-probe` (`apps/`) | no | An app: it needs the operator's accounts. |
| `@pg-outbox/quality` | no | Repository tooling. |
| `@pg-txmode/harness` | **not published by this repository** | pg-txmode publishes it (its spec 0007); this repository depends on it as a development dependency (spec 0005) and ships nothing of it. |

The set has one source: a package is published when its manifest has no `"private": true` (the Changesets rule). `release.test.ts` fails when the Changesets `fixed` group differs from that set, when the private workspace packages are not exactly the conformance suite, and when a published package depends on one that is not published.

### Versioning: Changesets 3.0.3, pre mode `alpha`, lockstep, first `0.1.0-alpha.0`

`@changesets/cli` is pinned exactly and **only versions** (`changeset version`); it does not publish (pg-txmode's Revisions 5: `changeset publish` stops tagging `alpha` after the first release). `.changeset/pre.json` (committed) is `{ "mode": "pre", "tag": "alpha" }`; one `fixed` group holds the three packages, so they share a version, and every internal dependency in a shipped manifest is that exact version. `privatePackages` is `{ tag: false, version: false }`: the conformance suite, the app and the tooling keep `0.0.0`. No git tags are created. The version commit is the next PR; this one leaves every version at `0.0.0`.

Rehearsed in a scratch copy and a local registry (evidence section 4): one changeset file gave `0.1.0-alpha.0` to the three packages and left the rest at `0.0.0`; `bun install --frozen-lockfile` passed with no lockfile change; the real `Publish` step published the three under `alpha`, core first, and a re-run said `is on the registry: skipped` for all three.

**The pg-txmode dependency is not lockstep with this repository.** `@pg-txmode/*` stays at `0.1.0-alpha.1` in every shipped manifest (exact: spec 0005 explains why a range is wrong for an alpha), whatever version pg-outbox has. A change of the pg-txmode pin is a reviewed change of every manifest and the lockfile, and a changeset for the three packages.

### The stage step: `dist` is the package root

`bun run release:stage` (`tools/quality/stagePackages.ts`, rules in `release.ts`), copied from pg-txmode, for each published package:

1. `vp pack <exports> --dts --out-dir dist` (tsdown): one `.mjs` and one `.d.mts` per entry. Dependencies and peers stay external.
2. Writes `dist/package.json` from the source manifest: `exports` as `{ types, default }` (in that order), `workspace:*` rewritten to the exact version (lockstep) and `catalog:` to a caret on the catalog's version (`zod`), `repository` (`type`, `url` and `directory`, as npm's trusted publishing matches them exactly), `homepage` (`https://github.com/phibkro/pg-outbox#readme`: this is a personal repository, not an organisation's site), `bugs`, `publishConfig: { access: "public" }`. Any other `workspace:` or `catalog:` form, a missing licence or description, an export that is not `./src/*.ts`, or two exports that build to one name **fail** the stage. `devDependencies` and `scripts` do not ship, and no `engines` field.
3. Copies `LICENSE` and `NOTICE`, copies the package's own `README.md` (each of the three has one; a package without one gets a generated two-line README), and copies `CHANGELOG.md` when Changesets wrote one.
4. Runs `npm pack --dry-run --json` on a copy and **fails on any file that is not** `*.mjs`, `*.d.mts`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` or `NOTICE`.
5. Fails when a built file or a source file imports a package that the manifest neither depends on nor has as a peer, and when a declaration imports a package whose types are a development-only `@types/*`.

Each source manifest has `publishConfig: { access: "public", directory: "dist" }` and a `prepublishOnly` that exits 1 with the instruction, so a hand-run `npm publish` in the source directory cannot ship sources (a test runs each script). `npm` stops in any directory below a root `package.json` whose `devEngines.packageManager` names another tool (`EBADDEVENGINES`); the `check` job runs its dry run from `$RUNNER_TEMP` and the `publish` job removes `devEngines` from the runner's checkout with `jq` before it publishes (the checkout is discarded).

`release:stage` is in `ready` and in CI (a `Stage release packages` step of `checks.yml`): a manifest that cannot ship fails every PR, not only a release.

### The README says what a Hyperdrive `yes` covers

Each published package ships its own `README.md` (`packages/<name>/README.md`, copied by the stage). Each says, in words, what `measuredUnder` and the Hyperdrive measurement of spec 0004 mean: Hyperdrive is `yes` for all 13 operations **under the conditions of one recorded run** (caching enabled, Workers Free, one Worker in `aws:eu-central-1`, 24 sockets, a Neon direct endpoint on PostgreSQL 18.6, 20 rounds, no `LISTEN`, no session lock), what is **not covered** (caching disabled, the pooled Neon endpoint, another plan, region or origin, a long or loaded run), that the measurement carries its date, that the built outbox exposes `measuredUnder` to log, and that Supavisor has no run. A test fails when a published package's README lacks `Hyperdrive`, `measuredUnder`, `caching`, `measured on` or `not covered` (with a control: the generated README says none of them). The README is a derivation of `measurements` in the core and is checked against its words, not generated from it: if the conditions change, the test below fails only on the absence of a word, so the README is a **review item** whenever `measurements` change (the verify-skill row says so).

### The workflow `release.yml`

Copied from `phibkro/pg-txmode`'s `release.yml` at its final state, with the names of this repository. `workflow_dispatch` only, input `mode` (`choice`: `check` or `publish`, default `check`), concurrency group `release`, `permissions: contents: read`. Both jobs run in the environment `npm-release` and only on `refs/heads/main`. That environment exists on `phibkro/pg-outbox` (read on 2026-10-30 with `gh api`: reviewer `phibkro`, deployment branch policy `main`, one environment secret named `NPM_TOKEN`; `gh secret list` shows no repository-level secret).

- **`check`**: checkout, the pinned Nix, Cachix and devenv steps of `checks.yml`, `bun install --frozen-lockfile`, `bun run release:stage`, then `npm publish <dist> --dry-run --tag <tag> --access public` for each package from outside the checkout (the tag is read from `.changeset/pre.json`), the `dist-tags` of each name, then a user npm config file and **one** step with the token: `npm whoami`, `npm access list packages @pg-outbox --json`, `npm org ls pg-outbox --json`, and `result: pass|fail` (fail when `npm whoami` fails). It prints no value of the token, cannot print its expiry, and says that write access is not shown. **A dry run does not authenticate**: only the first real publish proves the token may create packages in the organisation.
- **`publish`**: `id-token: write`, `NPM_CONFIG_PROVENANCE=true` (a publish that cannot produce provenance fails instead of publishing without it); checkout, **Release hold**, the `checks` check-run of the commit must be `success`, Nix and devenv, `bun install --frozen-lockfile`, npm at least 11.5.1, `release:stage`, the npm config file, removal of `devEngines` from the checkout, then **`Publish`**: for each `packages/*/dist` (alphabetical: `core`, `effect`, `pg`, so core is first), `npm view <name>@<version>` and: success means skipped; output with `E404` means `npm publish ./packages/<name>/dist --tag <tag> --access public`; any other `npm view` failure prints its output and stops with nothing published for that package. `<tag>` is the tag of `.changeset/pre.json` while its mode is `pre`, else `latest`. Changesets is not used to publish.

The token is **declared once** (`secretspec.toml`, the name `NPM_TOKEN`, the environment secret of `npm-release`) and **read once** (`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` in one step of a job); it reaches npm through `$RUNNER_TEMP/npmrc`, which holds `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` (single-quoted: npm expands it, the shell does not). The value is never written to a file or a `run` body. OIDC stays the target: npm tries trusted publishing first and uses the token only when the package has no trusted publisher, so configuring one needs no workflow change ([npm: trusted publishing](https://docs.npmjs.com/trusted-publishers): npm CLI 11.5.1 or later and Node 22.14.0 or later). The workflow file name `release.yml`, the environment name `npm-release` and the `repository.url` of every shipped manifest (`git+https://github.com/phibkro/pg-outbox.git`, matched by npm exactly) are what npm matches.

**A deadline.** [npm: about access tokens](https://docs.npmjs.com/about-access-tokens) says that publishing new versions directly with a granular access token "will be removed in **January 2027**" (as quoted in pg-txmode's spec 0006, read there on 2026-10-30; not re-read for this spec). The token path is a bridge of weeks; trusted publishing is the next spec.

### The release hold: mechanism kept, no hold file

The `Release hold` step of `publish` stays (the step, its tests and the rule that nothing but the checkout may precede it are unchanged): while `.github/release-hold` exists nothing after it runs. **This PR adds no hold file**: publishing is approved by the operator (D1), `publish` still needs the reviewer of the environment `npm-release` (`phibkro`) to approve each run, only `main` can run it, and the `checks` run of the commit must be green. Another gate would stop nothing that those four do not. A hold can be put back by adding the file. Merging a PR publishes nothing: only a dispatched run in `publish` mode does.

### Gates (rules in code, with a control each)

The rules and their tests are pg-txmode's, run on this repository's manifests and files:

| # | Falsifier | Gate | Control that must fail it |
| --- | --- | --- | --- |
| R1 | Every published package yields a complete manifest: no `workspace:` or `catalog:` left, the licence, `access: public`, `.ts` exports mapped, `types` before `default`; lockstep packages exact, `@pg-txmode/*` one exact alpha, other ranges carets | `release.test.ts`, `release:stage` | `workspace:*` to an unpublished package, an unknown catalog name, `workspace:^`, `catalog:default`, licence `MIT`, a missing description or access, an export `./index.js`, two exports that build to `index.mjs`, a version `workspace:*` |
| R2 | Only built output ships | `release:stage` (`npm pack --dry-run --json`), `strayFiles` | source, tests, maps, build info, nested files, `.npmrc` in a listing |
| R3 | Every import of a built or source file resolves for a consumer | `importFindings` | an undeclared `left-pad`; a declaration importing `pg` whose `@types/pg` is a development dependency |
| R4 | Changesets versions exactly the published set, in lockstep, in pre mode `alpha`; the private workspace packages are exactly the conformance suite; no published package depends on a private one | `release.test.ts` | a private package as a dependency (fixture) |
| R5 | A package that uses unstable Effect APIs bounds its peers below the next minor | `release.test.ts` | a caret, an open `>=4.1.0` (fixtures) |
| R6 | A package cannot be published from its source directory | `release.test.ts` runs each `prepublishOnly` | n/a (the script exits 1) |
| R7 | The token rule: `secretspec.toml` declares exactly one secret, the workflows read exactly that name, only in a job of environment `npm-release`, only as `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` in **one** step; never at workflow or job level, in `run` or `with`, as a literal token or an `_authToken` that is not the variable; a step that holds it does not run a printer from a deny-list (a guard against a slip, not a proof) | `releaseWorkflow.test.ts`, on fixtures and on the real files | a renamed secret, a second declaration, a second step, a literal token, `printenv`, `set -x`, … (pg-txmode's list) |
| R8 | Only `mode=publish` on `main` reaches a publish command; `check` never does (a bare `--dry-run` is the only exemption) | `releaseWorkflow.test.ts` | no mode condition, `npm publish` in `check`, `--dry-run=false`, `--no-dry-run`, a comment `# --dry-run` |
| R9 | The hold stops the publish: the step exists, nothing but the checkout precedes it, no `continue-on-error`, no `if` on it or later; the real step's script, run in two temporary directories, exits 0 without the file and 1 with it | `releaseWorkflow.test.ts` | no hold step, a step before it, `if: always()` |
| R10 | Every release goes to the tag of pre mode: `--tag alpha` while `.changeset/pre.json` is in pre mode (else `latest`), a version the registry has is skipped, a non-E404 `npm view` error stops, the first failure stops, `changeset publish` is never called | `releaseWorkflow.test.ts` runs the real step with stubs for `devenv` and `npm`; evidence section 4 | no `pre.json`, `mode: exit`, a failing publish, a refused name, the step edited to `changeset publish` |
| R11 | The tarballs install, import, run and type-check in a project that is not this repository (and the README's claim holds in them: `measuredUnder(hyperdrive)` has one run with its date and conditions) | evidence file (needs a local registry; not a gate) | `tsc` of an import that does not exist fails (`TS2305`) |
| R12 | Each published package's README says what a Hyperdrive `yes` covers | `release.test.ts` | the generated README says none of the five words |

## Constraints and values

- No Effect outside `packages/effect`; no secret value anywhere in the repository (it is public); no publish by an agent; no `--no-verify`.
- Every claim has a URL or a local measurement; what was not observed is under "Not claimed".
- One source per fact: the published set comes from `private`; the token name from `secretspec.toml`; the repository URL, licence and homepage from the root manifest; the pg-txmode pin from the manifests (spec 0005).
- Dependencies added: `@changesets/cli` 3.0.3 (MIT, root, build time), `yaml` 2.9.1 (ISC) and `smol-toml` 1.9.1 (BSD-3-Clause) in `tools/quality`. [`PROVENANCE.md`](../../PROVENANCE.md) lists them.
- **The package names** `@pg-outbox/core`, `pg` and `effect` were `E404` on the registry on 2026-10-30 (`npm view`, run outside the checkout). The first publish creates them; a name taken in the meantime fails the first `npm publish` with a refusal and the step stops (a re-run after the cause is fixed skips what was published).

## Operator steps (external effects: not done here)

1. Merge this PR. Nothing is published.
2. A separate PR adds one changeset file and runs `bun run release:version`: `0.1.0-alpha.0`, CHANGELOGs, `.changeset/pre/`; it must keep `bun install --frozen-lockfile` green (the rehearsal shows it does).
3. The operator dispatches **Release, `mode=check`** (Actions > Release > Run workflow). Read the result: the dry-run listing of three packages, the `dist-tags` lines (`not on the registry yet`), the token's user, and whether `npm access list packages @pg-outbox` and `npm org ls pg-outbox` can read.
4. The operator dispatches `mode=publish` and approves the environment: the first publish of each name creates it. If it fails with E403 or E404 the token lacks permission to create packages in the organisation; that is not checked here. **Afterwards**: read `npm view @pg-outbox/<name> dist-tags` for each package (`check` prints it too) and decide whether `latest` should stay on `0.1.0-alpha.0` (pg-txmode observed that npm sets `latest` on the first publish even with `--tag alpha`; the READMEs say so).
5. Later: configure trusted publishers (a separate spec), then remove the token path (pg-txmode's spec 0006 has the removal checklist; it applies here with the names changed).

## Not claimed

- Anything about the real registry: that the `@pg-outbox` organisation exists with the token's permission, that provenance and OIDC work for this repository, that npm sets `latest` on a first publish here as it did for pg-txmode (the local registry did).
- That `engines`, Node 22 or Bun consumers work: the evidence is Node 24 and npm 11.
- Browser or workerd use of the published packages (the Hyperdrive evidence is a Worker that talks to the suite over a socket; nothing here ran the published packages inside one).
- The `check` and `publish` jobs as Actions runs: they are read and tested as text and scripts, not dispatched.
- Stable (`latest`) releases and `changeset pre exit`.

## Risks

- **The first publish is the only proof of the token's reach.** A real run could publish one name and fail another. The `Publish` step skips a version that `npm view` finds, so a re-run after the token is fixed publishes the rest.
- **`latest` is not ours.** The registry decides it on a first publish; the READMEs tell a consumer to use `@alpha`.
- **The token is a bridge.** It expires, and direct token publishing ends in January 2027.
- **A repository secret named `NPM_TOKEN`** would be shadowed by the environment secret only inside jobs that name the environment; `gh secret list --repo phibkro/pg-outbox` listed none (2026-10-30).
- **Adapters publish against an exact pg-txmode alpha.** A consumer who also installs another `@pg-txmode/*` alpha gets two copies; the READMEs name the pin.
- **`vp pack` is young.** The declarations come from the experimental TypeScript 7 declaration emit; the consumer check (evidence section 3, `skipLibCheck: false`) is the guard.
- **The README's Hyperdrive paragraph can drift from `measurements`.** The test checks five words; the verify skill makes the README a review item when `measurements` change.

## Revisions

- **2026-10-30, plan written** with the build, on the branch of spec 0005 (stacked: this PR is based on it; retarget to `main` when #8 merges).

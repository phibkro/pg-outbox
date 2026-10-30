# Release evidence (spec 0006)

Measured on 2026-10-30 on the branch `feat/0006-release`, with Node 24, npm 11.x, Bun 1.4.2, `@changesets/cli` 3.0.3 and Verdaccio 6.11.1. **Nothing here touched the npm registry for a publish**: the dry runs do not authenticate, and every real publish went to a local [Verdaccio](https://verdaccio.org) on `127.0.0.1:4873` (stopped afterwards by its process id) with a placeholder token that is not a secret. The rehearsal ran in a scratch copy of the tree (`/tmp/rehearse`, its own `git init`), so the branch carries no version change. The raw outputs named below were captured in `/tmp/ev/` of the author's machine; the text of each is quoted here.

## 1. Stage: what ships

```sh
devenv shell -- bun run release:stage
```

```text
$ bun tools/quality/stagePackages.ts
warn: TypeScript 7.0 does not yet have a stable API and is experimental. Some options will be unavailable.   (three times, one per package)
Staged @pg-outbox/core, @pg-outbox/effect, @pg-outbox/pg.
```

Each `packages/<name>/dist` holds `LICENSE  NOTICE  README.md  index.d.mts  index.mjs  package.json` (and `CHANGELOG.md` after a version commit). `packages/pg/dist/package.json`, the manifest that ships (`workspace:*` became the lockstep version; the pg-txmode dependency is the exact alpha of spec 0005):

```json
"dependencies": { "@pg-outbox/core": "0.0.0", "@pg-txmode/pg": "0.1.0-alpha.1" },
"exports": { ".": { "types": "./index.d.mts", "default": "./index.mjs" } },
"repository": { "type": "git", "url": "git+https://github.com/phibkro/pg-outbox.git", "directory": "packages/pg" }
```

After the version commit (section 4), `packages/effect/dist/package.json` has `"dependencies": {"@pg-outbox/core":"0.1.0-alpha.0","@pg-txmode/effect":"0.1.0-alpha.1"}` and `"peerDependencies": {"effect":">=4.1.0 <4.2.0"}`.

## 2. `npm publish --dry-run` of each staged package (`/tmp/ev/dryrun-0006.txt`)

Run from `/tmp`, outside the repository (inside it npm stops with `EBADDEVENGINES`, as in pg-txmode's spec 0006).

```text
== core     name: @pg-outbox/core    package size: 20.6 kB  unpacked size: 71.2 kB  total files: 6   + @pg-outbox/core@0.0.0
== pg       name: @pg-outbox/pg      package size: 7.6 kB   unpacked size: 21.6 kB  total files: 6   + @pg-outbox/pg@0.0.0
== effect   name: @pg-outbox/effect  package size: 10.2 kB  unpacked size: 34.9 kB  total files: 6   + @pg-outbox/effect@0.0.0
```

Each block ends with `Publishing to https://registry.npmjs.org/ with tag alpha and public access (dry-run)`. A dry run does not authenticate: it proves nothing about the token or the right to create the `@pg-outbox` scope.

## 3. The tarballs, installed from the local registry and used (`/tmp/ev/consume-run.txt`)

A fresh project with `.npmrc` pointing at the local registry: `npm install @pg-outbox/core@alpha @pg-outbox/pg@alpha @pg-outbox/effect@alpha effect@4.1.0 @effect/sql-pg@4.1.0 typescript@7.0.2 @types/node` (`added 28 packages`). `node check.mjs` imports every package and asks the shipped code what its README says:

```text
core exports 26 pg 1 effect 9
hyperdrive yes for 13 of 13
measuredUnder(hyperdrive): 1 2026-10-30 "Hyperdrive caching enabled (its default); Cloudflare Workers" ... " disabled, the pooled Neon endpoint, another plan, region or origin, a long or loaded run."
measuredUnder(direct): 0
claimById sql starts: true
```

`tsc -p .` over a file that imports `declareOutbox`, `measuredUnder` and the type `Measurement` from core, `createPgOutbox` from pg and `make`, `InTransaction` from effect, with `"skipLibCheck": false`, `strict`, `nodenext`: no output, exit 0. Negative control (`import { nope } from "@pg-outbox/core"`):

```text
t2.ts(1,10): error TS2305: Module '"@pg-outbox/core"' has no exported member 'nope'.
exit=1
```

## 4. Versioning and the real `Publish` step, against the local registry

In the scratch copy: one changeset file naming the three packages as `minor`, then:

```sh
bunx changeset version        # 0.1.0-alpha.0 for core, effect, pg; the conformance suite and the app stay 0.0.0; CHANGELOG.md each; .changeset/pre/first-alpha.md
bun install --frozen-lockfile # "Checked 320 installs across 472 packages (no changes)": the version commit needs no lockfile change
bun run release:stage         # Staged @pg-outbox/core, @pg-outbox/effect, @pg-outbox/pg.
```

The `Publish` step's `run` text was read from `release.yml` with the `yaml` package and run as it is, with `NPM_CONFIG_USERCONFIG` on a file holding `//127.0.0.1:4873/:_authToken=${NODE_AUTH_TOKEN}`:

```text
first run (/tmp/ev/rehearse-publish1.txt)
@pg-outbox/core@0.1.0-alpha.0 is not on the registry: publishing     npm notice Publishing to http://127.0.0.1:4873/ with tag alpha and public access   + @pg-outbox/core@0.1.0-alpha.0
@pg-outbox/effect@0.1.0-alpha.0 is not on the registry: publishing   (same)   + @pg-outbox/effect@0.1.0-alpha.0
@pg-outbox/pg@0.1.0-alpha.0 is not on the registry: publishing       (same)   + @pg-outbox/pg@0.1.0-alpha.0
re-run (/tmp/ev/rehearse-publish2.txt)
@pg-outbox/core@0.1.0-alpha.0 is on the registry: skipped   (effect, pg likewise)
dist-tags (/tmp/ev/rehearse-disttags.txt)
core {"latest":"0.1.0-alpha.0","alpha":"0.1.0-alpha.0"}   pg (same)   effect (same)
```

Core was published first (alphabetical order), which the adapters' exact dependency on it needs. **Only one release was rehearsed here** (pg-txmode's evidence rehearses two to show that `--tag alpha` keeps moving); the step's text and its tests are pg-txmode's, and `releaseWorkflow.test.ts` runs the real step with stubs for a second release, a partial publish, a refused name and a non-E404 error.

## Not shown

- Anything about the real registry: that the `@pg-outbox` org lets the token create packages, that provenance and trusted publishing work for `phibkro/pg-outbox`, that the registry sets `latest` on a first publish with `--tag alpha` (pg-txmode observed it does: `latest` and `alpha` on the first alpha; the local registry did the same). Provenance cannot be produced outside Actions.
- The `check` job and the `publish` job of `release.yml` as run by Actions: they were read and tested as text and as scripts, not dispatched.
- Node versions other than 24, and Bun, Deno or workerd consumers of the published packages.

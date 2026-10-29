# 0000 Development lifecycle and scaffold

Status: **spec** (frozen when its PR opens). Date: 2026-10-29. Decided by: the operator's decision of 2026-10-29 ("Build the narrow core in its own public repo (phibkro/pg-outbox)", operator log `reebeat-intent-sources/operator-decisions-2026-10.md`, line 112) and the assignment that authorised creating the public repository `phibkro/pg-outbox` (Apache-2.0, Copyright 2026 Philip Bjørknes Krogh).
Binding for: every later PR in this repository. Implemented by the PR that carries this file.
Mirrors: [pg-txmode spec 0000](https://github.com/phibkro/pg-txmode/blob/12f1abac1eb9d3ebad7e123a12f56896f896a272/docs/specs/0000-development-lifecycle.md), which mirrors reebeat's. Read them for the reasons; this file records what is the same, what differs and why.

## Goal

Every change to pg-outbox travels one road: **spec → code → PR**, strictly 1:1, and no change reaches `main` without passing the same gates locally, in CI and in a recorded review round. The road is the one pg-txmode built (Vite+, Oxlint, Oxfmt, Ultracite, gitleaks, commitlint, knip, jscpd, `gh`), copied with provenance, not rewritten. On that road stands the tooling workspace `tools/quality`, whose tests prove the road itself (the exception registry, the review record, the headroom gate, the Effect boundary). The product packages arrive with spec 0001.

## Journey

```text
contributor (human or agent)
  1. write or pick a spec        docs/specs/NNNN-*.md          the plan, its falsifiers, its dated Revisions
  2. branch                      feat/NNNN-<slug>              one spec, one branch, one PR (stacked on the spec below it)
  3. commit                      pre-commit: gitleaks on the staged blobs, then `vp staged` (format and lint --fix)
                                 commit-msg: commitlint (Conventional Commits)
  4. push                        pre-push: the test suite
  5. open the PR                 skill pr-create: the PR body is the report
  6. CI                          .github/workflows/checks.yml runs the same gates as `bun run ready`
  7. review round(s)             skill review-pr: independent reviewers, severity, recorded on the PR
  8. merge                       .agents/skills/review-pr/merge.sh: refuses without a passing record on the head
```

A reader who clones the repository, runs `devenv shell -- bun install` and then `devenv shell -- bun run ready`, sees every gate pass on a clean tree.

## Constraints and values

- Correctness by construction: a gate that can be made structural is structural. `main` cannot be pushed to, a PR cannot be merged without a passing recorded round on its head, a suppression cannot exist without a registry entry, a package other than the Effect adapter cannot depend on Effect, and no package keeps its own copy of a pooler fact.
- One source per fact. The gate list lives in `package.json` scripts (`ready`) and the table in `AGENTS.md` names each script; CI calls the same scripts and never repeats their commands.
- Reuse, do not hand-roll. Every copied file names its source (repository, commit, deviation) in a header or in `PROVENANCE.md`; a file that says "identical" is checked with `git hash-object`.
- **The core does not depend on Effect** (operator, 2026-10-29, carried over from pg-txmode). The tooling is plain TypeScript too, so Effect enters the lockfile only with the Effect adapter package (spec 0003).
- Public repository, Apache-2.0: `LICENSE` is the verbatim text of <https://www.apache.org/licenses/LICENSE-2.0.txt>, `NOTICE` reads `Copyright 2026 Philip Bjørknes Krogh`. No secret, no personal data.
- Default stack as the operator's: TypeScript 7.0.2, Bun, Oxfmt, Oxlint, Vite+ 1.2.0, devenv. Alchemy is not used: there is nothing to deploy.
- Nothing is published to npm: every package is `private` until the operator says otherwise.

## What is built

| Part | Content | Reused from |
|---|---|---|
| Repository | `phibkro/pg-outbox`, public; first commit `9c48c0a` (README, `LICENSE`, `NOTICE`, `.gitignore`) pushed to `main` because the repository was empty; every later change by PR | assignment |
| Toolchain | `package.json` (workspaces `packages/*`, `tools/*`; `catalog` pins), `tsconfig.json`, `devenv.nix` (Bun, Node 24, gitleaks, PostgreSQL 18, PgBouncer), `devenv.yaml`, `devenv.lock` | pg-txmode `12f1aba`: `tsconfig.json`, `devenv.yaml`, `devenv.lock` unchanged; `package.json` and `devenv.nix` adapted |
| Lint and format | root `vite.config.ts`: Oxfmt (Ultracite), Oxlint with Ultracite `core` and `anti-slop`, cognitive complexity at most 15, type-aware | pg-txmode's spec 0000 `vite.config.ts`, adapted (restricted paths name both scopes) |
| Hooks | `.vite-hooks/pre-commit`, `commit-msg`, `pre-push`; `commitlint.config.ts` | pg-txmode, byte for byte |
| Exceptions registry | `tools/quality/exceptions.json` (empty), `exceptions.ts`, `checkExceptions.ts` and their test | pg-txmode's (plain TypeScript, zod) |
| Effect boundary | `tools/quality/test/effectBoundary.test.ts`, with the pooler-fact test widened to every `packages/*/src` | pg-txmode's, adapted |
| Secrets, dead code, duplication | `.gitleaks.toml` (default rules), `knip.json`, `.jscpd.json` | pg-txmode's |
| CI | `.github/workflows/checks.yml`: pull requests and push to `main`; pinned devenv; one step per gate; actions pinned by commit | pg-txmode's spec 0000 version, header only |
| Skills | `.agents/skills/review-pr/` (`SKILL.md`, `reviewers.md`, `record-round.sh`, `merge.sh`), `.agents/skills/pr-create/SKILL.md`, `.agents/skills/verify-pg-outbox/` (`SKILL.md`, `scripts/headroom.sh`, `scripts/lib.sh`) | pg-txmode; `record-round.sh` and `merge.sh` byte for byte; `headroom.sh` and `lib.sh` renamed; the three `SKILL.md` and `reviewers.md` adapted |
| Tests of the road | `tools/quality/test/recordRound.test.ts` (the Author/Reviewers/Checked rule), `headroom.test.ts` (each gate, with an injected sample) | pg-txmode's, same controls |
| Agent docs | `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md` only), `STATE.md`, `PROVENANCE.md`, `README.md` (roadmap) | pg-txmode's `AGENTS.md`, adapted |
| One command | `bun run ready` = `check`, `check:exceptions`, `test`, `build`, `knip`, `cpd`, `secrets` | pg-txmode |
| Branch protection | `main`: pull request required (administrators included, no approving reviews), required status check `checks`, no force push, no deletion | `gh api -X PUT repos/phibkro/pg-outbox/branches/main/protection`, the same body as pg-txmode's (read with `gh api repos/phibkro/pg-txmode/branches/main/protection`) |

### Not copied from pg-txmode

`packages/*` (the catalogue, lint, harness and adapters are pg-txmode's; this repository depends on them from spec 0001), the README catalogue table and its `check:docs` gate, the Effect language-service gate (`check:effect`) and the Oxlint Effect plugin (they arrive with the Effect adapter, spec 0003), `docs/evidence`, `docs/wizard`.

## Falsifiers

Each falsifier has a negative control that is run and observed to fail, with the output recorded in the PR body. A control is a deliberate defect applied to a scratch copy or a throwaway branch and never committed to `main`.

| # | Falsifier (must hold) | Gate | Negative control (must fail) |
|---|---|---|---|
| F1 | `bun run ready` exits 0 on a clean tree of the PR head | `ready` | F2 to F5, F7, F10 each make `ready` or a hook exit non-zero where it is the gate |
| F2 | A commit message that is not a Conventional Commit is rejected | `commit-msg` | `git commit -m "stuff"` is refused with the commitlint reason; `git commit -m "chore: x"` is accepted |
| F3 | A lint error in a staged file blocks the commit | `pre-commit` (`vp staged`) | Stage a file with `console.log` and an `any` parameter; the commit is refused |
| F4 | A secret in a staged file blocks the commit | `pre-commit` (gitleaks) | Stage a file holding a synthetic key in a well-known format (written only to the scratch copy); the commit is refused |
| F5 | An `oxlint-disable` without a registry entry fails `check:exceptions` | `check:exceptions` | Add `// oxlint-disable-next-line <rule>` without an entry: exits non-zero and names the file and line; remove the directive again: exits 0 |
| F6 | CI runs the gates on every PR and fails when one fails | `checks.yml` | This PR shows a green `checks` run; a throwaway PR with one unused file (a knip violation, which passes every hook) shows a red one (closed, not merged) |
| F7 | A package other than the Effect adapter cannot depend on Effect, and no package names a pooler | effect boundary test | In a scratch copy, add `"effect"` to a package manifest: the test fails and names the manifest; add `mode.pooler === "hyperdrive"` to a file of `packages/core/src`: the test fails and names the file |
| F8 | A PR cannot be merged without a passing recorded round on its current head | `merge.sh`, `record-round.sh` | On the PR: `merge.sh` before any record exits 4; `record-round.sh` refuses a pass whose Author is among the Reviewers (exit 65). The merge itself is not run: this assignment does not merge |
| F9 | `main` cannot be pushed to directly | branch protection | `git push origin HEAD:main` from a scratch clone is rejected by GitHub |
| F10 | Cognitive complexity above 15 fails `vp check` | Oxlint | A scratch function with complexity 16 fails |
| F11 | The headroom gate fails closed on each limit and on an unreadable sample | `headroom.test.ts` | Make a comparison in `headroom.sh` never fire: the test for that gate fails |
| F12 | `LICENSE` is the verbatim Apache-2.0 text | review check (`cmp`) | `cmp LICENSE <(curl -fsSL https://www.apache.org/licenses/LICENSE-2.0.txt)` exits 0 on the head; a one-byte change makes it exit 1 |
| F13 | Every file that says it is identical to pg-txmode's is | review check (`git hash-object`) | the hash of each file in `PROVENANCE.md`'s identical rows equals `git rev-parse 12f1aba:<file>` in a pg-txmode checkout; a one-byte change to a hook makes it differ |

## Constraints on the implementation

- Free on mechanism, specific on behaviour: the scripts may be arranged differently as long as `ready`, `check`, `check:exceptions`, `test`, `build`, `knip`, `cpd` and `secrets` exist and the journey above holds.
- No product code: the protocol, the schema and the harness are spec 0001's.
- Tests use fixtures written to temporary directories; none reads a file outside the repository.

## Risks

| Risk | Mitigation |
|---|---|
| devenv in CI is slow (Nix install, cache misses) | Reuse pg-txmode's pinned devenv and the `devenv` Cachix cache; the first run's time is recorded in the PR |
| Branch protection with administrators included blocks the operator in an emergency | The command that removes it is in `AGENTS.md` |
| A session cannot spawn reviewers | `review-pr` says what then happens: the author opens the PR and reports to the lead, who arranges independent reviewers; the author never records a pass |
| The required check `checks` has not run when protection is set (the repository had no workflow yet) | GitHub accepts a required context by name; it is satisfied by the first run of this PR's workflow, and until then nothing can merge, which is the intended order |

## Open questions for the operator

1. A required human approval, signed commits, Renovate: deferred, as in pg-txmode.
2. The first commit holds only README, licence, NOTICE and `.gitignore`, as in pg-txmode. The assignment said the "first commit = scaffold"; the scaffold travels as this PR instead, so that it is reviewed like every later change. Say so if the scaffold should have been pushed straight to `main`.

## Revisions

Dated entries. A spec is revised only here; its text above is never edited silently after the PR opens. Before the PR opens, the plan may change freely as the build teaches; a change that alters the journey, scope or a falsifier gets an entry anyway.

- **2026-10-29, plan written** with the build: pg-txmode's lifecycle at `12f1aba` copied, names changed, the pooler-fact test widened.

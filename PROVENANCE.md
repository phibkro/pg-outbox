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

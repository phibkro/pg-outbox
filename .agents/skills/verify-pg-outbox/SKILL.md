---
name: verify-pg-outbox
description: "Run and observe pg-outbox the way a user does: check the machine's headroom, run every gate on a clean checkout, and (from spec 0001) run the conformance suite and the TLA+ model. Use when reviewing a pg-outbox PR, when verifying a change, or before a heavy job."
---

<!-- Provenance: adapted from phibkro/pg-txmode @ 12f1abac1eb9d3ebad7e123a12f56896f896a272 (.agents/skills/verify-pg-txmode/SKILL.md),
     which is new text in the shape of reebeat/studio's `verify-studio` @ d4fd75eaca83b9e8a98f073d5b1d957da5d6b8b8. Deviations:
     the repository's names; the probe, lint and stack sections are dropped (this repository has none until spec 0001, which
     adds the conformance and model sections here). The scripts it names are adapted; see PROVENANCE.md. -->

# Verify pg-outbox

A reviewer uses this skill in their own detached worktree (see `review-pr`). The evidence directory is outside every worktree: `~/.local/state/pg-outbox-verify/<UTC date>-<pr or sha>/` (`VERIFY_EVIDENCE_ROOT` overrides it).

## 1. Headroom

```sh
.agents/skills/verify-pg-outbox/scripts/headroom.sh
```

Exit 0 means the operator's four limits hold (memory after the demand, swap-in, memory PSI `full` avg60, load) and the disks have room. On `SHORT`, wait or run a smaller scope; never force a run without saying so in the report.

## 2. The gates

```sh
devenv shell -- bun install --frozen-lockfile
devenv shell -- bun run ready
```

`ready` is the sequence of every gate in `AGENTS.md`. It must exit 0 on the head. Keep its output in the run directory.

## 3. The conformance suite, as a user sees it

```sh
PG_OUTBOX_ROUNDS=300 devenv shell -- bash -c 'cd packages/conformance && bunx vp test run 2>&1 | tee "$EVIDENCE/conformance.txt"'
```

Two files, `direct.test.ts` (PostgreSQL 18) and `pooled.test.ts` (PgBouncer 1.25, transaction mode, Neon's settings, three server connections); each starts its own servers on free ports. Per file: a test per falsifier (`F1 holds: …`), which must pass, and a test per control (`F2 control claimById-no-live-check fails: …`), which passes **when the defect is seen**. Each control prints one line on stderr, `control F2/claimById-no-live-check on PostgreSQL directly: <the first line of the failure>`: read them, a control that fails for a reason other than its defect is a finding. The default is 100 rounds of a race; 300 is the heavy run (about 30 seconds on the author's machine for both files, 2026-10-30). The exit status is the evidence; keep the output.

To see a falsifier fail by hand: remove a condition from a statement of `packages/core/src/sql.ts` (for example ` AND claim_token = $2::uuid` from `ack`): `F3 holds` fails with `expected { _tag: 'Delivered' } to strictly equal { _tag: 'ClaimLost' }`. Restore the file.

## 4. The model

```sh
devenv shell -- bun run model          # every case of model/cases.json through TLC, then the digest of the covered files
devenv shell -- bun tools/model/run.ts --only no-fence   # one case; its trace is printed
devenv shell -- bun tools/model/run.ts --digest          # the digest to record in model/confirmed.json
```

One line per case: `ok` when TLC found what the case expects (`no error`, or `violates <invariant>`), with the number of states and, for a violation, the shortest trace as action names. `DRIFT` means `decode.ts`, `now.ts`, `operations.ts`, `outbox.ts`, `schema.ts` or `sql.ts` of the core changed since `model/confirmed.json`: read `model/ClaimFence.tla` against the diff (each action names its operation with `@operation`), change the model where a statement changed, never weaken an invariant to make a run pass, and record the new digest. The TLC output, the configs and the traces stay in the directory the last line prints.

## 5. Path table

| Changed paths | What to run besides `ready` |
| --- | --- |
| `.agents/**`, `docs/**`, `*.md` only | nothing: these drive no code. Say so in the report |
| `tools/quality/**` | the gate's negative control from `AGENTS.md` ("See it fail") for each gate that the diff touches |
| `.github/**` | read CI's result on the head (`gh pr checks <n>`) |
| `packages/core/src/**` | section 3 with 300 rounds; section 4 (the digest moves with `decode.ts`, `now.ts`, `operations.ts`, `outbox.ts`, `schema.ts`, `sql.ts`); the control of the changed statement by hand |
| `packages/conformance/**` | section 3; for a new or changed control, that it fails for its own defect (its stderr line) and not for malformed SQL |
| `model/**`, `tools/model/**` | section 4, and each broken case of `cases.json` by hand (turn its rule back on in a scratch copy: the case must then find no error) |
| `packages/pg/**` | `PG_OUTBOX_ROUNDS=300 devenv shell -- bash -c 'cd packages/pg && bunx vp test run'` (the suite through the adapter, direct and behind PgBouncer: every test passes, and the 26 controls print their failure lines); the adapter must hold no statement (`tools/quality` fails otherwise) |
| `packages/effect/**` | `devenv shell -- bun run check:effect` (exit 0, no output), and `PG_OUTBOX_ROUNDS=300 devenv shell -- bash -c 'cd packages/effect && bunx vp test run'` (the suite through the adapter, direct and behind PgBouncer, and the 8 Effect tests; 80 tests). By hand, each mutation of spec 0003 (E3 to E6 in its falsifier table): change `packages/effect/src/outbox.ts` as the table says and the named test must fail; and drop `InTransaction` from `enqueue`'s type in `EffectOutbox`: `check:effect` must fail at `outbox.test.ts`. No `async` function, no suppression directive in the package |
| `vendor/**`, `.gitmodules` | `git submodule status` (the pinned commit), `bun install --frozen-lockfile` on a fresh clone with `--recurse-submodules`, then `ready` |
| `devenv.nix`, `devenv.lock` | `devenv shell -- tlc -h` and `devenv shell -- bun run ready` |

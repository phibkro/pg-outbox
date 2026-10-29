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

## 3. Path table

| Changed paths | What to run besides `ready` |
| --- | --- |
| `.agents/**`, `docs/**`, `*.md` only | nothing: these drive no code. Say so in the report |
| `tools/quality/**` | the gate's negative control from `AGENTS.md` ("See it fail") for each gate that the diff touches |
| `.github/**` | read CI's result on the head (`gh pr checks <n>`) |

#!/usr/bin/env bash
# Mutation checks of the Effect adapter (spec 0003): apply one deliberate defect to packages/effect/src, run the check that must
# catch it, print the failing lines, restore the file. Each mutation must make its check exit non-zero; one that does not is
# printed as SURVIVED and the script exits 1.
#
# Usage (inside `devenv shell`, from any directory; the working tree of packages/effect/src must be clean):
#   .agents/skills/verify-pg-outbox/scripts/mutate-effect.sh            # every mutation
#   .agents/skills/verify-pg-outbox/scripts/mutate-effect.sh <name> ... # the named ones
# Environment: PG_OUTBOX_ROUNDS (rounds of a race in the conformance suite, default 10 here).
set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root" || exit 2

outbox=packages/effect/src/outbox.ts
clock=packages/effect/src/clock.ts
tests='cd packages/effect && bunx vp test run 2>&1'
types='bun run check:effect 2>&1'

# name | file | sed expression | check command | what it is
mutations=(
  "enqueue-unguarded|$outbox|s/^      yield\* requireOpen(\"enqueue\");/      yield* Effect.void;/|$tests|enqueue no longer checks that a transaction is open"
  "holdClaim-unguarded|$outbox|s/^      yield\* requireOpen(\"holdClaim\");/      yield* Effect.void;/|$tests|holdClaim no longer checks that a transaction is open"
  "claimById-unguarded|$outbox|s/^      yield\* requireClosed(\"claimById\");/      yield* Effect.void;/|$tests|claimById may run inside a transaction"
  "cleanup-unguarded|$outbox|s/^      yield\* requireClosed(\"cleanup\");/      yield* Effect.void;/|$tests|cleanup may run inside a transaction"
  "ack-ignores-lost|$outbox|s/^        ? yield\* lost(\"ack\", args.id)/        ? undefined/|$tests|ack succeeds when the claim was lost"
  "release-ignores-lost|$outbox|s/^        ? yield\* lost(\"release\", args.id)/        ? { _tag: \"Released\" as const }/|$tests|release succeeds when the claim was lost"
  "clock-default-effect|$clock|s/defaultValue: () => Effect.succeed(databaseNow)/defaultValue: () => effectClock/|$tests|the default clock is Effect's, not the database's"
  "clock-ignored|$outbox|s/^    const at: Effect.Effect<Now> = Effect.flatten(OutboxClock);/    const at: Effect.Effect<Now> = Effect.succeed({ source: \"database\" });/|$tests|OutboxClock is not read"
  "enqueue-type-without-proof|$outbox|s/Effect.Effect<EnqueueResult, SqlError, InTransaction>/Effect.Effect<EnqueueResult, SqlError>/|$types|enqueue's type no longer requires InTransaction"
  "holdClaim-type-without-proof|$outbox|s/Effect.Effect<void, ClaimLost \\| SqlError, InTransaction>/Effect.Effect<void, ClaimLost | SqlError>/|$types|holdClaim's type no longer requires InTransaction"
)

want=("$@")
survived=0
ran=0

for entry in "${mutations[@]}"; do
  IFS='|' read -r name file expression check what <<<"$entry"

  if [ "${#want[@]}" -gt 0 ] && ! printf '%s\n' "${want[@]}" | grep -qx "$name"; then
    continue
  fi

  if ! git diff --quiet -- "$file"; then
    echo "refusing: $file has uncommitted changes; commit or stash them first" >&2
    exit 2
  fi

  sed -i "$expression" "$file"

  if git diff --quiet -- "$file"; then
    echo "== $name: the sed expression changed nothing (a vacuous mutation); fix the script" >&2
    exit 2
  fi

  echo "== $name ($what)"
  out="$(PG_OUTBOX_ROUNDS="${PG_OUTBOX_ROUNDS:-10}" bash -c "$check")"
  code=$?
  git checkout -q -- "$file"

  printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ +× |error TS|Tests  ' | cut -c1-200

  ran=$((ran + 1))

  if [ "$code" -eq 0 ]; then
    echo "SURVIVED $name: the check exited 0 with the defect in place"
    survived=$((survived + 1))
  else
    echo "killed $name (exit $code)"
  fi
done

echo "$ran mutation(s) run, $survived survived"
[ "$survived" -eq 0 ]

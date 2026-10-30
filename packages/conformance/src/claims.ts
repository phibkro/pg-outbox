import { setTimeout as sleep } from "node:timers/promises";

import { expect } from "vite-plus/test";

import type { Env, Falsifier } from "./falsifier.ts";
import {
  at,
  claimAt,
  claimed,
  claimedRow,
  enqueueMany,
  enqueueOne,
  stateOf,
  table,
} from "./fixtures.ts";
import { instantPattern, replacing } from "./mutation.ts";
import type { Subject } from "./subject.ts";

const liveClaim = new RegExp(
  ` AND \\(claimed_until IS NULL OR claimed_until <= ${instantPattern}\\)`,
  "u"
);

const claimers = 20;

const longLease = 60_000;

/** A wrong claim that never comes back empty ends the drain at once, not by timeout. */
const maxClaims = 50;

const drain = async (subject: Subject, limit: number): Promise<string[]> => {
  const ids: string[] = [];

  for (let claim = 0; claim < maxClaims; claim += 1) {
    const batch = await subject.claimBatch({
      leaseMs: longLease,
      limit,
      now: at(),
    });

    if (batch.length === 0) {
      return ids;
    }

    ids.push(...batch.map((row) => row.id));
  }

  throw new Error(`a claim of ${limit} rows never came back empty`);
};

const oneWinnerByRounds = async ({ subject, rounds }: Env): Promise<void> => {
  for (let round = 1; round <= rounds; round += 1) {
    const id = await enqueueOne(subject);

    const results = await Promise.all(
      Array.from(
        { length: claimers },
        async () =>
          await subject.claimById({ id, leaseMs: longLease, now: at() })
      )
    );

    const winners = results.filter((result) => result._tag === "Claimed");
    const others = results.filter((result) => result._tag === "Held");

    expect(
      [winners.length, others.length],
      `round ${round}: ${claimers} claimers of row ${id} gave ${JSON.stringify(results.map((result) => result._tag))}`
    ).toStrictEqual([1, claimers - 1]);
  }
};

const batchesAreDisjoint = async ({ subject, rounds }: Env): Promise<void> => {
  const batchRounds = Math.max(3, Math.floor(rounds / 10));

  for (let round = 1; round <= batchRounds; round += 1) {
    await subject.migrate();

    const ids = await enqueueMany(subject, 30);

    const drained = await Promise.all(
      [3, 5, 7, 11].map(async (limit) => await drain(subject, limit))
    );

    const taken = drained.flat();

    expect(
      taken.toSorted(),
      `round ${round}: four drainers took ${taken.length} rows of 30`
    ).toStrictEqual(ids.toSorted());
  }
};

const skipsLockedRows = async ({ subject }: Env): Promise<void> => {
  await subject.migrate();

  const [first, second] = await enqueueMany(subject, 2);
  const state = { settled: false };

  const waiting = await subject.transaction(async (tx) => {
    await tx.query(`SELECT id FROM ${table} WHERE id = $1::bigint FOR UPDATE`, [
      first ?? "",
    ]);

    const claim = subject
      .claimBatch({ leaseMs: longLease, limit: 1, now: at() })
      .then((rows) => {
        state.settled = true;

        return rows;
      });

    // Without SKIP LOCKED the claim waits for the lock above, which lasts as long as this transaction.
    await sleep(1500);
    expect(
      state.settled,
      "a claim of a locked row must take the next row, not wait"
    ).toBe(true);

    return { claim };
  });

  const rows = await waiting.claim;

  expect(rows.map((row) => row.id)).toStrictEqual([second]);
};

export const oneLiveHolder: Falsifier = {
  controls: [
    {
      describe:
        "claimById without the live-claim condition takes a row that another claim holds",
      id: "claimById-no-live-check",
      mutation: {
        kind: "statement",
        operation: "claimById",
        rewrite: replacing(liveClaim, ""),
      },
    },
    {
      describe:
        "claimBatch without the live-claim condition hands one row to two claimers",
      id: "claimBatch-no-live-check",
      mutation: {
        kind: "statement",
        operation: "claimBatch",
        rewrite: replacing(liveClaim, ""),
      },
    },
    {
      describe: "claimBatch without SKIP LOCKED waits for a locked row",
      id: "claimBatch-no-skip-locked",
      mutation: {
        kind: "statement",
        operation: "claimBatch",
        rewrite: replacing(" SKIP LOCKED", ""),
      },
    },
  ],
  id: "F2",
  run: async (env) => {
    await env.subject.migrate();
    await oneWinnerByRounds(env);
    await batchesAreDisjoint(env);
    await skipsLockedRows(env);
  },
  title: "one live claim per row: of N claimers exactly one holds it",
};

const staleTokenChangesNothing = async ({ subject }: Env): Promise<void> => {
  await subject.migrate();

  const id = await enqueueOne(subject);
  const first = await claimAt(subject, id);
  const second = await claimAt(subject, id, { ms: 1001 });

  expect(second.attempts).toBe(2);

  const before = await stateOf(subject, id);

  expect(
    await subject.ack({ id, now: at(1500), token: first.token })
  ).toStrictEqual({ _tag: "ClaimLost" });
  expect(
    await subject.release({
      attempts: first.attempts,
      errorClass: "timeout",
      id,
      now: at(1500),
      token: first.token,
    })
  ).toStrictEqual({ _tag: "ClaimLost" });
  expect(
    await subject.bury({
      errorClass: "rejected",
      id,
      now: at(1500),
      token: first.token,
    })
  ).toStrictEqual({ _tag: "ClaimLost" });
  expect(
    await subject.transaction(
      async (tx) => await subject.holdClaim(tx, { id, token: first.token })
    )
  ).toStrictEqual({ _tag: "ClaimLost" });
  expect(
    await stateOf(subject, id),
    "a stale token wrote something"
  ).toStrictEqual(before);
  expect(before.token).toBe(second.token);
  expect(
    await subject.ack({ id, now: at(1500), token: second.token })
  ).toStrictEqual({ _tag: "Delivered" });
  expect(
    await subject.ack({ id, now: at(1600), token: second.token }),
    "a repeat ack must change nothing"
  ).toStrictEqual({ _tag: "ClaimLost" });
};

/** A lease that lapsed but that nobody took over still names the current claim: its late ack delivers. */
const lapsedButNotTakenOver = async ({ subject }: Env): Promise<void> => {
  const id = await enqueueOne(subject);

  const only = await claimAt(subject, id, { leaseMs: 100 });

  expect(
    await subject.ack({ id, now: at(5000), token: only.token })
  ).toStrictEqual({ _tag: "Delivered" });
};

export const fence: Falsifier = {
  controls: [
    {
      describe: "ack without the token condition lets a stale worker deliver",
      id: "ack-no-token",
      mutation: {
        kind: "statement",
        operation: "ack",
        rewrite: replacing(
          " AND claim_token = $2::uuid",
          " AND $2::uuid IS NOT NULL"
        ),
      },
    },
    {
      describe:
        "release without the token condition lets a stale worker release",
      id: "release-no-token",
      mutation: {
        kind: "statement",
        operation: "release",
        rewrite: replacing(
          " AND claim_token = $2::uuid",
          " AND $2::uuid IS NOT NULL"
        ),
      },
    },
    {
      describe:
        "bury without the token condition lets a stale worker end the row",
      id: "bury-no-token",
      mutation: {
        kind: "statement",
        operation: "bury",
        rewrite: replacing(
          " AND claim_token = $2::uuid",
          " AND $2::uuid IS NOT NULL"
        ),
      },
    },
  ],
  id: "F3",
  run: async (env) => {
    await staleTokenChangesNothing(env);
    await lapsedButNotTakenOver(env);
  },
  title: "a stale token changes nothing and says ClaimLost",
};

/** B claims at `ms` while A's transaction is open; the claim is `settled` once it has answered. */
const competingClaim = (subject: Subject, id: string, ms: number) => {
  const state = { settled: false };

  const result = subject
    .claimById({ id, leaseMs: longLease, now: at(ms) })
    .then((claim) => {
      state.settled = true;

      return claim;
    });

  return { result, state };
};

const holdBlocksCompetingClaim = async ({ subject }: Env): Promise<void> => {
  const { claim: a, id } = await claimedRow(subject);

  const waiting = await subject.transaction(async (tx) => {
    expect(await subject.holdClaim(tx, { id, token: a.token })).toStrictEqual({
      _tag: "Holding",
    });

    const b = competingClaim(subject, id, 2000);

    await sleep(600);
    expect(
      b.state.settled,
      "a claim of a held row must wait for the holder's transaction"
    ).toBe(false);

    return b;
  });

  const taken = claimed(
    await waiting.result,
    "B's claim after A's transaction ended without an ack"
  );

  expect(taken.attempts).toBe(2);
};

const holdWithAck = async ({ subject }: Env): Promise<void> => {
  const { claim: a, id } = await claimedRow(subject);

  const waiting = await subject.transaction(async (tx) => {
    await subject.holdClaim(tx, { id, token: a.token });
    expect(
      await subject.ack({ id, now: at(1500), token: a.token }, tx)
    ).toStrictEqual({ _tag: "Delivered" });

    const b = competingClaim(subject, id, 2000);

    await sleep(600);
    expect(b.state.settled, "B must wait for A's transaction").toBe(false);

    return b;
  });

  expect(await waiting.result, "B after A delivered").toStrictEqual({
    _tag: "Settled",
  });
};

const staleHold = async ({ subject }: Env): Promise<void> => {
  const { claim: a, id } = await claimedRow(subject);

  await claimAt(subject, id, { ms: 1001 });
  expect(
    await subject.transaction(
      async (tx) => await subject.holdClaim(tx, { id, token: a.token })
    )
  ).toStrictEqual({ _tag: "ClaimLost" });
};

export const hold: Falsifier = {
  controls: [
    {
      describe:
        "a hold that locks nothing (a plain SELECT) lets a competing claim through",
      id: "hold-locks-nothing",
      mutation: {
        kind: "statement",
        operation: "holdClaim",
        rewrite: replacing(" FOR NO KEY UPDATE", ""),
      },
    },
    {
      describe:
        "a hold without the token condition holds whoever's claim it is: a stale hold says Holding",
      id: "hold-no-token",
      mutation: {
        kind: "statement",
        operation: "holdClaim",
        rewrite: replacing(
          " AND claim_token = $2::uuid",
          " AND $2::uuid IS NOT NULL"
        ),
      },
    },
  ],
  id: "F4",
  run: async (env) => {
    await env.subject.migrate();
    await holdBlocksCompetingClaim(env);
    await holdWithAck(env);
    await staleHold(env);
  },
  title:
    "holdClaim keeps the row locked to the end of the transaction; a stale hold says ClaimLost",
};

export const typedAnswers: Falsifier = {
  controls: [
    {
      describe: "a classifier that calls every miss Held",
      id: "classify-always-held",
      mutation: {
        kind: "statement",
        operation: "classify",
        rewrite: replacing("SELECT status,", "SELECT 'pending' AS status,"),
      },
    },
  ],
  id: "F15",
  run: async ({ subject }) => {
    await subject.migrate();

    const { id: live } = await claimedRow(subject);

    expect(
      await subject.claimById({ id: live, leaseMs: 1000, now: at(400) })
    ).toStrictEqual({ _tag: "Held", remainingMs: 600 });

    const { claim: first, id: waiting } = await claimedRow(subject);

    await subject.release({
      attempts: first.attempts,
      errorClass: "timeout",
      id: waiting,
      now: at(0),
      token: first.token,
    });
    expect(
      await subject.claimById({ id: waiting, leaseMs: 1000, now: at(300) })
    ).toStrictEqual({ _tag: "NotDue", dueInMs: 700 });

    const { claim: third, id: delivered } = await claimedRow(subject);

    await subject.ack({ id: delivered, now: at(0), token: third.token });

    for (const settled of [delivered, "999999"]) {
      expect(
        await subject.claimById({ id: settled, leaseMs: 1000, now: at(5000) }),
        `row ${settled}`
      ).toStrictEqual({ _tag: "Settled" });
    }
  },
  title: "the answers of a miss are the truth: Held, NotDue, Settled",
};

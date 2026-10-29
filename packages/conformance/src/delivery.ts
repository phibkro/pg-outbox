import { setTimeout as sleep } from "node:timers/promises";

import { databaseNow } from "@pg-outbox/core";
import { expect } from "vite-plus/test";

import type { Env, Falsifier } from "./falsifier.ts";
import {
  at,
  claimAt,
  claimed,
  claimedRow,
  count,
  enqueueOne,
  RolledBackError,
  stateOf,
  table,
} from "./fixtures.ts";
import { replacing } from "./mutation.ts";
import type { Subject } from "./subject.ts";

const rollsBack = async (
  subject: Subject,
  body: Parameters<Subject["transaction"]>[0]
): Promise<void> => {
  try {
    await subject.transaction(async (tx) => {
      await body(tx);

      throw new RolledBackError("the caller's transaction fails");
    });
  } catch (error) {
    if (!(error instanceof RolledBackError)) {
      throw error;
    }
  }
};

export const transactionalEnqueue: Falsifier = {
  controls: [
    {
      describe:
        "enqueue on a connection of its own: the row survives the rollback (the dual-write gap)",
      id: "enqueue-own-connection",
      mutation: { kind: "ownConnection", operation: "enqueue" },
    },
  ],
  id: "F1",
  run: async ({ subject }) => {
    await subject.migrate();
    await rollsBack(subject, async (tx) => {
      await tx.query("INSERT INTO biz (n) VALUES (1)");
      await subject.enqueue(tx, {
        kind: "Mail",
        now: at(),
        payload: { rolled: "back" },
      });
    });
    expect(await count(subject, "biz"), "the business row").toBe(0);
    expect(await count(subject, table), "the outbox row").toBe(0);

    const stored = await subject.transaction(async (tx) => {
      await tx.query("INSERT INTO biz (n) VALUES (2)");

      return await subject.enqueue(tx, {
        kind: "Mail",
        now: at(),
        payload: { committed: true },
      });
    });

    expect(stored._tag).toBe("Enqueued");
    expect(await count(subject, "biz")).toBe(1);
    expect(await count(subject, table)).toBe(1);
  },
  title:
    "a rolled-back business transaction leaves no row; a committed one leaves one",
};

const ackRollsBack = async ({ subject }: Env): Promise<void> => {
  const { claim, id } = await claimedRow(subject);

  await rollsBack(subject, async (tx) => {
    await tx.query("INSERT INTO biz (n) VALUES (3)");
    expect(
      await subject.ack({ id, now: at(10), token: claim.token }, tx)
    ).toStrictEqual({ _tag: "Delivered" });
  });

  const after = await stateOf(subject, id);

  expect(
    [after.status, after.token],
    "the ack must roll back with the caller's writes"
  ).toStrictEqual(["pending", claim.token]);
  expect(await count(subject, "biz")).toBe(0);
};

const ackCommits = async ({ subject }: Env): Promise<void> => {
  const { claim, id } = await claimedRow(subject);

  await subject.transaction(async (tx) => {
    await tx.query("INSERT INTO biz (n) VALUES (4)");
    await subject.ack({ id, now: at(10), token: claim.token }, tx);
  });
  const delivered = await stateOf(subject, id);

  expect(delivered.status).toBe("delivered");
  expect(await count(subject, "biz")).toBe(1);
};

export const ackJoins: Falsifier = {
  controls: [
    {
      describe:
        "ack on a connection of its own: it survives the caller's rollback",
      id: "ack-own-connection",
      mutation: { kind: "ownConnection", operation: "ack" },
    },
  ],
  id: "F5",
  run: async (env) => {
    await env.subject.migrate();
    await ackRollsBack(env);
    await ackCommits(env);
  },
  title:
    "ack joins the caller's transaction: rolled back with it, committed with it",
};

/** The old relay: the claim itself marks the row delivered, so a crash before the send loses it. */
const claimDelivers = (text: string): string =>
  text
    .replace(
      /SET claim_token = gen_random_uuid\(\), claimed_until = .*?, attempts = attempts \+ 1/u,
      "SET status = 'delivered', settled_at = statement_timestamp(), attempts = attempts + 1 + ($2::int - $2::int)"
    )
    .replace(
      /"outbox"\.claim_token::text AS claim_token/u,
      "'00000000-0000-4000-8000-000000000000' AS claim_token"
    );

export const crashDoesNotLose: Falsifier = {
  controls: [
    {
      describe:
        "a claim that marks the row delivered (the old relay): the crash loses the message",
      id: "mark-at-claim",
      mutation: {
        kind: "statement",
        operation: "claimById",
        rewrite: claimDelivers,
      },
    },
    {
      describe:
        "a claim that never lapses: nothing reclaims the row of a dead worker",
      id: "no-lease",
      mutation: {
        kind: "statement",
        operation: "claimById",
        rewrite: replacing(
          /(?<until>claimed_until = COALESCE\(\$3::timestamptz, statement_timestamp\(\)\)) \+ (?<lease>\$2::float8 \* interval '1 millisecond')/u,
          "$<until> + interval '36500 days' + $<lease>"
        ),
      },
    },
  ],
  id: "F6",
  run: async ({ subject }) => {
    await subject.migrate();

    const id = await enqueueOne(subject);

    // The worker claims and dies before it acks: nothing more is ever called with its token.
    const first = await claimAt(subject, id);

    expect(first.attempts).toBe(1);

    const during = await subject.claimById({ id, leaseMs: 1000, now: at(500) });

    expect(
      during._tag,
      "while the lease is live nobody else gets the row"
    ).toBe("Held");

    const again = await claimAt(subject, id, { ms: 1000 });

    expect(again.attempts).toBe(2);
    expect(again.token).not.toBe(first.token);

    // The same, on the database's own clock and a real lease.
    const real = await enqueueOne(subject, { now: databaseNow });

    claimed(
      await subject.claimById({ id: real, leaseMs: 300, now: databaseNow }),
      "the claim on the database clock"
    );

    const whileLive = await subject.claimById({
      id: real,
      leaseMs: 300,
      now: databaseNow,
    });

    expect(whileLive._tag).toBe("Held");
    await sleep(450);

    const later = claimed(
      await subject.claimById({ id: real, leaseMs: 300, now: databaseNow }),
      "the claim after a real lease lapsed"
    );

    expect(later.attempts).toBe(2);
  },
  title:
    "a worker that claims and never acks does not lose the row: it is claimed again after the lease",
};

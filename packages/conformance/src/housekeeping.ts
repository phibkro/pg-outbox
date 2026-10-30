import { expect } from "vite-plus/test";

import type { Falsifier } from "./falsifier.ts";
import { at, claimed, enqueueOne } from "./fixtures.ts";
import { replacing } from "./mutation.ts";
import type { Subject } from "./subject.ts";

/** A row claimed at `ms` and then given a terminal state at `ms`. */
const settleAt = async (
  subject: Subject,
  id: string,
  ms: number,
  how: "ack" | "bury"
): Promise<void> => {
  const claim = claimed(
    await subject.claimById({ id, leaseMs: 1000, now: at(ms) }),
    `the claim of ${id}`
  );

  await (how === "ack"
    ? subject.ack({ id, now: at(ms), token: claim.token })
    : subject.bury({
        errorClass: "rejected",
        id,
        now: at(ms),
        token: claim.token,
      }));
};

export const sweep: Falsifier = {
  controls: [
    {
      describe:
        "a sweep that ignores the receipt lists the row again at once after it was queued",
      id: "stale-no-receipt",
      mutation: {
        kind: "statement",
        operation: "stale",
        rewrite: replacing("COALESCE(queued_at, created_at)", "created_at"),
      },
    },
  ],
  id: "F9",
  run: async ({ subject }) => {
    await subject.migrate();

    const orphan = await enqueueOne(subject);
    const live = await enqueueOne(subject);
    const done = await enqueueOne(subject);

    claimed(
      await subject.claimById({ id: live, leaseMs: 100_000, now: at(0) }),
      "a live claim"
    );
    await settleAt(subject, done, 0, "ack");

    const sweepAt = async (ms: number) =>
      await subject.stale({ limit: 10, now: at(ms), olderThanMs: 1000 });

    expect(await sweepAt(500), "before the threshold").toStrictEqual([]);
    expect(
      await sweepAt(1500),
      "a pending row with no live claim and no receipt; neither a live claim nor a delivered row"
    ).toStrictEqual([orphan]);
    expect(
      await subject.markQueued({ ids: [orphan, done], now: at(1500) }),
      "the receipt is recorded for pending rows only"
    ).toBe(1);
    expect(
      await sweepAt(1600),
      "right after the receipt the sweep stays quiet"
    ).toStrictEqual([]);
    expect(
      await sweepAt(2600),
      "a threshold after the receipt it lists the row again"
    ).toStrictEqual([orphan]);
  },
  title:
    "the sweep lists a pending row once per threshold: no live claim, no recent receipt",
};

export const retention: Falsifier = {
  controls: [
    {
      describe: "a cleanup that keys on creation time deletes pending rows",
      id: "cleanup-no-status-filter",
      mutation: {
        kind: "statement",
        operation: "cleanup",
        rewrite: replacing(
          "status IN ('delivered', 'dead') AND settled_at",
          "created_at"
        ),
      },
    },
  ],
  id: "F10",
  run: async ({ subject }) => {
    await subject.migrate();

    for (let index = 0; index < 3; index += 1) {
      await settleAt(subject, await enqueueOne(subject), 0, "ack");
    }

    for (let index = 0; index < 2; index += 1) {
      await settleAt(subject, await enqueueOne(subject), 0, "bury");
    }

    await enqueueOne(subject);
    await enqueueOne(subject);

    const held = await enqueueOne(subject);

    claimed(
      await subject.claimById({
        id: held,
        leaseMs: 2_000_000_000,
        now: at(0),
      }),
      "a claim that outlives the cleanup"
    );

    for (let index = 0; index < 2; index += 1) {
      await settleAt(
        subject,
        await enqueueOne(subject, { now: at(4500) }),
        4500,
        "ack"
      );
    }

    const clean = async () =>
      await subject.cleanup({ limit: 3, now: at(5000), olderThanMs: 1000 });

    expect(await clean(), "a batch is bounded by its limit").toBe(3);
    expect(await clean(), "the rest of the old terminal rows").toBe(2);
    expect(await clean(), "nothing left to delete").toBe(0);
    expect(await subject.counts({ now: at(5000) })).toStrictEqual({
      dead: 0,
      delivered: 2,
      pending: 3,
    });
  },
  title:
    "cleanup deletes only terminal rows older than the TTL, a bounded batch at a time",
};

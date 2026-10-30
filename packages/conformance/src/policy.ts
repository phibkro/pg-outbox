import { expect } from "vite-plus/test";

import type { Falsifier } from "./falsifier.ts";
import {
  at,
  claimAt,
  count,
  enqueueOne,
  lastErrorOf,
  rejectionOf,
  statusOf,
  stateOf,
  table,
  tagOf,
} from "./fixtures.ts";
import { instantPattern, replacing } from "./mutation.ts";
import type { ErrorClass, Subject } from "./subject.ts";

const dueDate = new RegExp(` AND next_attempt_at <= ${instantPattern}`, "gu");

const classIsOnRecord = / AND COALESCE\(\$3::text, last_error\) IS NOT NULL/gu;

const attemptsUsedUp = /\(attempts >= \$5::int AND /gu;

const retryDelay = / \+ \$4::float8 \* interval '1 millisecond'/gu;

/** Claims the row at `ms` and gives the claim back: with the class a provider produced, or with none. */
const failAt = async (
  subject: Subject,
  id: string,
  ms: number,
  errorClass?: ErrorClass
) => {
  const claim = await claimAt(subject, id, { leaseMs: 10, ms });

  return await subject.release({
    attempts: claim.attempts,
    errorClass,
    id,
    now: at(ms),
    token: claim.token,
  });
};

const endsOnlyAfterAClass = async (subject: Subject): Promise<void> => {
  // Three attempts are declared. Class on record from the first failure: the third failure ends the row.
  const ending = await enqueueOne(subject);

  expect(await failAt(subject, ending, 0, "timeout")).toStrictEqual({
    _tag: "Released",
  });
  expect(await failAt(subject, ending, 1000)).toStrictEqual({
    _tag: "Released",
  });
  expect(await failAt(subject, ending, 3000)).toStrictEqual({
    _tag: "Buried",
  });
  expect(await stateOf(subject, ending)).toStrictEqual({
    attempts: 3,
    lastError: "timeout",
    status: "dead",
    token: null,
  });
  expect(
    await subject.claimById({ id: ending, leaseMs: 10, now: at(99_000) }),
    "a dead row is never claimed"
  ).toStrictEqual({ _tag: "Settled" });

  // No class ever recorded (an outage on the worker's own side): the attempts are used up and the row still does not end.
  const outage = await enqueueOne(subject);

  for (const [index, ms] of [0, 1000, 3000, 5000, 7000].entries()) {
    expect(
      await failAt(subject, outage, ms),
      `failure ${index + 1} of an outage`
    ).toStrictEqual({ _tag: "Released" });
  }

  expect(await statusOf(subject, outage)).toBe("pending");
};

const buryNeedsAClass = async (subject: Subject): Promise<void> => {
  const id = await enqueueOne(subject);

  const claim = await claimAt(subject, id);

  expect(
    await subject.bury({
      errorClass: "undecodable",
      id,
      now: at(0),
      token: claim.token,
    })
  ).toStrictEqual({ _tag: "Buried" });
  expect(await lastErrorOf(subject, id)).toBe("undecodable");

  // The table itself refuses a dead row with no recorded class.
  const other = await enqueueOne(subject);

  const error = await rejectionOf(
    subject.sql(
      `UPDATE ${table} SET status = 'dead', settled_at = now() WHERE id = $1::bigint`,
      [other]
    )
  );

  expect(error?.code, "a dead row without a class").toBe("23514");
};

const retryDateIsHonoured = async (subject: Subject): Promise<void> => {
  await subject.migrate();

  const id = await enqueueOne(subject);

  await failAt(subject, id, 0, "timeout");
  expect(
    await subject.claimById({ id, leaseMs: 10, now: at(500) })
  ).toStrictEqual({ _tag: "NotDue", dueInMs: 500 });
  expect(
    await subject.claimBatch({ leaseMs: 10, limit: 5, now: at(500) }),
    "claimBatch before the retry date"
  ).toStrictEqual([]);

  const [batched] = await subject.claimBatch({
    leaseMs: 10,
    limit: 5,
    now: at(1000),
  });

  expect(batched?.id, "claimBatch at the retry date").toBe(id);
  expect(batched?.attempts).toBe(2);
};

export const failureClasses: Falsifier = {
  controls: [
    {
      describe:
        "ending a row by attempt count alone: an outage with no class burns it",
      id: "release-no-class-rule",
      mutation: {
        kind: "statement",
        operation: "release",
        rewrite: replacing(classIsOnRecord, ""),
      },
    },
    {
      describe:
        "ending a row by the class alone: the first failure with a class burns it before the declared attempts are used",
      id: "release-no-attempts-rule",
      mutation: {
        kind: "statement",
        operation: "release",
        rewrite: replacing(attemptsUsedUp, "($5::int IS NOT NULL AND "),
      },
    },
    {
      describe:
        "a release that ignores the retry delay makes the row due at once",
      id: "release-no-delay",
      mutation: {
        kind: "statement",
        operation: "release",
        rewrite: replacing(
          retryDelay,
          " + $4::float8 * interval '0 millisecond'"
        ),
      },
    },
    {
      describe: "claimById without the retry date takes a row that is not due",
      id: "claimById-no-due-date",
      mutation: {
        kind: "statement",
        operation: "claimById",
        rewrite: replacing(dueDate, ""),
      },
    },
    {
      describe: "claimBatch without the retry date takes a row that is not due",
      id: "claimBatch-no-due-date",
      mutation: {
        kind: "statement",
        operation: "claimBatch",
        rewrite: replacing(dueDate, ""),
      },
    },
  ],
  id: "F7",
  run: async ({ subject }) => {
    await subject.migrate();
    await endsOnlyAfterAClass(subject);
    await buryNeedsAClass(subject);
    await retryDateIsHonoured(subject);
  },
  title:
    "a class is recorded and the retry date honoured; a row ends only after a class and the declared attempts",
};

export const closedSet: Falsifier = {
  controls: [
    {
      describe:
        "a table without the CHECK on last_error stores whatever text a caller sends",
      id: "no-class-check",
      mutation: {
        kind: "migration",
        rewrite: (statements) =>
          statements.map((statement) =>
            statement.replace(
              /,\n {2}CONSTRAINT \w+_error_class CHECK \(.*\)\n\)/u,
              "\n)"
            )
          ),
      },
    },
  ],
  id: "F13",
  run: async ({ subject }) => {
    await subject.migrate();

    const id = await enqueueOne(subject);

    const error = await rejectionOf(
      subject.sql(`UPDATE ${table} SET last_error = $2 WHERE id = $1::bigint`, [
        id,
        "someone@example.com",
      ])
    );

    expect(error?.code, "an address stored as a failure class").toBe("23514");
    expect(await lastErrorOf(subject, id)).toBeNull();
  },
  title: "last_error holds only a class of the closed set",
};

export const dedupe: Falsifier = {
  controls: [
    {
      describe:
        "no unique index and no conflict target: nothing arbitrates a duplicate",
      id: "no-dedupe-arbiter",
      mutation: {
        kind: "all",
        of: [
          {
            kind: "migration",
            rewrite: (statements) =>
              statements.filter((statement) => !statement.includes("_dedupe")),
          },
          {
            kind: "statement",
            operation: "enqueue",
            rewrite: replacing(
              / ON CONFLICT \(kind, dedupe_key\) WHERE dedupe_key IS NOT NULL/u,
              " ON CONFLICT"
            ),
          },
        ],
      },
    },
    {
      describe:
        "a unique index over pending rows only: a delivered row frees its key before cleanup, against the stated window",
      id: "dedupe-pending-only",
      mutation: {
        kind: "all",
        of: [
          {
            kind: "migration",
            rewrite: (statements) =>
              statements.map((statement) =>
                statement.replace(
                  "WHERE dedupe_key IS NOT NULL",
                  "WHERE dedupe_key IS NOT NULL AND status = 'pending'"
                )
              ),
          },
          {
            kind: "statement",
            operation: "enqueue",
            rewrite: replacing(
              "WHERE dedupe_key IS NOT NULL",
              "WHERE dedupe_key IS NOT NULL AND status = 'pending'"
            ),
          },
        ],
      },
    },
  ],
  id: "F14",
  run: async ({ subject }) => {
    await subject.migrate();

    const send = async (kind: "Hook" | "Mail", dedupeKey?: string) =>
      await subject.transaction(
        async (tx) =>
          await subject.enqueue(tx, {
            dedupeKey,
            kind,
            now: at(),
            payload: {},
          })
      );

    expect(await tagOf(send("Mail", "welcome:1"))).toBe("Enqueued");
    expect(await send("Mail", "welcome:1")).toStrictEqual({
      _tag: "Duplicate",
    });
    expect(
      await tagOf(send("Hook", "welcome:1")),
      "the same key under another kind"
    ).toBe("Enqueued");
    expect(await tagOf(send("Mail"))).toBe("Enqueued");
    expect(await tagOf(send("Mail")), "no key never conflicts").toBe(
      "Enqueued"
    );
    expect(await count(subject, table)).toBe(4);

    // The unique index covers every row: a delivered row keeps its key until `cleanup` deletes it.
    const windowed = await send("Mail", "window:1");

    if (windowed._tag !== "Enqueued") {
      throw new Error("the first message of a key must be stored");
    }

    const claim = await claimAt(subject, windowed.id);

    expect(
      await subject.ack({ id: windowed.id, now: at(10), token: claim.token })
    ).toStrictEqual({ _tag: "Delivered" });
    expect(
      await send("Mail", "window:1"),
      "a delivered row still holds its key"
    ).toStrictEqual({ _tag: "Duplicate" });
    expect(
      await subject.cleanup({ limit: 10, now: at(5000), olderThanMs: 1000 })
    ).toBe(1);
    expect(
      await tagOf(send("Mail", "window:1")),
      "after the cleanup the key is free"
    ).toBe("Enqueued");
  },
  title: "a duplicate (kind, dedupe key) stores one row and answers Duplicate",
};

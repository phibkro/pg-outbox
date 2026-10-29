import { describe, expect, test } from "vite-plus/test";

import {
  declareOutbox,
  databaseNow,
  fixedNow,
  InvalidArgumentError,
  operationIds,
  ProtocolError,
} from "../src/index.ts";

const outbox = declareOutbox({
  errorClasses: ["timeout", "rejected"],
  kinds: ["Mail", "Hook"],
  retry: { delaysMs: [1000, 5000], maxAttempts: 3 },
  table: "outbox",
});

const now = fixedNow(Date.UTC(2026, 0, 1));
const id = "42";
const token = "00000000-0000-4000-8000-000000000000";

/** A function that declares an outbox from `config`, for `toThrow`. */
const refused = (config: Parameters<typeof declareOutbox>[0]) => () => {
  declareOutbox(config);
};

describe("declaration", () => {
  test("building a statement runs nothing and has a text for every operation", () => {
    expect(Object.keys(outbox.sql).toSorted()).toStrictEqual(
      [...operationIds].toSorted()
    );
  });

  test("a name, a kind or a class that is not plain is refused before any SQL exists", () => {
    const base = {
      errorClasses: ["a"],
      retry: { delaysMs: [1], maxAttempts: 1 },
      table: "outbox",
    } as const;

    expect(refused({ ...base, table: 'x"; DROP TABLE y; --' })).toThrow(
      InvalidArgumentError
    );
    expect(refused({ ...base, schema: "Bad Schema" })).toThrow(
      InvalidArgumentError
    );
    expect(refused({ ...base, errorClasses: ["it's"] })).toThrow(
      InvalidArgumentError
    );
    expect(refused({ ...base, kinds: ["a", "a"] })).toThrow(
      InvalidArgumentError
    );
    expect(
      refused({ ...base, retry: { delaysMs: [1], maxAttempts: 0 } })
    ).toThrow(InvalidArgumentError);
  });

  test("a schema-qualified table is quoted in every statement and in the migration", () => {
    const qualified = declareOutbox({
      errorClasses: ["a"],
      retry: { delaysMs: [1], maxAttempts: 1 },
      schema: "jobs",
      table: "outbox",
    });

    expect(qualified.table).toBe('"jobs"."outbox"');
    expect(qualified.migration[0]).toContain('CREATE TABLE "jobs"."outbox"');
    expect(qualified.sql.ack).toContain('UPDATE "jobs"."outbox"');
  });

  test("the migration lists the closed sets as CHECKs", () => {
    const [create] = outbox.migration;

    expect(create).toContain("CHECK (kind IN ('Mail', 'Hook'))");
    expect(create).toContain("last_error IN ('timeout', 'rejected')");
  });

  test("an undeclared kind or error class is refused by the statement builders", () => {
    // The types forbid these; a JavaScript caller or a cast gets the runtime refusal.
    const kinds: readonly [string, ...string[]] = ["Mail"];
    const errorClasses: readonly [string, ...string[]] = ["timeout"];

    const loose = declareOutbox({
      errorClasses,
      kinds,
      retry: { delaysMs: [1], maxAttempts: 1 },
      table: "outbox",
    });

    expect(() => loose.enqueue({ kind: "Other", now, payload: {} })).toThrow(
      InvalidArgumentError
    );
    expect(() => loose.bury({ errorClass: "a@b.no", id, now, token })).toThrow(
      InvalidArgumentError
    );
    expect(() =>
      loose.release({ attempts: 1, errorClass: "a@b.no", id, now, token })
    ).toThrow(InvalidArgumentError);
  });

  test("ids, tokens and numbers are checked before they are sent", () => {
    expect(() => outbox.ack({ id: "1; DROP", now, token })).toThrow(
      InvalidArgumentError
    );
    expect(() => outbox.ack({ id, now, token: "not-a-token" })).toThrow(
      InvalidArgumentError
    );
    expect(() => outbox.claimById({ id, leaseMs: -1, now })).toThrow(
      InvalidArgumentError
    );
    expect(() => outbox.claimBatch({ leaseMs: 1, limit: 0, now })).toThrow(
      InvalidArgumentError
    );
  });
});

describe("the clock is an argument", () => {
  test("a fixed instant is the bind parameter, the database's clock is null", () => {
    expect(outbox.claimById({ id, leaseMs: 5, now }).values).toStrictEqual([
      id,
      5,
      "2026-01-01T00:00:00.000Z",
    ]);
    expect(
      outbox.claimById({ id, leaseMs: 5, now: databaseNow }).values.at(-1)
    ).toBeNull();
  });

  test("an invalid instant is refused", () => {
    expect(() => fixedNow(Number.NaN)).toThrow(RangeError);
  });
});

describe("the retry policy is data", () => {
  test("the delay after the n-th failed attempt is the n-th entry, then the last", () => {
    expect([1, 2, 3, 9].map((n) => outbox.retryDelayMs(n))).toStrictEqual([
      1000, 5000, 5000, 5000,
    ]);
  });

  test("release carries the declared delay and the declared attempts, or the caller's override", () => {
    const declared = outbox.release({ attempts: 2, id, now, token });

    const override = outbox.release({
      attempts: 2,
      id,
      now,
      retryAfterMs: 7,
      token,
    });

    expect(declared.values.slice(3, 5)).toStrictEqual([5000, 3]);
    expect(override.values[3]).toBe(7);
  });
});

describe("decoding", () => {
  test("a claim by id that matches nothing asks the table why, and the answers are typed", () => {
    const statement = outbox.claimById({ id, leaseMs: 1, now });
    const step = statement.decode([]);

    expect(step.done).toBe(false);

    if (step.done) {
      throw new Error("expected a follow-up statement");
    }

    const why = (row: Record<string, string | number>) =>
      step.next.decode([row]);

    expect(why({ due_ms: 0, held_ms: 5, status: "pending" })).toStrictEqual({
      done: true,
      value: { _tag: "Held", remainingMs: 5 },
    });
    expect(why({ due_ms: "7", held_ms: "0", status: "pending" })).toStrictEqual(
      { done: true, value: { _tag: "NotDue", dueInMs: 7 } }
    );
    expect(why({ due_ms: 0, held_ms: 0, status: "delivered" })).toStrictEqual({
      done: true,
      value: { _tag: "Settled" },
    });
    expect(step.next.decode([])).toStrictEqual({
      done: true,
      value: { _tag: "Settled" },
    });
  });

  test("a row that has not the promised shape is a ProtocolError that names columns, never values", () => {
    const statement = outbox.claimBatch({ leaseMs: 1, limit: 1, now });

    expect(() =>
      statement.decode([
        {
          attempts: 1,
          claim_token: token,
          id,
          kind: "Mail",
          payload: '{"secret":"value"',
        },
      ])
    ).toThrow(ProtocolError);
    expect(() =>
      statement.decode([{ attempts: "x", id, kind: "Mail", payload: "{}" }])
    ).toThrow(/attempts, claim_token/u);
    expect(() =>
      statement.decode([
        {
          attempts: 1,
          claim_token: token,
          id,
          kind: "Unknown",
          payload: "{}",
        },
      ])
    ).toThrow(ProtocolError);
  });

  test("a payload comes back as the JSON that went in", () => {
    const step = outbox.claimBatch({ leaseMs: 1, limit: 1, now }).decode([
      {
        attempts: 1,
        claim_token: token,
        id,
        kind: "Mail",
        payload: '{"to":["a","b"],"n":1}',
      },
    ]);

    expect(step).toStrictEqual({
      done: true,
      value: [
        {
          _tag: "Claimed",
          attempts: 1,
          id,
          kind: "Mail",
          payload: { n: 1, to: ["a", "b"] },
          token,
        },
      ],
    });
  });
});

import { describe, expect, test } from "vite-plus/test";

import {
  declareOutbox,
  execute,
  fixedNow,
  ProtocolError,
} from "../src/index.ts";
import type { Query, RawRow } from "../src/index.ts";

const outbox = declareOutbox({
  errorClasses: ["timeout"],
  retry: { delaysMs: [1], maxAttempts: 1 },
  table: "outbox",
});

const now = fixedNow(Date.UTC(2026, 0, 1));

/** A driver that answers each statement by its operation and records what it was asked. */
interface Driver {
  readonly query: Query;
  readonly sent: string[];
}

const driver = (
  answers: Readonly<Record<string, readonly RawRow[]>>
): Driver => {
  const sent: string[] = [];

  const query: Query = async (text) => {
    const operation =
      Object.entries(outbox.sql).find(([, sql]) => sql === text)?.[0] ?? "?";

    sent.push(operation);

    return answers[operation] ?? [];
  };

  return { query, sent };
};

describe("execute", () => {
  test("a statement that is answered at once runs once", async () => {
    const { query, sent } = driver({ ack: [{ id: "1" }] });

    const result = await execute(
      query,
      outbox.ack({
        id: "1",
        now,
        token: "00000000-0000-4000-8000-000000000000",
      })
    );

    expect(result).toStrictEqual({ _tag: "Delivered" });
    expect(sent).toStrictEqual(["ack"]);
  });

  test("a claim by id that matched nothing runs the classifying statement and answers with it", async () => {
    const { query, sent } = driver({
      classify: [{ due_ms: 0, held_ms: 40, status: "pending" }],
    });

    const result = await execute(
      query,
      outbox.claimById({ id: "1", leaseMs: 1000, now })
    );

    expect(result).toStrictEqual({ _tag: "Held", remainingMs: 40 });
    expect(sent).toStrictEqual(["claimById", "classify"]);
  });

  test("building a statement sends nothing, and a decoder's ProtocolError passes through", async () => {
    const { query, sent } = driver({ ack: [{ id: "1" }, { id: "2" }] });

    const statement = outbox.ack({
      id: "1",
      now,
      token: "00000000-0000-4000-8000-000000000000",
    });

    expect(sent).toStrictEqual([]);
    await expect(execute(query, statement)).rejects.toBeInstanceOf(
      ProtocolError
    );
  });

  test("a rejection of the driver is the caller's, unchanged", async () => {
    const failure = new Error("connection reset");

    await expect(
      execute(async () => {
        throw failure;
      }, outbox.counts({ now }))
    ).rejects.toBe(failure);
  });
});

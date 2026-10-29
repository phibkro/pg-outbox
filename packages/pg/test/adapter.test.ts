import {
  declareOutbox,
  fixedNow,
  ProtocolError,
  UnsupportedOperationError,
} from "@pg-outbox/core";
import { capabilities, direct, hyperdrive } from "@pg-txmode/core";
import type {
  Param as TxParam,
  Row,
  Transaction,
  TxClient,
} from "@pg-txmode/pg";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";

import { createPgOutbox } from "../src/index.ts";

const outbox = declareOutbox({
  errorClasses: ["timeout"],
  kinds: ["Mail"],
  retry: { delaysMs: [1], maxAttempts: 2 },
  table: "outbox",
});

interface Sent {
  readonly text: string;
  readonly values: readonly TxParam[];
}

interface Stub {
  readonly db: TxClient;
  readonly sent: Sent[];
  readonly counts: { transactions: number };
}

/** A client that answers `rows` to every statement and remembers what it was sent; no database is involved. */
type Answer = (text: string) => readonly Row[];

const stub = (rows: Answer = () => [], failure?: Error): Stub => {
  const sent: Sent[] = [];
  const counts = { transactions: 0 };

  const query: TxClient["query"] = async (text, values = []) => {
    sent.push({ text, values });

    return failure === undefined ? rows(text) : await Promise.reject(failure);
  };

  const db: TxClient = {
    capabilities: capabilities(direct),
    end: async () => {
      // nothing to close
    },
    mode: direct,
    query,
    transaction: async (body) => {
      counts.transactions += 1;

      return await body({ attempt: 1, query });
    },
  };

  return { counts, db, sent };
};

/** The stub client, said to stand behind Hyperdrive (a mode that caches reads and does not track the pooler's session). */
const behindHyperdrive = (): TxClient => ({
  ...stub().db,
  capabilities: capabilities(hyperdrive),
  mode: hyperdrive,
});

const token = "00000000-0000-4000-8000-000000000000";

describe("construction", () => {
  test("building the outbox sends nothing and opens no transaction", () => {
    const client = stub();

    createPgOutbox({ db: client.db, outbox });
    expect(client.sent).toStrictEqual([]);
    expect(client.counts.transactions).toBe(0);
  });

  test("a mode that cannot honour an operation refuses it when the outbox is built, quoting the catalogue", () => {
    const db = behindHyperdrive();

    expect(() => createPgOutbox({ db, outbox })).toThrow(
      UnsupportedOperationError
    );
    expect(() => createPgOutbox({ db, outbox })).toThrow(/catalogue/u);
  });

  test("a process that only enqueues on Hyperdrive is not refused for claims it never runs; a claim brings its follow-up read with it", () => {
    const db = behindHyperdrive();

    expect(() =>
      createPgOutbox({ db, operations: ["enqueue"], outbox })
    ).not.toThrow();
    expect(() =>
      createPgOutbox({
        db,
        operations: ["claimById"],
        outbox,
      })
    ).toThrow(/may run classify after itself/u);
    expect(() =>
      createPgOutbox({ allowUnverified: true, db, outbox })
    ).not.toThrow();
  });
});

describe("the clock is an argument, and the database's by default", () => {
  test("a call without `now` sends a null time (the database's statement_timestamp()), a call with `fixedNow` sends the instant", async () => {
    const client = stub((text) =>
      text.startsWith("SELECT")
        ? [{ due_ms: 0, held_ms: 0, status: "delivered" }]
        : []
    );

    const adapter = createPgOutbox({ db: client.db, outbox });

    await adapter.claimById({ id: "1", leaseMs: 1000 });
    await adapter.claimById({
      id: "1",
      leaseMs: 1000,
      now: fixedNow(Date.UTC(2026, 0, 1)),
    });

    const [first, second] = client.sent.filter((statement) =>
      statement.text.startsWith("UPDATE")
    );

    expect(first?.values.at(-1)).toBeNull();
    expect(second?.values.at(-1)).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("transactions are in the types", () => {
  const adapter = createPgOutbox({ db: stub().db, outbox });

  test("enqueue and holdClaim take a Transaction; the claims, the sweep and the reports take none; ack, release and bury take one optionally", () => {
    expectTypeOf(adapter.enqueue).parameter(0).toEqualTypeOf<Transaction>();
    expectTypeOf(adapter.holdClaim).parameter(0).toEqualTypeOf<Transaction>();
    expectTypeOf(adapter.ack)
      .parameter(1)
      .toEqualTypeOf<Transaction | undefined>();
    expectTypeOf(adapter.release)
      .parameter(1)
      .toEqualTypeOf<Transaction | undefined>();
    expectTypeOf(adapter.bury)
      .parameter(1)
      .toEqualTypeOf<Transaction | undefined>();
    expectTypeOf(adapter.enqueue).parameter(0).not.toEqualTypeOf<TxClient>();
    expectTypeOf(adapter.holdClaim).parameter(0).not.toEqualTypeOf<TxClient>();
    expect(adapter.claimById).toBeTypeOf("function");
  });

  test("an ack given a transaction runs on that transaction's connection, one given none runs alone", async () => {
    const client = stub(() => [{ id: "1" }]);
    const inTransaction: Sent[] = [];

    const transaction: Transaction = {
      attempt: 1,
      query: async (text, values = []) => {
        inTransaction.push({ text, values });

        return [{ id: "1" }];
      },
    };

    const adapter2 = createPgOutbox({ db: client.db, outbox });

    await adapter2.ack({ id: "1", token }, transaction);
    expect(inTransaction).toHaveLength(1);
    expect(client.sent).toHaveLength(0);

    await adapter2.ack({ id: "1", token });
    expect(client.sent).toHaveLength(1);
  });
});

describe("failures are the caller's", () => {
  test("a rejection of the driver reaches the caller unchanged, and nothing retries it", async () => {
    const failure = Object.assign(new Error("connection reset"), {
      code: "08006",
    });

    const client = stub(() => [], failure);
    const adapter = createPgOutbox({ db: client.db, outbox });

    await expect(adapter.claimById({ id: "1", leaseMs: 1000 })).rejects.toBe(
      failure
    );
    expect(client.sent).toHaveLength(1);
  });

  test("an answer that is not the promised shape is a ProtocolError, and an argument the protocol cannot send fails before any statement", async () => {
    const client = stub(() => [{ id: "1" }, { id: "2" }]);
    const adapter = createPgOutbox({ db: client.db, outbox });

    await expect(adapter.ack({ id: "1", token })).rejects.toBeInstanceOf(
      ProtocolError
    );
    expect(client.sent).toHaveLength(1);
    await expect(
      adapter.ack({ id: "1; DROP TABLE outbox", token })
    ).rejects.toThrow(/not an outbox id/u);
    expect(client.sent).toHaveLength(1);
  });
});

import { declareOutbox, fixedNow } from "@pg-outbox/core";
import type { Claimed, ClaimResult, Now } from "@pg-outbox/core";
import { expect } from "vite-plus/test";

import type { ErrorClass, Kind, Subject, SuiteOutbox } from "./subject.ts";

/** The declaration every falsifier runs against: two kinds, three classes, three attempts, delays of 1 s then 2 s. */
export const suiteOutbox: SuiteOutbox = declareOutbox<Kind, ErrorClass>({
  errorClasses: ["rejected", "timeout", "undecodable"],
  kinds: ["Hook", "Mail"],
  retry: { delaysMs: [1000, 2000], maxAttempts: 3 },
  table: "outbox",
});

const epoch = Date.UTC(2026, 0, 1);

/** The instant `ms` after the falsifiers' epoch: leases lapse by arithmetic, not by sleeping. */
export const at = (ms = 0): Now => fixedNow(epoch + ms);

/** The error that a falsifier throws inside a transaction to roll it back. */
export class RolledBackError extends Error {
  override readonly name = "RolledBackError";
}

export const count = async (
  subject: Subject,
  table: string
): Promise<number> => {
  const [row] = await subject.sql(`SELECT count(*)::int AS n FROM ${table}`);

  return Number(row?.n);
};

/** One message, written in a transaction of its own; returns its id. */
export const enqueueOne = async (
  subject: Subject,
  options: { readonly now?: Now; readonly kind?: Kind } = {}
): Promise<string> => {
  const result = await subject.transaction(
    async (tx) =>
      await subject.enqueue(tx, {
        kind: options.kind ?? "Mail",
        now: options.now ?? at(),
        payload: { to: "someone" },
      })
  );

  if (result._tag !== "Enqueued") {
    throw new Error("enqueue did not store a row");
  }

  return result.id;
};

/** `n` messages in one transaction; returns their ids in order. */
export const enqueueMany = async (
  subject: Subject,
  n: number,
  now: Now = at()
): Promise<readonly string[]> =>
  await subject.transaction(async (tx) => {
    const ids: string[] = [];

    for (let index = 0; index < n; index += 1) {
      const result = await subject.enqueue(tx, {
        kind: "Mail",
        now,
        payload: { index },
      });

      if (result._tag !== "Enqueued") {
        throw new Error("enqueue did not store a row");
      }

      ids.push(result.id);
    }

    return ids;
  });

export const claimed = (
  result: ClaimResult<Kind>,
  message: string
): Claimed<Kind> => {
  expect(result._tag, message).toBe("Claimed");

  if (result._tag !== "Claimed") {
    throw new Error(message);
  }

  return result;
};

export const { table } = suiteOutbox;

export interface RowState {
  readonly status: string;
  readonly attempts: number;
  readonly token: string | null;
  readonly lastError: string | null;
}

/** What the table says about one row, read straight from it (the falsifiers' ground truth). */
export const stateOf = async (
  subject: Subject,
  id: string
): Promise<RowState> => {
  const [row] = await subject.sql(
    `SELECT status, attempts, claim_token::text AS token, last_error FROM ${table} WHERE id = $1::bigint`,
    [id]
  );

  if (row === undefined) {
    throw new Error(`row ${id} is gone`);
  }

  return {
    attempts: Number(row.attempts),
    lastError: row.last_error === null ? null : String(row.last_error),
    status: String(row.status),
    token: row.token === null ? null : String(row.token),
  };
};

/** What a rejected statement carries: the driver's SQLSTATE `code` and the message. */
export interface Rejection {
  readonly code: string | undefined;
  readonly message: string;
}

/** The rejection of a promise, or undefined when it resolves. */
export const rejectionOf = async (
  promise: Promise<unknown>
): Promise<Rejection | undefined> => {
  try {
    await promise;

    return undefined;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String(error.code)
        : undefined;

    return {
      code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

/** The `_tag` of an answer. */
export const tagOf = async (
  answer: Promise<{ readonly _tag: string }>
): Promise<string> => await answer.then((result) => result._tag);

export const statusOf = async (subject: Subject, id: string): Promise<string> =>
  await stateOf(subject, id).then((state) => state.status);

export const lastErrorOf = async (
  subject: Subject,
  id: string
): Promise<string | null> =>
  await stateOf(subject, id).then((state) => state.lastError);

/** A claim of `id` at `ms` with a lease of `leaseMs`, which must succeed. */
export const claimAt = async (
  subject: Subject,
  id: string,
  options: { readonly ms?: number; readonly leaseMs?: number } = {}
): Promise<Claimed<Kind>> =>
  claimed(
    await subject.claimById({
      id,
      leaseMs: options.leaseMs ?? 1000,
      now: at(options.ms ?? 0),
    }),
    `the claim of ${id} at ${options.ms ?? 0} ms`
  );

/** A new row and the claim of it at 0 ms: the start of nearly every falsifier about a claim. */
export const claimedRow = async (
  subject: Subject
): Promise<{ readonly id: string; readonly claim: Claimed<Kind> }> => {
  const id = await enqueueOne(subject);

  return { claim: await claimAt(subject, id), id };
};

/**
 * The operations of the protocol as data. One list: the statements, the mode check, the conformance suite, the model's
 * `@operation` tags and the documentation all read it, so a fact about an operation has one home.
 *
 * `transaction`:
 * - `requires`: meaningless outside the caller's transaction (`enqueue` commits alone otherwise, which is the dual-write
 *   gap; a hold outside a transaction holds nothing).
 * - `joins`: one conditional write that commits with the caller's transaction when there is one, and alone otherwise.
 * - `standalone`: must not run in a caller's transaction. A claim inside an open transaction is invisible to every other
 *   claimer until it ends, and it keeps its row lock while the worker sends.
 *
 * `rows` are the pg-txmode catalogue rows the operation rests on; `reads` says that Hyperdrive's read cache applies to it;
 * `follows` names the operations it can run after itself, whose support limits its own.
 */
import type { RowId } from "@pg-txmode/core";

export type TransactionMode = "requires" | "joins" | "standalone";

export interface OperationInfo {
  readonly id: string;
  readonly transaction: TransactionMode;
  readonly rows: readonly RowId[];
  readonly reads: boolean;
  /** Operations that this one may run after it (a claim by id that matched nothing asks `classify` why). */
  readonly follows?: readonly string[];
  /** What the operation does, in one line (the documentation is generated from this). */
  readonly summary: string;
}

const defineOperations = <const T extends readonly OperationInfo[]>(
  operations: T
): T => operations;

export const operations = defineOperations([
  {
    id: "enqueue",
    reads: false,
    rows: ["on-conflict"],
    summary: "Write a message in the caller's transaction",
    transaction: "requires",
  },
  {
    follows: ["classify"],
    id: "claimById",
    reads: false,
    rows: ["outbox-lease"],
    summary: "Take one row by id under a lease and a fresh token",
    transaction: "standalone",
  },
  {
    id: "classify",
    reads: true,
    rows: ["outbox-lease"],
    summary: "Say why a claim by id matched nothing",
    transaction: "standalone",
  },
  {
    id: "claimBatch",
    reads: false,
    rows: ["outbox-lease", "skip-locked"],
    summary:
      "Take up to a limit of due rows, skipping rows other claimers lock",
    transaction: "standalone",
  },
  {
    id: "ack",
    reads: false,
    rows: ["outbox-lease"],
    summary: "Mark the row delivered, if the token is current",
    transaction: "joins",
  },
  {
    id: "release",
    reads: false,
    rows: ["outbox-lease"],
    summary: "Give the claim back after a failure: retry later, or end the row",
    transaction: "joins",
  },
  {
    id: "bury",
    reads: false,
    rows: ["outbox-lease"],
    summary: "End the row now, with a recorded failure class",
    transaction: "joins",
  },
  {
    id: "holdClaim",
    reads: false,
    rows: ["row-locks"],
    summary: "Lock the claimed row to the end of the caller's transaction",
    transaction: "requires",
  },
  {
    id: "markQueued",
    reads: false,
    rows: ["outbox-lease"],
    summary: "Record the transport's receipt for pending rows",
    transaction: "standalone",
  },
  {
    id: "stale",
    reads: true,
    rows: ["outbox-lease"],
    summary: "List pending rows that no live claim and no recent receipt cover",
    transaction: "standalone",
  },
  {
    id: "counts",
    reads: true,
    rows: ["outbox-lease"],
    summary: "Count rows per status",
    transaction: "standalone",
  },
  {
    id: "open",
    reads: true,
    rows: ["outbox-lease"],
    summary: "List the newest pending rows with their state, never the payload",
    transaction: "standalone",
  },
  {
    id: "cleanup",
    reads: false,
    rows: ["outbox-lease"],
    summary:
      "Delete terminal rows older than a time to live, in bounded batches",
    transaction: "standalone",
  },
]);

export type OperationId = (typeof operations)[number]["id"];

export const operationIds: readonly OperationId[] = operations.map(
  (operation) => operation.id
);

export const operationById = (id: string): OperationInfo => {
  const found = operations.find((operation) => operation.id === id);

  if (found === undefined) {
    throw new Error(`unknown operation ${id}`);
  }

  return found;
};

/** Whether `id` names an operation: for the strings of data (`follows`) and of a caller's list. */
export const isOperationId = (id: string): id is OperationId =>
  operationIds.some((known) => known === id);

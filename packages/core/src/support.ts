import { capabilities, cellOf, describeMode, rowById } from "@pg-txmode/core";
import type { ConnectionMode, RowId, Support } from "@pg-txmode/core";

import { operationById } from "./operations.ts";
import type { OperationId } from "./operations.ts";

/**
 * `works` is `yes`, `unknown` is `unverified` (neither documented nor measured: not safe), anything else is `no`. This is
 * pg-txmode's own mapping (`supportOf` in its `mode.ts`, not exported); a test pins this copy to `capabilities` for every row
 * that has a feature name there, and the one function is the only place this repository repeats it.
 */
export const supportOfOutcome = (outcome: string): Support => {
  if (outcome === "works") {
    return "yes";
  }

  return outcome === "unknown" ? "unverified" : "no";
};

const rank: Readonly<Record<Support, number>> = {
  no: 0,
  unverified: 1,
  yes: 2,
};

/** The weakest of the cells that an operation rests on, in the mode's column. */
export const rowSupport = (
  mode: ConnectionMode,
  rows: readonly RowId[]
): Support => {
  let weakest: Support = "yes";

  for (const row of rows) {
    const support = supportOfOutcome(cellOf(mode, row).outcome);

    if (rank[support] < rank[weakest]) {
      weakest = support;
    }
  }

  return weakest;
};

/**
 * A read through a proxy that caches reads (Hyperdrive: a write does not purge them) is `unverified` at best: every read of
 * the library calls `statement_timestamp()`, which Hyperdrive's documentation lists among the functions that make it skip
 * its cache, but nothing was run through Hyperdrive, so the answer stays `unverified` until pg-txmode's probe Worker ran.
 */
export const capCachedRead = (
  support: Support,
  isRead: boolean,
  cachesReads: boolean
): Support =>
  isRead && cachesReads && rank[support] > rank.unverified
    ? "unverified"
    : support;

/** What the mode lets an operation do: the weakest cell of its catalogue rows, capped for a read behind a cache. */
export const operationSupport = (
  mode: ConnectionMode,
  id: OperationId
): Support => {
  const operation = operationById(id);

  return capCachedRead(
    rowSupport(mode, operation.rows),
    operation.reads,
    capabilities(mode).cachesReads
  );
};

/** The mode cannot honour the operation, or the catalogue has not verified it there. The message quotes the catalogue. */
export class UnsupportedOperationError extends Error {
  override readonly name = "UnsupportedOperationError";
  readonly operation: OperationId;
  readonly support: Support;
  readonly rows: readonly RowId[];

  constructor(mode: ConnectionMode, id: OperationId, support: Support) {
    const { rows } = operationById(id);

    const cells = rows
      .map((row) => {
        const cell = cellOf(mode, row);

        return `${row}: ${cell.outcome} (${cell.note}; ${rowById(row).sources.join(", ")})`;
      })
      .join("; ");

    super(
      `${id} is ${support === "no" ? "not available" : "unverified"} on a ${describeMode(mode)} connection; catalogue ${cells}`
    );
    this.operation = id;
    this.support = support;
    this.rows = rows;
  }
}

export interface RequireOptions {
  /** Accept an operation whose catalogue cell is neither documented nor measured for the mode. Off by default. */
  readonly allowUnverified?: boolean;
}

/** Throws `UnsupportedOperationError` unless the mode supports the operation (or it is unverified and the caller accepts that). */
export const requireOperation = (
  mode: ConnectionMode,
  id: OperationId,
  options: RequireOptions = {}
): void => {
  const support = operationSupport(mode, id);

  if (
    support === "yes" ||
    (support === "unverified" && options.allowUnverified === true)
  ) {
    return;
  }

  throw new UnsupportedOperationError(mode, id, support);
};

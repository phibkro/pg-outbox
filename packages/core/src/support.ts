import {
  capabilities,
  cellOf,
  columnOf,
  describeMode,
  hyperdrive,
  neonPooler,
  pgBouncer,
  rowById,
} from "@pg-txmode/core";
import type { ConnectionMode, RowId, Support } from "@pg-txmode/core";

import { isOperationId, operationById } from "./operations.ts";
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

/**
 * A use of a catalogue row that the cell's recorded run did not cover, so the cell's `works` does not vouch for it. The
 * catalogue says so in the cell's note (prose); `phrase` is that sentence, and a test fails when the note no longer holds
 * it, so the gap is read again the day the catalogue changes. `enqueue` is a concurrent `ON CONFLICT DO NOTHING` whose
 * exactly-one-winner is the deduplication; through Hyperdrive only the sequential form and a concurrent `DO UPDATE` ran.
 */
export interface CoverageGap {
  /** The mode whose column holds the cell (the catalogue's column of this mode). */
  readonly mode: ConnectionMode;
  readonly row: RowId;
  readonly operation: OperationId;
  readonly phrase: string;
}

export const coverageGaps: readonly CoverageGap[] = [
  {
    mode: hyperdrive,
    operation: "enqueue",
    phrase:
      "A concurrent DO NOTHING claim, with exactly one winner, was not run through Hyperdrive.",
    row: "on-conflict",
  },
];

/** The modes whose transaction-pooled cells were measured: PgBouncer, and Neon's pooler, which is PgBouncer with its settings. */
const measuredPoolers: ReadonlySet<string> = new Set([
  describeMode(pgBouncer(0)),
  describeMode(neonPooler),
]);

/**
 * The transaction-pooled column is PgBouncer's; other poolers inherit it except for the few cells the catalogue gives them.
 * A cell that such a pooler inherits was measured on PgBouncer, not on it. Read from the catalogue's data (the mode's
 * description and the cell itself), so that no pooler is named here.
 */
const inheritedFromMeasured = (mode: ConnectionMode, row: RowId): boolean =>
  mode.kind === "TransactionPooled" &&
  !measuredPoolers.has(describeMode(mode)) &&
  cellOf(mode, row) === rowById(row).transactionPooled;

/**
 * Why the mode's cell for `row`, though it may say `works`, does not vouch for `id` (`undefined` when it does): the cell was
 * measured on another pooler (Supavisor inherits PgBouncer's, and no Supavisor ran), or the recorded run did not cover this
 * use of the row. Only evidence for this mode and this use counts; everything else is `unverified`.
 */
const gapOf = (
  mode: ConnectionMode,
  id: OperationId,
  row: RowId
): string | undefined => {
  if (inheritedFromMeasured(mode, row)) {
    return `the cell is the measured PgBouncer's, inherited by a ${describeMode(mode)} connection, where no run was made`;
  }

  return coverageGaps.find(
    (gap) =>
      columnOf(gap.mode) === columnOf(mode) &&
      gap.row === row &&
      gap.operation === id
  )?.phrase;
};

/** What one cell lets the operation do: its outcome, and `unverified` at best where the evidence is not for this mode and use. */
const cellSupport = (
  mode: ConnectionMode,
  id: OperationId,
  row: RowId
): Support => {
  const support = supportOfOutcome(cellOf(mode, row).outcome);

  return gapOf(mode, id, row) !== undefined && rank[support] > rank.unverified
    ? "unverified"
    : support;
};

/** The weakest of the cells that an operation rests on, in the mode's column. */
export const rowSupport = (mode: ConnectionMode, id: OperationId): Support => {
  let weakest: Support = "yes";

  for (const row of operationById(id).rows) {
    const support = cellSupport(mode, id, row);

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

const weaker = (a: Support, b: Support): Support =>
  rank[a] <= rank[b] ? a : b;

/**
 * What the mode lets an operation do: the weakest cell of its catalogue rows that is evidence for this mode and this use,
 * capped for a read behind a cache, and no stronger than any operation it may run after itself (`claimById` can run
 * `classify`, a read).
 */
export const operationSupport = (
  mode: ConnectionMode,
  id: OperationId
): Support => {
  const operation = operationById(id);

  let support = capCachedRead(
    rowSupport(mode, id),
    operation.reads,
    capabilities(mode).cachesReads
  );

  for (const follower of operation.follows ?? []) {
    if (!isOperationId(follower)) {
      throw new Error(`${id} follows ${follower}, which is not an operation`);
    }

    support = weaker(support, operationSupport(mode, follower));
  }

  return support;
};

/** The mode cannot honour the operation, or the catalogue has not verified it there. The message quotes the catalogue. */
export class UnsupportedOperationError extends Error {
  override readonly name = "UnsupportedOperationError";
  readonly operation: OperationId;
  readonly support: Support;
  readonly rows: readonly RowId[];

  constructor(mode: ConnectionMode, id: OperationId, support: Support) {
    const operation = operationById(id);

    // The rows the answer rests on: the operation's own and those of the operations it may run after itself, each with
    // the operation that owns it (a gap is a use of a row by one operation).
    const uses = [id, ...(operation.follows ?? [])].flatMap((owner) =>
      operationById(owner).rows.map((row) => ({ owner, row }))
    );

    const rows = [...new Set(uses.map((use) => use.row))];

    const cells = rows
      .map((row) => {
        const cell = cellOf(mode, row);

        const gap = uses
          .flatMap((use) =>
            use.row === row && isOperationId(use.owner)
              ? [gapOf(mode, use.owner, row)]
              : []
          )
          .find((found) => found !== undefined);

        return `${row}: ${cell.outcome} (${cell.note}; ${rowById(row).sources.join(", ")})${gap === undefined ? "" : `; not vouched for here: ${gap}`}`;
      })
      .join("; ");

    const after =
      (operation.follows ?? []).length === 0
        ? ""
        : `; it may run ${(operation.follows ?? []).join(", ")} after itself`;

    super(
      `${id} is ${support === "no" ? "not available" : "unverified"} on a ${describeMode(mode)} connection${after}; catalogue ${cells}`
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

/**
 * The refusal of an operation, or `undefined` when the mode supports it (or it is unverified and the caller accepts that).
 * A value, not a throw: an adapter that reports refusals in its own error channel reads it here, and `requireOperation`
 * throws exactly this value.
 */
export const refusalOf = (
  mode: ConnectionMode,
  id: OperationId,
  options: RequireOptions = {}
): UnsupportedOperationError | undefined => {
  const support = operationSupport(mode, id);

  return support === "yes" ||
    (support === "unverified" && options.allowUnverified === true)
    ? undefined
    : new UnsupportedOperationError(mode, id, support);
};

/** Throws `UnsupportedOperationError` unless the mode supports the operation (or it is unverified and the caller accepts that). */
export const requireOperation = (
  mode: ConnectionMode,
  id: OperationId,
  options: RequireOptions = {}
): void => {
  const refusal = refusalOf(mode, id, options);

  if (refusal !== undefined) {
    throw refusal;
  }
};

import type { Param } from "./statement.ts";

/**
 * The clock of one call, an explicit argument of every statement that compares or records time (research R11: leases
 * compare clocks, so the clock is a boundary parameter, not a surprise inside the SQL).
 *
 * - `database`: the database's own `statement_timestamp()`. Every consumer that uses it agrees with every other, whatever
 *   its host's clock says, because there is one clock. The cost is that a test cannot move it; a lease of 0 ms stands for a
 *   lapsed one. The adapters default to it.
 * - `fixed`: an instant the caller supplies (Effect's `Clock`, a test's fixed value). Several consumers on hosts whose
 *   clocks differ by more than the lease can then hold one row at once: with a fixed clock the lease must be much longer
 *   than the skew the deployment accepts. The fence still protects the row; `attempts` is the fencing number for the rest.
 *
 * A statement uses one `Now` for the whole call, so a lease and the comparison that expires it never use two clocks.
 */
export type Now =
  | { readonly source: "database" }
  | { readonly source: "fixed"; readonly at: string };

export const databaseNow: Now = { source: "database" };

/** An instant of the caller's choosing, as a `Date` or milliseconds since the epoch. */
export const fixedNow = (at: Date | number): Now => {
  const date = new Date(at);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`fixedNow: ${String(at)} is not a valid instant`);
  }

  return { at: date.toISOString(), source: "fixed" };
};

/** The bind parameter of a `Now`: null asks the database for `statement_timestamp()`, text is the caller's instant. */
export const nowParam = (now: Now): Param =>
  now.source === "database" ? null : now.at;

/** The SQL of the instant in parameter `$position`: the caller's, else the database's. */
export const instant = (position: number): string =>
  `COALESCE($${position}::timestamptz, statement_timestamp())`;

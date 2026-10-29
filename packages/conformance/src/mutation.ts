import type { OperationId } from "@pg-outbox/core";

/**
 * A deliberate defect, the negative control of a falsifier. It rewrites what the subject sends (never the product source),
 * and the falsifier it belongs to **must** fail against it: a control that passes proves the falsifier cannot see the defect.
 *
 * - `statement`: the text of one operation's statement. With `inspectOnly` the rewritten text is only handed to a check that
 *   reads text (the lint, the cache rule) and is never executed.
 * - `ownConnection`: the operation runs on a connection of its own, in autocommit, instead of in the caller's transaction
 *   (the dual-write mistake, and an ack that does not join).
 * - `migration`: the statements that create the table.
 */
export type Mutation =
  | {
      readonly kind: "statement";
      readonly operation: OperationId;
      readonly rewrite: (text: string) => string;
      readonly inspectOnly?: boolean;
    }
  | { readonly kind: "ownConnection"; readonly operation: "ack" | "enqueue" }
  | {
      readonly kind: "migration";
      readonly rewrite: (statements: readonly string[]) => readonly string[];
    }
  | { readonly kind: "all"; readonly of: readonly Mutation[] };

/** The single mutations of a mutation: `all` is the defects applied together (a defect that needs two edits). */
export const parts = (
  mutation: Mutation | undefined
): readonly Exclude<Mutation, { kind: "all" }>[] => {
  if (mutation === undefined) {
    return [];
  }

  return mutation.kind === "all" ? mutation.of.flatMap(parts) : [mutation];
};

export interface Control {
  /** Names the same rule as the model's broken variant when there is one (`model/cases.json`). */
  readonly id: string;
  readonly describe: string;
  readonly mutation: Mutation;
}

/** A control whose rewrite changed nothing would pass vacuously: it is a defect of the suite, found before the run. */
class VacuousControlError extends Error {
  override readonly name = "VacuousControlError";
}

export const rewritten = (
  original: string,
  rewrite: (text: string) => string,
  what: string
): string => {
  const text = rewrite(original);

  if (text === original) {
    throw new VacuousControlError(`${what}: the rewrite changed nothing`);
  }

  return text;
};

/** `from` is replaced once by `to`; a pattern that is not in the text is a vacuous control. */
export const replacing =
  (from: RegExp | string, to: string) =>
  (text: string): string =>
    text.replace(from, to);

/** The database-or-fixed instant of any parameter position, as it is written in the statements. */
export const instantPattern = String.raw`COALESCE\(\$\d+::timestamptz, statement_timestamp\(\)\)`;

import type { OperationId } from "./operations.ts";

/** A bind parameter: what every driver sends the same way. JSON travels as text, timestamps as ISO text or null. */
export type Param = string | number | boolean | null;

/** A value of a result row, as a driver hands it over: the statements cast everything to text, integers or booleans. */
export type RawValue = string | number | boolean | bigint | null | undefined;

/** A row as a driver returns it: column name to value. A decoder parses every column it reads. */
export type RawRow = Readonly<Record<string, RawValue>>;

/**
 * One statement of the protocol and the way to read its answer. The adapter runs `text` with `values` on its driver and
 * hands the rows to `decode`, which says either that the answer is complete or which statement to run next (a claim by
 * id that matched nothing asks the table why). The loop that does this is the whole interpreter:
 *
 *     let step = statement.decode(await run(statement.text, statement.values));
 *     while (!step.done) { step = step.next.decode(await run(step.next.text, step.next.values)); }
 */
export interface Statement<A> {
  readonly operation: OperationId;
  readonly text: string;
  readonly values: readonly Param[];
  readonly decode: (rows: readonly RawRow[]) => Step<A>;
}

export type Step<A> =
  | { readonly done: true; readonly value: A }
  | { readonly done: false; readonly next: Statement<A> };

export const done = <A>(value: A): Step<A> => ({ done: true, value });

export const andThen = <A>(next: Statement<A>): Step<A> => ({
  done: false,
  next,
});

/**
 * The rows do not have the shape the statement promises: the table and the library disagree (a migration that was not
 * run, a column that another writer changed). It is a defect of the deployment, never an answer of the protocol.
 */
export class ProtocolError extends Error {
  override readonly name = "ProtocolError";
  readonly operation: OperationId;

  constructor(operation: OperationId, message: string) {
    super(`${operation}: ${message}`);
    this.operation = operation;
  }
}

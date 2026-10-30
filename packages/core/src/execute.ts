import type { Param, RawRow, Statement, Step } from "./statement.ts";

/** One statement on one connection of the driver: what an adapter must supply, and nothing else. */
export type Query = (
  text: string,
  values: readonly Param[]
) => Promise<readonly RawRow[]>;

/** Runs the follow-up statement that a decoder asks for, until the answer is complete (at most one deep today). */
const finish = async <A>(query: Query, step: Step<A>): Promise<A> => {
  if (step.done) {
    return step.value;
  }

  const { next } = step;

  return await finish(query, next.decode(await query(next.text, next.values)));
};

/**
 * The interpreter of a `Statement`: run its text, decode the rows, and run the follow-up statement that the decoder asks for
 * (a claim by id that matched nothing asks the table why) until the answer is complete. It is the whole of what an adapter
 * does with the protocol. Nothing runs before it is called, a rejection of `query` is the caller's, and a `ProtocolError` of
 * a decoder passes through.
 */
export const execute = async <A>(
  query: Query,
  statement: Statement<A>
): Promise<A> =>
  await finish(
    query,
    statement.decode(await query(statement.text, statement.values))
  );

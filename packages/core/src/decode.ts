/**
 * Every column a decoder reads is parsed here, once, at the edge of the library: the statements cast their answers to text,
 * integers and booleans, and a row that does not have the shape is a `ProtocolError`, never a guess. The error names the
 * columns and never the values (a payload can hold personal data).
 */
import { z } from "zod";

import type { OperationId } from "./operations.ts";
import type { Json } from "./results.ts";
import { ProtocolError } from "./statement.ts";
import type { RawRow } from "./statement.ts";

/**
 * `int` arrives as a number; `bigint` as text (node-postgres) or as a `bigint` (`@effect/sql-pg`), depending on the driver.
 * Every count of the protocol (attempts, milliseconds, a number of rows) is a JavaScript integer: a value above 2^53 - 1
 * would lose digits in `Number`, so it is a `ProtocolError` and never a rounded number.
 */
const count = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/u)
    .transform(Number)
    .refine(Number.isSafeInteger),
  z.bigint().transform(Number).refine(Number.isSafeInteger),
]);

const id = z.string().regex(/^\d{1,19}$/u);

export const idRow = z.object({ id });

export const claimedRow = z.object({
  attempts: count,
  claim_token: z.uuid(),
  id,
  kind: z.string(),
  payload: z.string(),
});

export const classifyRow = z.object({
  due_ms: count,
  held_ms: count,
  status: z.string(),
});

export const releaseRow = z.object({ id, status: z.enum(["dead", "pending"]) });

export const countRow = z.object({
  n: count,
  status: z.enum(["dead", "delivered", "pending"]),
});

export const openRow = z.object({
  attempts: count,
  due_ms: count,
  held_ms: count,
  id,
  kind: z.string(),
  last_error: z.string().nullable(),
});

const json = z.json();

export const parseRow = <T>(
  operation: OperationId,
  schema: z.ZodType<T>,
  row: RawRow
): T => {
  const parsed = schema.safeParse(row);

  if (!parsed.success) {
    const columns = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");

    throw new ProtocolError(operation, `unexpected columns: ${columns}`);
  }

  return parsed.data;
};

/** The payload column, read as text from `payload::text`. */
export const parsePayload = (operation: OperationId, text: string): Json => {
  try {
    return json.parse(JSON.parse(text));
  } catch {
    throw new ProtocolError(operation, "payload is not JSON");
  }
};

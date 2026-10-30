import { z } from "zod";

/**
 * What the runner and the Worker say to each other over one WebSocket. One socket is one Worker invocation and one PostgreSQL
 * connection of that invocation (through the Hyperdrive binding), so a transaction is a run of statements on one socket.
 * Statements are the library's own, unchanged: the Worker adds no SQL and decides nothing.
 */
const param = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** A row as the Worker returns it: JSON values only (the statements cast what they read to text, integers and booleans). */
const row = z.record(z.string(), z.json());

export type Row = z.infer<typeof row>;

export const request = z.object({
  id: z.number().int().nonnegative(),
  text: z.string().min(1),
  values: z.array(param),
});

export type Request = z.infer<typeof request>;

export const response = z.union([
  z.object({
    id: z.number().int().nonnegative(),
    ok: z.literal(true),
    rows: z.array(row),
  }),
  z.object({
    code: z.string().optional(),
    id: z.number().int().nonnegative(),
    message: z.string(),
    ok: z.literal(false),
  }),
]);

export type Response = z.infer<typeof response>;

/** The subprotocol that carries the run's token: the one header a WebSocket client of any runtime can set. */
export const subprotocolOf = (token: string): string => `probe.${token}`;

/** What `GET /health` answers: that the binding is reachable, and what the origin says it is. */
export const healthAnswer = z.object({
  database: z.string(),
  serverVersion: z.string(),
});

import { z } from "zod";

import { request } from "./protocol.ts";
import type { Response, Row } from "./protocol.ts";

/** The one connection of a session: node-postgres' `Client` has this shape. */
export interface Connection {
  readonly query: (
    text: string,
    values: (string | number | boolean | null)[]
  ) => Promise<{ readonly rows: Row[] }>;
  readonly end: () => Promise<void>;
}

export interface Socket {
  readonly send: (data: string) => void;
}

/** A failure as node-postgres gives it: a message, and the SQLSTATE of a server error. */
const failureOf = (id: number, error: Error): Response => {
  const failure: Response = { id, message: error.message, ok: false };
  const code = z.string().safeParse("code" in error ? error.code : undefined);

  return code.success ? { ...failure, code: code.data } : failure;
};

export interface Session {
  /** One message of the socket. Statements of a session run one after the other, in the order they arrived. */
  readonly message: (data: string) => Promise<void>;
  /** The socket closed: the connection ends (a transaction left open is rolled back by the server). */
  readonly close: () => Promise<void>;
}

/**
 * A session: statements in, rows or a failure out. The connection is opened by the first statement, inside the handler, never in
 * the global scope (Cloudflare's rule for a client of a Worker). Messages are queued, so a client that sends two statements
 * without waiting still has them run in order on the one connection.
 */
export const openSession = (
  connect: () => Promise<Connection>,
  socket: Socket
): Session => {
  let connection: Promise<Connection> | undefined;
  let queue: Promise<void> = Promise.resolve();

  const run = async (data: string): Promise<void> => {
    let id = 0;

    try {
      const parsed = request.parse(JSON.parse(data));

      ({ id } = parsed);
      connection ??= connect();

      const client = await connection;
      const { rows } = await client.query(parsed.text, parsed.values);

      socket.send(JSON.stringify({ id, ok: true, rows } satisfies Response));
    } catch (error) {
      socket.send(
        JSON.stringify(
          failureOf(
            id,
            error instanceof Error ? error : new Error(String(error))
          )
        )
      );
    }
  };

  return {
    close: async () => {
      await queue;

      if (connection !== undefined) {
        try {
          const client = await connection;

          await client.end();
        } catch {
          // the connection is gone already
        }
      }
    },
    message: async (data) => {
      queue = queue.then(async () => {
        await run(data);
      });
      await queue;
    },
  };
};

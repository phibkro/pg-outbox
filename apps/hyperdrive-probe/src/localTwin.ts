import { Client } from "pg";
import { WebSocketServer } from "ws";
import { z } from "zod";

import { subprotocolOf } from "./protocol.ts";
import { openSession } from "./session.ts";

export interface LocalTwin {
  /** `ws://127.0.0.1:<port>/session`: what a runner opens sessions on. */
  readonly url: string;
  readonly stop: () => Promise<void>;
}

/**
 * The Worker's session handler on a WebSocket server of this machine, in front of a PostgreSQL that `connectionString` names.
 * It runs the same `openSession` as `worker.ts`; what it does not have is Hyperdrive, workerd and the Cloudflare network. A run
 * against it shows that the runner, the protocol and the remote client are right, and says **nothing** about Hyperdrive.
 */
export const startLocalTwin = async (
  connectionString: string,
  token: string
): Promise<LocalTwin> => {
  const server = new WebSocketServer({
    handleProtocols: (protocols) =>
      protocols.has(subprotocolOf(token)) ? subprotocolOf(token) : false,
    host: "127.0.0.1",
    port: 0,
  });

  server.on("connection", (socket) => {
    const session = openSession(
      async () => {
        const client = new Client({ connectionString });

        client.on("error", () => {
          // nothing to do: the next statement of the session fails with the connection's error
        });
        await client.connect();

        return client;
      },
      {
        close: () => {
          socket.close();
        },
        send: (data) => {
          socket.send(data);
        },
      }
    );

    socket.on("message", (data) => {
      const chunks = Array.isArray(data) ? data : [data];

      void session.message(
        chunks.map((chunk) => new TextDecoder().decode(chunk)).join("")
      );
    });
    socket.on("close", () => {
      void session.close();
    });
  });

  const listening = Promise.withResolvers<null>();

  server.once("listening", () => {
    listening.resolve(null);
  });
  await listening.promise;

  const { port } = z.object({ port: z.number() }).parse(server.address());

  return {
    stop: async () => {
      for (const client of server.clients) {
        client.close();
      }

      const closed = Promise.withResolvers<null>();

      server.close(() => {
        closed.resolve(null);
      });
      await closed.promise;
    },
    url: `ws://127.0.0.1:${port}/session`,
  };
};

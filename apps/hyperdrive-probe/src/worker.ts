import { Client } from "pg";
import { z } from "zod";

import { subprotocolOf } from "./protocol.ts";
import { openSession } from "./session.ts";

/** The bindings of the probe Worker (`alchemy.run.ts`): the Hyperdrive configuration, and the run's token. */
interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly PROBE_TOKEN: string;
}

const refuse = (status: number, message: string): Response =>
  new Response(message, { status });

/** A client of the Hyperdrive binding, opened inside the handler (never in the global scope) and ended with its session. */
const connect = async (env: Env): Promise<Client> => {
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
  });

  // A connection that the server or Hyperdrive closes is reported here; the next statement of the session fails with it.
  client.on("error", () => {
    // nothing to do: the next statement of the session fails with the connection's error
  });
  await client.connect();

  return client;
};

const health = async (env: Env): Promise<Response> => {
  const client = await connect(env);

  try {
    const { rows } = await client.query<{
      database: string;
      server_version: string;
    }>(
      "SELECT current_database()::text AS database, current_setting('server_version')::text AS server_version"
    );

    return Response.json({
      database: rows[0]?.database,
      serverVersion: rows[0]?.server_version,
    });
  } finally {
    await client.end();
  }
};

const session = (request: Request, env: Env): Response => {
  if (request.headers.get("Upgrade") !== "websocket") {
    return refuse(426, "a session is a WebSocket");
  }

  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];

  server.accept();

  const open = openSession(async () => await connect(env), {
    send: (data) => {
      server.send(data);
    },
  });

  server.addEventListener("message", (event) => {
    const text = z.string().safeParse(event.data);

    if (text.success) {
      void open.message(text.data);
    }
  });
  server.addEventListener("close", () => {
    void open.close();
  });

  return new Response(null, {
    headers: { "Sec-WebSocket-Protocol": subprotocolOf(env.PROBE_TOKEN) },
    status: 101,
    webSocket: client,
  });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const wanted = subprotocolOf(env.PROBE_TOKEN);
    const offered = request.headers.get("Sec-WebSocket-Protocol") ?? "";

    if (!offered.split(",").some((value) => value.trim() === wanted)) {
      return refuse(401, "");
    }

    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      return await health(env);
    }

    return pathname === "/session" ? session(request, env) : refuse(404, "");
  },
};

import {
  capabilities,
  hyperdrive,
  openingScript,
  withTransactionRetry,
} from "@pg-txmode/core";
import type {
  Param,
  Row,
  Transaction,
  TransactionRunOptions,
  TxClient,
} from "@pg-txmode/pg";
import { z } from "zod";

import type { Budget } from "./budget.ts";
import { healthAnswer, response, subprotocolOf } from "./protocol.ts";
import type { Request } from "./protocol.ts";

/** A failure of the server as the Worker reports it: a message and, for a server error, its SQLSTATE. */
class RemoteError extends Error {
  override readonly name = "RemoteError";
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined) {
    super(message);
    this.code = code;
  }
}

interface Pending {
  readonly resolve: (rows: readonly Row[]) => void;
  readonly reject: (error: Error) => void;
}

/** One WebSocket: one invocation of the Worker, one connection through the Hyperdrive binding. */
interface Remote {
  readonly send: (
    text: string,
    values: readonly Param[]
  ) => Promise<readonly Row[]>;
  readonly close: () => void;
  readonly alive: () => boolean;
}

/** What goes on the wire: the library sends text, numbers, booleans and nulls; a `Date` or a `Buffer` is sent as text. */
const wire = (value: Param): Request["values"][number] => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value instanceof Uint8Array ? new TextDecoder().decode(value) : value;
};

const opened = async (socket: WebSocket): Promise<void> => {
  const { promise, resolve, reject } = Promise.withResolvers<null>();

  socket.addEventListener("open", () => {
    resolve(null);
  });
  socket.addEventListener("error", () => {
    reject(new Error("the session's socket did not open"));
  });
  await promise;
};

const openRemote = async (
  url: string,
  token: string,
  budget: Budget
): Promise<Remote> => {
  const socket = new WebSocket(url, [subprotocolOf(token)]);
  const pending = new Map<number, Pending>();
  let next = 1;
  let open = true;

  const fail = (error: Error): void => {
    open = false;

    for (const waiting of pending.values()) {
      waiting.reject(error);
    }

    pending.clear();
  };

  socket.addEventListener("message", (event) => {
    const parsed = response.safeParse(JSON.parse(z.string().parse(event.data)));

    if (!parsed.success) {
      fail(
        new Error("the Worker answered with something that is not a response")
      );

      return;
    }

    const waiting = pending.get(parsed.data.id);

    pending.delete(parsed.data.id);

    if (waiting === undefined) {
      return;
    }

    if (parsed.data.ok) {
      waiting.resolve(parsed.data.rows);
    } else {
      waiting.reject(new RemoteError(parsed.data.message, parsed.data.code));
    }
  });
  socket.addEventListener("close", () => {
    fail(new Error("the session's socket closed"));
  });
  socket.addEventListener("error", () => {
    fail(new Error("the session's socket failed"));
  });

  await opened(socket);

  return {
    alive: () => open,
    close: () => {
      open = false;
      socket.close();
    },
    send: async (text, values) => {
      if (!open) {
        throw new Error("the session's socket is closed");
      }

      // counted before it is sent: a run that would pass the day's budget stops here
      budget.spend(1);

      const id = next;

      next += 1;

      const { promise, resolve, reject } =
        Promise.withResolvers<readonly Row[]>();

      pending.set(id, { reject, resolve });
      socket.send(
        JSON.stringify({
          id,
          text,
          values: values.map(wire),
        } satisfies Request)
      );

      return await promise;
    },
  };
};

export interface RemoteOptions {
  /** `wss://…/session` of the Worker (or `ws://…` of the local twin). */
  readonly url: string;
  readonly token: string;
  /** Sessions open at once: each is one invocation of the Worker and one connection through Hyperdrive. */
  readonly sessions: number;
  readonly budget: Budget;
}

/**
 * A `@pg-txmode/pg` client whose statements run in a Worker, through its Hyperdrive binding. Its "pool" is a set of sockets:
 * a statement in autocommit takes an idle one, a transaction keeps one from `openingScript` to `COMMIT`, and a statement
 * that finds none waits for one to be given back. The mode is `hyperdrive`: the suite runs through the adapter as it runs
 * through any other client, and what is measured is what the origin does with the statements that reach it by this path.
 */
export const createRemoteClient = (options: RemoteOptions): TxClient => {
  const { budget } = options;
  const idle: Remote[] = [];
  const all = new Set<Remote>();
  const waiting: ((remote: Remote) => void)[] = [];

  /** A session that waits for a free one is given one, or the slot of one that was closed. */
  const acquire = async (): Promise<Remote> => {
    const reusable = idle.pop();

    if (reusable?.alive() === true) {
      return reusable;
    }

    if (all.size < options.sessions) {
      const remote = await openRemote(options.url, options.token, budget);

      all.add(remote);

      return remote;
    }

    const { promise, resolve } = Promise.withResolvers<Remote>();

    waiting.push(resolve);

    return await promise;
  };

  const release = (remote: Remote, usable: boolean): void => {
    const next = waiting.shift();

    if (usable && remote.alive()) {
      if (next === undefined) {
        idle.push(remote);
      } else {
        next(remote);
      }

      return;
    }

    remote.close();
    all.delete(remote);

    if (next !== undefined) {
      void (async () => {
        next(await acquire());
      })();
    }
  };

  const transactionOnce = async <T>(
    body: (tx: Transaction) => Promise<T>,
    run: TransactionRunOptions,
    attempt: number
  ): Promise<T> => {
    const remote = await acquire();
    let usable = false;

    try {
      await remote.send(openingScript(run), []);

      const result = await body({
        attempt,
        query: async (text, values = []) => await remote.send(text, values),
      });

      await remote.send("COMMIT", []);
      usable = true;

      return result;
    } catch (error) {
      try {
        await remote.send("ROLLBACK", []);
        usable = true;
      } catch {
        usable = false;
      }

      throw error;
    } finally {
      release(remote, usable);
    }
  };

  return {
    capabilities: capabilities(hyperdrive),
    end: async () => {
      await Promise.resolve();

      for (const remote of all) {
        remote.close();
      }

      all.clear();
      idle.length = 0;
      budget.flush();
    },
    mode: hyperdrive,
    query: async (text, values = []) => {
      const remote = await acquire();
      let usable = true;

      try {
        return await remote.send(text, values);
      } catch (error) {
        usable = error instanceof RemoteError && error.code !== undefined;

        throw error;
      } finally {
        release(remote, usable);
      }
    },
    transaction: async (body, run = {}) => {
      if (run.retry === false) {
        return await transactionOnce(body, run, 1);
      }

      return await withTransactionRetry(
        async (attempt) => await transactionOnce(body, run, attempt),
        { onRetry: run.onRetry, policy: run.retry, sleep: run.sleep }
      );
    },
  };
};

/** What `GET /health` of a Worker or its twin answers; the runner reads it before a run. */
export const checkHealth = async (
  baseUrl: string,
  token: string
): Promise<{ readonly database: string; readonly serverVersion: string }> => {
  const answer = await fetch(new URL("/health", baseUrl), {
    headers: { "Sec-WebSocket-Protocol": subprotocolOf(token) },
  });

  if (!answer.ok) {
    throw new Error(`GET /health answered ${answer.status}`);
  }

  return healthAnswer.parse(await answer.json());
};

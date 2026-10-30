import { describe, expect, test } from "vite-plus/test";

import { response, subprotocolOf } from "../src/protocol.ts";
import { openSession } from "../src/session.ts";
import type { Connection } from "../src/session.ts";

const sent = () => {
  const texts: string[] = [];

  return {
    send: (data: string) => {
      texts.push(data);
    },
    texts,
  };
};

const parsed = (text: string | undefined) =>
  response.parse(JSON.parse(text ?? "null"));

describe("a session of the probe Worker", () => {
  test("a statement is answered with its rows, in the order it was sent, on one connection", async () => {
    const socket = sent();
    let connections = 0;
    const order: string[] = [];

    const session = openSession(async () => {
      connections += 1;

      return {
        end: async () => {
          await Promise.resolve();
        },
        query: async (text) => {
          order.push(text);

          return await Promise.resolve({ rows: [{ text }] });
        },
      } satisfies Connection;
    }, socket);

    await Promise.all([
      session.message(JSON.stringify({ id: 1, text: "BEGIN", values: [] })),
      session.message(JSON.stringify({ id: 2, text: "SELECT 1", values: [] })),
    ]);

    expect(order).toStrictEqual(["BEGIN", "SELECT 1"]);
    expect(connections).toBe(1);
    expect(socket.texts.map((text) => parsed(text).id)).toStrictEqual([1, 2]);
  });

  test("a failure is answered with its message and its SQLSTATE, and the session stays usable", async () => {
    const socket = sent();

    const session = openSession(
      async () =>
        await Promise.resolve({
          end: async () => {
            await Promise.resolve();
          },
          query: async (text) => {
            if (text === "BAD") {
              throw Object.assign(new Error("boom"), { code: "23505" });
            }

            return await Promise.resolve({ rows: [] });
          },
        } satisfies Connection),
      socket
    );

    await session.message(JSON.stringify({ id: 1, text: "BAD", values: [] }));
    await session.message(JSON.stringify({ id: 2, text: "OK", values: [] }));

    expect(parsed(socket.texts[0])).toStrictEqual({
      code: "23505",
      id: 1,
      message: "boom",
      ok: false,
    });
    expect(parsed(socket.texts[1])).toStrictEqual({
      id: 2,
      ok: true,
      rows: [],
    });
  });

  test("control: a message that is not a statement is refused, and no connection is opened for it", async () => {
    const socket = sent();
    let connections = 0;

    const session = openSession(async () => {
      connections += 1;

      return await Promise.reject(new Error("must not connect"));
    }, socket);

    await session.message(JSON.stringify({ nope: true }));
    await session.message("not json");

    expect(socket.texts.map((text) => parsed(text).ok)).toStrictEqual([
      false,
      false,
    ]);
    expect(connections).toBe(0);
  });

  test("the token travels as a subprotocol", () => {
    expect(subprotocolOf("abc")).toBe("probe.abc");
  });
});

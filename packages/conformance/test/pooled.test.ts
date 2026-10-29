import { startStack } from "@pg-txmode/harness";
import type { Stack } from "@pg-txmode/harness";
import { afterAll, beforeAll } from "vite-plus/test";

import { defineConformance, roundsFromEnvironment } from "../src/index.ts";
import type { Target } from "../src/index.ts";

/**
 * PgBouncer 1.25 in transaction mode with Neon's settings and three server connections: concurrent clients really do
 * share and swap them, and a claim that waits for a lock (the hold falsifier) still leaves one for the holder and one for
 * the observer.
 */
let stack: Stack | undefined;

beforeAll(async () => {
  stack = await startStack(3);
}, 120_000);

afterAll(async () => {
  await stack?.stop();
});

const target: Target = {
  connect: async () => {
    if (stack === undefined) {
      throw new Error("the test stack is not running");
    }

    return await stack.connect();
  },
  name: "PgBouncer in transaction mode",
};

defineConformance(target, roundsFromEnvironment());

import { pgConnect, startPostgres } from "@pg-txmode/harness";
import type { Postgres } from "@pg-txmode/harness";
import { afterAll, beforeAll } from "vite-plus/test";

import { defineConformance, roundsFromEnvironment } from "../src/index.ts";
import type { Target } from "../src/index.ts";

/** PostgreSQL 18 directly: the control of every falsifier. */
let postgres: Postgres | undefined;

beforeAll(async () => {
  postgres = await startPostgres();
}, 120_000);

afterAll(async () => {
  await postgres?.stop();
});

const target: Target = {
  connect: async () => {
    if (postgres === undefined) {
      throw new Error("the test PostgreSQL is not running");
    }

    return await pgConnect(postgres.endpoint.url)();
  },
  name: "PostgreSQL directly",
};

defineConformance(target, roundsFromEnvironment());

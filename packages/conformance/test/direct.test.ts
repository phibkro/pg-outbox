import { pgConnect } from "@pg-txmode/harness";

import { defineConformance, roundsFromEnvironment } from "../src/index.ts";
import type { Target } from "../src/index.ts";
import { postgresServer } from "./postgresServer.ts";

/** PostgreSQL 18 directly: the control of every falsifier. */
const postgres = postgresServer();

const target: Target = {
  connect: async () => await pgConnect(postgres().endpoint.url)(),
  name: "PostgreSQL directly",
};

defineConformance(target, roundsFromEnvironment());

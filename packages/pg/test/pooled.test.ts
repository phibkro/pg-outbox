import {
  defineSubjectConformance,
  roundsFromEnvironment,
  suiteOutbox,
} from "@pg-outbox/conformance";
import { neonPooler } from "@pg-txmode/core";
import { startStack } from "@pg-txmode/harness";
import type { Stack } from "@pg-txmode/harness";
import { createDatabase } from "@pg-txmode/pg";
import type { TxClient } from "@pg-txmode/pg";
import { afterAll, beforeAll } from "vite-plus/test";

import { pgSubject } from "./pgSubject.ts";

/**
 * The `pg` adapter behind PgBouncer 1.25 in transaction mode with Neon's settings (`max_prepared_statements` 1000, the mode
 * `neonPooler`) and three server connections: concurrent clients really swap them.
 */
let stack: Stack | undefined;
let db: TxClient | undefined;

beforeAll(async () => {
  stack = await startStack(3);
  db = createDatabase({
    connectionString: stack.pooler.endpoint.url,
    maxConnections: 8,
    mode: neonPooler,
  });
}, 120_000);

afterAll(async () => {
  await db?.end();
  await stack?.stop();
});

defineSubjectConformance(
  "the pg adapter behind PgBouncer in transaction mode",
  (mutation) => {
    if (db === undefined) {
      throw new Error("the test stack is not running");
    }

    return pgSubject(suiteOutbox, db, mutation);
  },
  roundsFromEnvironment()
);

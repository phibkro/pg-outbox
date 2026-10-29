import {
  defineSubjectConformance,
  roundsFromEnvironment,
  suiteOutbox,
} from "@pg-outbox/conformance";
import { direct } from "@pg-txmode/core";
import { startPostgres } from "@pg-txmode/harness";
import type { Postgres } from "@pg-txmode/harness";
import { createDatabase } from "@pg-txmode/pg";
import type { TxClient } from "@pg-txmode/pg";
import { afterAll, beforeAll } from "vite-plus/test";

import { pgSubject } from "./pgSubject.ts";

/** The `pg` adapter over a direct connection to PostgreSQL 18: the control of every falsifier. */
let postgres: Postgres | undefined;
let db: TxClient | undefined;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDatabase({
    connectionString: postgres.endpoint.url,
    maxConnections: 8,
    mode: direct,
  });
}, 120_000);

afterAll(async () => {
  await db?.end();
  await postgres?.stop();
});

defineSubjectConformance(
  "the pg adapter on PostgreSQL directly",
  (mutation) => {
    if (db === undefined) {
      throw new Error("the test PostgreSQL is not running");
    }

    return pgSubject(suiteOutbox, db, mutation);
  },
  roundsFromEnvironment()
);

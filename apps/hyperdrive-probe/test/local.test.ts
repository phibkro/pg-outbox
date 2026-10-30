import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  defineSubjectConformance,
  roundsFromEnvironment,
  suiteOutbox,
} from "@pg-outbox/conformance";
import { startPostgres } from "@pg-txmode/harness";
import type { Postgres } from "@pg-txmode/harness";
import type { TxClient } from "@pg-txmode/pg";
import { afterAll, beforeAll } from "vite-plus/test";

import { pgSubject } from "../../../packages/pg/test/pgSubject.ts";
import { openBudget } from "../src/budget.ts";
import { startLocalTwin } from "../src/localTwin.ts";
import type { LocalTwin } from "../src/localTwin.ts";
import { createRemoteClient } from "../src/remote.ts";

/**
 * The whole conformance suite, through the `pg` adapter, over the remote client and the local twin of the Worker, in front of a
 * PostgreSQL 18 of this machine. It shows that the runner, the protocol and the client are right (a run that fails here would
 * fail for the probe's own reasons). It is NOT Hyperdrive: nothing in this file reaches Cloudflare.
 */
const token = "local-twin-token";
let postgres: Postgres | undefined;
let twin: LocalTwin | undefined;
let db: TxClient | undefined;

beforeAll(async () => {
  postgres = await startPostgres();
  twin = await startLocalTwin(postgres.endpoint.url, token);
  db = createRemoteClient({
    budget: openBudget(
      path.join(mkdtempSync(path.join(tmpdir(), "probe-budget-")), "used.json"),
      { limit: 10_000_000 }
    ),
    sessions: 8,
    token,
    url: twin.url,
  });
}, 120_000);

afterAll(async () => {
  await db?.end();
  await twin?.stop();
  await postgres?.stop();
});

defineSubjectConformance(
  "the pg adapter over the remote client and the local twin of the Worker",
  (mutation) => {
    if (db === undefined) {
      throw new Error("the local twin is not running");
    }

    return pgSubject(suiteOutbox, db, mutation, { allowUnverified: true });
  },
  roundsFromEnvironment()
);

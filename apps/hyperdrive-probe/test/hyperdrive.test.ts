import { readFileSync } from "node:fs";

import {
  defineSubjectConformance,
  roundsFromEnvironment,
  suiteOutbox,
} from "@pg-outbox/conformance";
import type { TxClient } from "@pg-txmode/pg";
import { afterAll, beforeAll } from "vite-plus/test";

import { pgSubject } from "../../../packages/pg/test/pgSubject.ts";
import { openBudget } from "../src/budget.ts";
import { checkHealth, createRemoteClient } from "../src/remote.ts";

/**
 * The conformance suite through a deployed probe Worker (or `bun run probe local`'s workerd), by the `pg` adapter, over the
 * remote client: every statement of every falsifier and every control reaches the database through the Worker's Hyperdrive
 * binding (or, locally, its stand-in). It runs only through `bun run probe` (`vite.probe.config.ts`), which sets:
 *
 * - PG_OUTBOX_PROBE_URL, the Worker's address (`https://…` or `http://127.0.0.1:<port>`);
 * - PG_OUTBOX_PROBE_TOKEN_FILE, the file with the run's token (mode 0600; its content is never printed);
 * - PG_OUTBOX_PROBE_BUDGET, the file that counts the day's statements;
 * - PG_OUTBOX_ROUNDS, the rounds of a race.
 */
const required = (name: string): string => {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`${name} is not set: run this through bun run probe`);
  }

  return value;
};

const base = required("PG_OUTBOX_PROBE_URL");

const token = readFileSync(
  required("PG_OUTBOX_PROBE_TOKEN_FILE"),
  "utf-8"
).trim();

const budget = openBudget(required("PG_OUTBOX_PROBE_BUDGET"));
let db: TxClient | undefined;

beforeAll(async () => {
  const health = await checkHealth(base, token);

  process.stdout.write(`the origin: PostgreSQL ${health.serverVersion}\n`);
  db = createRemoteClient({
    budget,
    // each concurrent claimer is one session: one invocation of the Worker, one connection of its binding
    sessions: 24,
    token,
    url: new URL("/session", base.replace(/^http/u, "ws")).toString(),
  });
}, 120_000);

afterAll(async () => {
  await db?.end();
  process.stdout.write(`statements sent today: ${budget.used()}\n`);
});

defineSubjectConformance(
  "the pg adapter through the probe Worker",
  (mutation) => {
    if (db === undefined) {
      throw new Error("the probe client is not open");
    }

    return pgSubject(suiteOutbox, db, mutation, { allowUnverified: true });
  },
  roundsFromEnvironment()
);

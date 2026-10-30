// The spike of spec 0004: `select 1` and a transaction through the real Worker code under workerd (`wrangler dev`), in front of a
// PostgreSQL of this machine. It shows that the Worker bundles, that `pg` runs in it, and that the runner's client speaks to it. It
// does not touch Cloudflare and it is not Hyperdrive.
//
//   devenv shell -- bun scripts/spike.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { startPostgres } from "@pg-txmode/harness";

import { openBudget } from "../src/budget.ts";
import { checkHealth, createRemoteClient } from "../src/remote.ts";
import { startWorkerd } from "../src/workerd.ts";

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const token = "spike-token";
const postgres = await startPostgres();

const worker = await startWorkerd({
  connectionString: postgres.endpoint.url,
  port: 8799,
  token,
});

try {
  say(`health: ${JSON.stringify(await checkHealth(worker.baseUrl, token))}`);

  const wrong = await fetch(new URL("/health", worker.baseUrl), {
    headers: { "Sec-WebSocket-Protocol": "probe.wrong" },
  });

  say(`a wrong token answers ${wrong.status}`);

  const db = createRemoteClient({
    budget: openBudget(
      path.join(mkdtempSync(path.join(tmpdir(), "spike-budget-")), "used.json"),
      { limit: 1000 }
    ),
    sessions: 2,
    token,
    url: worker.sessionUrl,
  });

  try {
    say(`select 1: ${JSON.stringify(await db.query("SELECT 1::int AS one"))}`);
    say(
      `transaction: ${JSON.stringify(
        await db.transaction(async (tx) => {
          await tx.query("CREATE TEMP TABLE spike (n int) ON COMMIT DROP");
          await tx.query("INSERT INTO spike VALUES (1), (2)");

          return await tx.query("SELECT sum(n)::int AS total FROM spike");
        })
      )}`
    );
  } finally {
    await db.end();
  }
} finally {
  worker.stop();
  await postgres.stop();
}

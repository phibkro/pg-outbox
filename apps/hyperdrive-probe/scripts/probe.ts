// The runner of spec 0004. One command per step of the journey; nothing here prints a credential (only key names, lengths and
// booleans). `up`, `run`, `down` and `status` talk to Cloudflare with the Alchemy profile `default` and to the disposable Neon
// branch through the connection string that the operator put in a 0600 file.
//
//   devenv shell -- bun run --cwd apps/hyperdrive-probe probe <local|up|run|record|down|status>
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import { startPostgres } from "@pg-txmode/harness";
import { z } from "zod";

import { startWorkerd } from "../src/workerd.ts";

const app = path.resolve(import.meta.dirname, "..");
const root = path.resolve(app, "../..");
const dot = path.join(app, ".probe");
const tokenFile = path.join(dot, "token");
const stateFile = path.join(dot, "state.json");
const budgetFile = path.join(dot, "budget.json");

const neonFile = path.join(
  homedir(),
  ".config/pg-outbox-probe/neon-connection-string"
);

const profileFile = path.join(
  homedir(),
  ".alchemy/profiles/default/cloudflare.json"
);

const names = {
  hyperdrive: "pg-outbox-probe",
  worker: "pg-outbox-probe",
} as const;

const placeholders = {
  PROBE_NEON_DATABASE: "unused",
  PROBE_NEON_HOST: "unused",
  PROBE_NEON_PASSWORD: "unused",
  PROBE_NEON_USER: "unused",
} as const;

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const state = z.object({ deployedAt: z.string(), url: z.string() });

/** The disposable database's parts, from the operator's file; the file's content is never printed. */
const neon = () => {
  const url = new URL(readFileSync(neonFile, "utf-8").trim());

  return {
    PROBE_NEON_DATABASE: url.pathname.slice(1),
    PROBE_NEON_HOST: url.hostname,
    PROBE_NEON_PASSWORD: decodeURIComponent(url.password),
    PROBE_NEON_USER: decodeURIComponent(url.username),
  };
};

const profile = z.object({
  values: z.object({
    access: z.string(),
    accountId: z.string(),
    expires: z.number(),
  }),
});

const cloudflareToken = () =>
  profile.parse(JSON.parse(readFileSync(profileFile, "utf-8"))).values;

const api = async (
  resource: string
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const { access, accountId } = cloudflareToken();

  const answer = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/${resource}`,
    { headers: { Authorization: `Bearer ${access}` } }
  );

  return { body: await answer.json().catch(() => null), status: answer.status };
};

const exists = z.object({
  result: z.array(z.object({ name: z.string() })).optional(),
});

/** A read-only look at the account: does the Worker exist, and which Hyperdrive configurations bear the probe's name? */
const look = async () => {
  const worker = await api(`workers/scripts/${names.worker}`);
  const configs = await api("hyperdrive/configs");
  const listed = exists.safeParse(configs.body);

  return {
    hyperdriveStatus: configs.status,
    hyperdrives: listed.success
      ? (listed.data.result ?? []).filter((c) => c.name === names.hyperdrive)
          .length
      : -1,
    workerExists: worker.status === 200,
    workerStatus: worker.status,
  };
};

const alchemy = (
  args: readonly string[],
  env: Record<string, string>,
  output: string
): number => {
  const result = spawnSync(
    "bunx",
    [
      "alchemy",
      ...args,
      "--stage",
      "probe",
      "--profile",
      "default",
      "--yes",
      "--no-input",
    ],
    {
      cwd: path.join(app, "deploy"),
      encoding: "utf-8",
      env: { ...process.env, ...env },
    }
  );

  writeFileSync(output, `${result.stdout}\n${result.stderr}`);

  return result.status ?? 1;
};

const vitest = (env: Record<string, string>, output: string): number => {
  const result = spawnSync(
    "bunx",
    [
      "vp",
      "test",
      "run",
      "--config",
      "vite.probe.config.ts",
      "--reporter=verbose",
    ],
    {
      cwd: app,
      encoding: "utf-8",
      env: { ...process.env, ...env },
      maxBuffer: 256 * 1024 * 1024,
    }
  );

  writeFileSync(output, `${result.stdout}\n${result.stderr}`);

  return result.status ?? 1;
};

const runEnv = (url: string) => ({
  PG_OUTBOX_PROBE_BUDGET: budgetFile,
  PG_OUTBOX_PROBE_TOKEN_FILE: tokenFile,
  PG_OUTBOX_PROBE_URL: url,
  PG_OUTBOX_ROUNDS: process.env.PG_OUTBOX_ROUNDS ?? "20",
});

/** What a recorded run must not carry: a Worker address, a host, an identifier or a secret. */
const scrub = (text: string): string =>
  stripVTControlCharacters(text)
    .replaceAll(/https?:\/\/[^\s"')]+/gu, "<url>")
    .replaceAll(/wss?:\/\/[^\s"')]+/gu, "<url>")
    .replaceAll(/\b[0-9a-f]{32,}\b/gu, "<hex>")
    .replaceAll(/[\w-]+\.neon\.tech/gu, "<host>");

/** The recorded run: what ran, with what, and the suite's own lines. The format of pg-txmode's recorded run of another project. */
const evidenceOf = (raw: string, day: string): string =>
  [
    "# Recorded run through Cloudflare Hyperdrive: pg-outbox, spec 0004",
    "",
    "| | |",
    "| --- | --- |",
    `| Date (UTC) | ${day} |`,
    `| Commit | ${spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).stdout.trim()} |`,
    "| What ran | the conformance suite of pg-outbox (spec 0001), unchanged, through the `pg` adapter over a client whose statements run in a Worker deployed on Cloudflare; the Worker's only database address is a Hyperdrive binding, in front of a disposable Neon branch (PostgreSQL) |",
    "| Worker compatibility | date `2026-10-01`, flags `nodejs_compat`, `enable_request_signal` |",
    "| Hyperdrive caching | **enabled** (Hyperdrive's default) |",
    `| Rounds of a race | ${process.env.PG_OUTBOX_ROUNDS ?? "20"} |`,
    "| Left out | the Worker's address, the Hyperdrive and Neon identifiers, the host, the token |",
    "",
    "Hyperdrive caching: enabled",
    "",
    "```text",
    scrub(raw).trim(),
    "```",
    "",
  ].join("\n");

const stamp = (): string => new Date().toISOString().replaceAll(/[:.]/gu, "-");

/** A read-only look at the account and at what the probe left on this machine; the exit code is 0 only when nothing remains in the account. */
const status = async (): Promise<number> => {
  const seen = await look();

  say(
    JSON.stringify({
      hyperdriveConfigsNamedForTheProbe: seen.hyperdrives,
      hyperdriveListStatus: seen.hyperdriveStatus,
      neonStringFile: existsSync(neonFile),
      tokenFile: existsSync(tokenFile),
      workerExists: seen.workerExists,
      workerStatus: seen.workerStatus,
    })
  );

  return seen.workerExists || seen.hyperdrives !== 0 ? 1 : 0;
};

const commands = {
  down: async () => {
    mkdirSync(dot, { recursive: true });

    // destroy needs the stack's inputs to evaluate it, not their values: the real ones when the file is still there
    const inputs = existsSync(neonFile) ? neon() : placeholders;

    const code = alchemy(
      ["destroy"],
      { ...inputs, PROBE_TOKEN: "unused" },
      path.join(dot, `destroy-${stamp()}.txt`)
    );

    say(`alchemy destroy exited ${code}`);

    for (const file of [tokenFile, stateFile, neonFile]) {
      rmSync(file, { force: true });
    }

    return await status();
  },
  local: async () => {
    mkdirSync(dot, { recursive: true });

    const postgres = await startPostgres();
    const token = randomBytes(16).toString("hex");
    const scratch = path.join(tmpdir(), `probe-local-${stamp()}`);

    mkdirSync(scratch, { recursive: true });
    writeFileSync(path.join(scratch, "token"), token, { mode: 0o600 });

    const worker = await startWorkerd({
      connectionString: postgres.endpoint.url,
      port: 8798,
      token,
    });

    try {
      const output = path.join(dot, `local-${stamp()}.txt`);

      const code = vitest(
        {
          PG_OUTBOX_PROBE_BUDGET: path.join(scratch, "budget.json"),
          PG_OUTBOX_PROBE_TOKEN_FILE: path.join(scratch, "token"),
          PG_OUTBOX_PROBE_URL: worker.baseUrl,
          PG_OUTBOX_ROUNDS: process.env.PG_OUTBOX_ROUNDS ?? "10",
        },
        output
      );

      say(
        `the suite under workerd (not Hyperdrive) exited ${code}; raw output: ${output}`
      );

      return code;
    } finally {
      worker.stop();
      await postgres.stop();
    }
  },
  record: async () => {
    const outputs = readdirSync(dot)
      .filter((file) => file.startsWith("run-"))
      .toSorted();

    const latest = outputs.at(-1);

    if (latest === undefined) {
      say("no run to record: bun run probe run first");

      return 1;
    }

    const day = new Date().toISOString().slice(0, 10);

    const target = path.join(
      root,
      `docs/evidence/hyperdrive/${day}-pg-outbox-probe.md`
    );

    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(
      target,
      evidenceOf(readFileSync(path.join(dot, latest), "utf-8"), day)
    );
    say(`recorded: ${path.relative(root, target)}`);

    return 0;
  },
  run: async () => {
    const { url } = state.parse(JSON.parse(readFileSync(stateFile, "utf-8")));
    const output = path.join(dot, `run-${stamp()}.txt`);
    const code = vitest(runEnv(url), output);

    say(
      `the suite through the deployed Worker exited ${code}; raw output: ${output}`
    );

    return code;
  },
  status,
  up: async () => {
    mkdirSync(dot, { recursive: true });

    const seen = await look();

    say(`before: ${JSON.stringify(seen)}`);

    if (
      seen.hyperdriveStatus !== 200 ||
      seen.workerStatus === 401 ||
      seen.workerStatus === 403
    ) {
      say(
        "the profile cannot read the account (see the statuses above): stopping before any deploy"
      );

      return 1;
    }

    if (!existsSync(tokenFile)) {
      writeFileSync(tokenFile, randomBytes(24).toString("hex"), {
        mode: 0o600,
      });
      chmodSync(tokenFile, 0o600);
    }

    const token = readFileSync(tokenFile, "utf-8").trim();
    const output = path.join(dot, `deploy-${stamp()}.txt`);
    const code = alchemy(["deploy"], { ...neon(), PROBE_TOKEN: token }, output);

    say(`alchemy deploy exited ${code}; raw output: ${output}`);

    const url = /https:\/\/[\w.-]+\.workers\.dev/u.exec(
      readFileSync(output, "utf-8")
    )?.[0];

    if (code !== 0 || url === undefined) {
      return code === 0 ? 1 : code;
    }

    writeFileSync(
      stateFile,
      JSON.stringify({ deployedAt: new Date().toISOString(), url })
    );
    say("deployed; the Worker's address is in .probe/state.json");

    return 0;
  },
};

const name = process.argv[2] ?? "";
const command = Object.entries(commands).find(([key]) => key === name)?.[1];

if (command === undefined) {
  say(`usage: probe <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}

process.exit(await command());

// Runs every case of model/cases.json through TLC and compares what it finds with what the case expects.
// Exit 0: every run is as expected. Exit 1: the correct model has an error, a broken variant has none (or another one),
// or a reach case finds nothing. Exit 2: TLC is missing. `--digest` prints the digest of the files the model covers.
//
// Usage: bun tools/model/run.ts [--digest] [--only <case id>]
// Environment: TLC_WORKERS (default 4), OUT (default: a temporary directory; the configs, the outputs and the traces stay there).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  configOf,
  digestOf,
  expectation,
  readCases,
  readConfirmed,
} from "./model.ts";
import type { ModelCase } from "./model.ts";

const root = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);

if (args.includes("--digest")) {
  process.stdout.write(`${digestOf(root, readConfirmed(root).covers)}\n`);
  process.exit(0);
}

const tlc = spawnSync("tlc", ["-h"], { encoding: "utf-8" });

if (tlc.error !== undefined) {
  process.stderr.write(
    "tlc is not on PATH. Run this inside `devenv shell` (devenv.nix adds tlaplus and jre8).\n"
  );
  process.exit(2);
}

const cases = readCases(root);

const only = args.includes("--only")
  ? args[args.indexOf("--only") + 1]
  : undefined;

const out =
  process.env.OUT ?? mkdtempSync(path.join(tmpdir(), "pg-outbox-model-"));

const workers = process.env.TLC_WORKERS ?? "4";

interface Finding {
  readonly states: string;
  readonly violated: string | undefined;
  readonly clean: boolean;
  readonly steps: readonly string[];
}

const readFinding = (output: string): Finding => {
  const violated = /Invariant (?<name>\w+) is violated/u.exec(output)?.groups
    ?.name;

  const steps = [
    ...output.matchAll(/^State \d+: <(?<action>\w+)\(?[^ ]*/gmu),
  ].map((match) => match.groups?.action ?? "");

  return {
    clean: output.includes(
      "Model checking completed. No error has been found."
    ),
    states:
      /(?<n>[\d,]+) distinct states found/u.exec(output)?.groups?.n ?? "?",
    steps: steps.filter((step) => step !== "Initial"),
    violated,
  };
};

interface Result {
  readonly ok: boolean;
  readonly line: string;
}

const run = (model: ModelCase): Result => {
  const config = path.join(out, `${model.id}.cfg`);

  writeFileSync(config, configOf(cases, model));

  const result = spawnSync(
    "tlc",
    [
      "-workers",
      workers,
      "-deadlock",
      "-metadir",
      path.join(out, `${model.id}.states`),
      "-config",
      config,
      "ClaimFence.tla",
    ],
    {
      cwd: path.join(root, "model"),
      encoding: "utf-8",
      maxBuffer: 256 * 1024 * 1024,
    }
  );

  const output = `${result.stdout}\n${result.stderr}`;

  writeFileSync(path.join(out, `${model.id}.out`), output);

  const found = readFinding(output);

  const ok =
    model.kind === "holds" ? found.clean : found.violated === model.violates;

  const what = found.clean ? "no error" : `violates ${found.violated ?? "?"}`;

  const trace =
    model.kind === "holds" || found.steps.length === 0
      ? ""
      : `  trace: ${found.steps.join(" -> ")}`;

  return {
    line: `${ok ? "ok  " : "FAIL"} ${model.id.padEnd(24)} expected ${expectation(model).padEnd(36)} found ${what} (${found.states} states)${trace}`,
    ok,
  };
};

let failed = 0;

for (const model of cases.cases) {
  if (only !== undefined && model.id !== only) {
    continue;
  }

  const { ok, line } = run(model);

  process.stdout.write(`${line}\n`);

  if (!ok) {
    failed += 1;
  }
}

process.stdout.write(`TLC output, configs and traces: ${out}\n`);

const confirmed = readConfirmed(root);
const digest = digestOf(root, confirmed.covers);

if (digest !== confirmed.digest) {
  process.stdout.write(
    `DRIFT the covered files changed: digest ${digest} is not the confirmed ${confirmed.digest}. Read the diff of ${confirmed.covers.join(", ")}, update model/ClaimFence.tla where a statement changed, and record the new digest (bun tools/model/run.ts --digest) in model/confirmed.json.\n`
  );
  failed += 1;
}

process.exit(failed === 0 ? 0 : 1);

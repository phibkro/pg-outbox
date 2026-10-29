import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vite-plus/test";

import {
  configOf,
  declaredOperations,
  digestOf,
  readCases,
  readConfirmed,
  taggedOperations,
} from "../model.ts";
import type { ModelCase } from "../model.ts";

const root = path.resolve(import.meta.dirname, "../../..");

const read = (file: string): string =>
  readFileSync(path.join(root, file), "utf-8");

const cases = readCases(root);
const declared = declaredOperations(read("packages/core/src/operations.ts"));
const tagged = taggedOperations(read("model/ClaimFence.tla"));

/** Ids in `tagged` that are not declared, and declared ids that are neither tagged nor listed as not modelled. */
const gaps = (
  declaredIds: readonly string[],
  taggedIds: readonly string[],
  notModelled: readonly string[]
): readonly string[] => [
  ...taggedIds.flatMap((id) =>
    declaredIds.includes(id)
      ? []
      : [`${id}: tagged in the model, not an operation of the core`]
  ),
  ...notModelled.flatMap((id) =>
    !declaredIds.includes(id) || taggedIds.includes(id)
      ? [`${id}: listed as not modelled, but it is unknown or tagged`]
      : []
  ),
  ...declaredIds.flatMap((id) =>
    taggedIds.includes(id) || notModelled.includes(id)
      ? []
      : [`${id}: neither modelled nor listed as not modelled`]
  ),
];

describe("the model and the core name the same operations", () => {
  test("every operation of the core is an action of the model or says why it is not", () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(
      gaps(declared, tagged, Object.keys(cases.notModelled))
    ).toStrictEqual([]);
  });

  test("control: a tag for an unknown operation, an unlisted operation and a wrong not-modelled entry are found", () => {
    expect(gaps(["a", "b", "c"], ["a", "x"], ["b", "a", "y"])).toStrictEqual([
      "x: tagged in the model, not an operation of the core",
      "a: listed as not modelled, but it is unknown or tagged",
      "y: listed as not modelled, but it is unknown or tagged",
      "c: neither modelled nor listed as not modelled",
    ]);
  });

  test("the tags are read from the TLA+ comment lines", () => {
    expect(
      taggedOperations(
        "\\* @operation claimById claimBatch\n(* @operation ack *)"
      )
    ).toStrictEqual(["claimById", "claimBatch", "ack"]);
  });
});

const conformanceSource = (): string =>
  readdirSync(path.join(root, "packages/conformance/src"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => read(`packages/conformance/src/${file}`))
    .join("\n");

describe("every broken variant has the SQL control that makes the same defect", () => {
  test("each control id of cases.json is the id of a control of the conformance suite", () => {
    const source = conformanceSource();

    const missing = cases.cases.flatMap((model) =>
      model.kind === "broken"
        ? model.control.filter((id) => !source.includes(`id: "${id}"`))
        : []
    );

    expect(missing).toStrictEqual([]);
  });

  test("each broken variant turns exactly one rule off, and each reach case checks an invariant that exists", () => {
    for (const model of cases.cases) {
      if (model.kind === "broken") {
        const correct = new Map(Object.entries(cases.rules));

        const same = Object.entries(model.rules).filter(
          ([name, value]) => correct.get(name) === value
        );

        expect(
          same,
          `${model.id} must differ from the correct rules`
        ).toStrictEqual([]);
        expect(Object.keys(model.rules), model.id).toHaveLength(1);
      }

      if (model.kind !== "holds") {
        expect(read("model/ClaimFence.tla")).toContain(`${model.violates} ==`);
      }
    }
  });

  test("a broken variant's configuration checks one invariant, the correct one checks them all", () => {
    const holds = cases.cases.find((model) => model.kind === "holds");
    const broken = cases.cases.find((model) => model.kind === "broken");

    if (holds === undefined || broken === undefined) {
      throw new Error("cases.json has no correct case or no broken case");
    }

    const invariants = (model: ModelCase): readonly string[] =>
      configOf(cases, model)
        .split("\n")
        .filter((line) => line.startsWith("INVARIANT "));

    expect(invariants(holds)).toHaveLength(cases.invariants.length);
    expect(invariants(broken)).toHaveLength(1);
    expect(configOf(cases, broken)).toContain("= FALSE");
  });
});

describe("the model is confirmed against the code it covers", () => {
  const confirmed = readConfirmed(root);

  test("the digest of the covered files is the recorded one", () => {
    expect(digestOf(root, confirmed.covers)).toBe(confirmed.digest);
  });

  test("control: one changed byte in a covered file changes the digest", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pg-outbox-model-test-"));

    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");

    const before = digestOf(dir, ["a.ts"]);

    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    expect(digestOf(dir, ["a.ts"])).not.toBe(before);
  });
});

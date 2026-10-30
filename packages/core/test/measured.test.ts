import { readFileSync } from "node:fs";
import path from "node:path";

import { direct, hyperdrive, neonPooler } from "@pg-txmode/core";
import { describe, expect, test } from "vite-plus/test";

import {
  exercisedBy,
  measurements,
  operationById,
  operationIds,
  operationSupport,
  supportGiven,
} from "../src/index.ts";
import type { Measurement } from "../src/index.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

/** The lines of a recorded run (vitest's verbose reporter) that say a falsifier held. */
const passing = (text: string, id: string): boolean =>
  new RegExp(`^\\s*✓.*\\b${id} holds:`, "mu").test(text);

/** What a recorded run must show for a measurement: caching on, and every falsifier of the operation passing. */
const problems = (
  text: string,
  measurement: Measurement
): readonly string[] => [
  ...(text.includes("Hyperdrive caching: enabled")
    ? []
    : ["the run does not say that Hyperdrive's caching was enabled"]),
  ...exercisedBy[measurement.operation]
    .filter((id) => !passing(text, id))
    .map((id) => `no passing line for ${id}`),
];

const measured = (operation: Measurement["operation"]): Measurement => ({
  evidence: "docs/evidence/hyperdrive/synthetic.md",
  mode: hyperdrive,
  on: "2026-10-30",
  operation,
});

describe("a recorded run lifts an operation from unverified, and only that operation, on that mode", () => {
  test("without a run every operation is unverified on Hyperdrive", () => {
    for (const id of operationIds) {
      expect(supportGiven([], hyperdrive, id)).toBe("unverified");
    }
  });

  test("a run for enqueue makes enqueue yes on Hyperdrive and nothing else; PgBouncer's and direct's answers do not change", () => {
    const recorded = [measured("enqueue")];

    expect(supportGiven(recorded, hyperdrive, "enqueue")).toBe("yes");

    for (const id of operationIds.filter((other) => other !== "enqueue")) {
      expect(supportGiven(recorded, hyperdrive, id), id).toBe("unverified");
    }

    expect(supportGiven(recorded, direct, "enqueue")).toBe("yes");
    expect(supportGiven(recorded, neonPooler, "claimById")).toBe("yes");
  });

  test("claimById stays unverified while classify, which it may run after itself, is not measured", () => {
    expect(supportGiven([measured("claimById")], hyperdrive, "claimById")).toBe(
      "yes"
    );
    expect(supportGiven([measured("classify")], hyperdrive, "claimById")).toBe(
      "unverified"
    );
  });

  test("every operation that follows another is measured only with it", () => {
    const following = operationIds.filter(
      (id) => operationById(id).follows !== undefined
    );

    expect(following).toStrictEqual(["claimById"]);

    for (const id of following) {
      for (const follower of operationById(id).follows ?? []) {
        expect(
          measurements.some((run) => run.operation === id) ===
            measurements.some((run) => run.operation === follower),
          `${id} and ${follower}`
        ).toBe(true);
      }
    }
  });
});

describe("the recorded runs are backed by their evidence", () => {
  test("each measurement names a file that exists and shows caching enabled and every falsifier of the operation passing", () => {
    for (const measurement of measurements) {
      const text = readFileSync(
        path.join(repoRoot, measurement.evidence),
        "utf-8"
      );

      expect(problems(text, measurement), measurement.operation).toStrictEqual(
        []
      );
      expect(measurement.on).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(operationSupport(measurement.mode, measurement.operation)).toBe(
        "yes"
      );
    }
  });

  test("control: a run with a missing or failing falsifier, or with caching off, is refused", () => {
    const run = [
      "Hyperdrive caching: enabled",
      ...exercisedBy.enqueue.map((id) => ` ✓ the suite > ${id} holds: a title`),
    ].join("\n");

    expect(problems(run, measured("enqueue"))).toStrictEqual([]);
    expect(
      problems(
        run.replace(" ✓ the suite > F19 holds", " × the suite > F19 holds"),
        measured("enqueue")
      )
    ).toStrictEqual(["no passing line for F19"]);
    expect(
      problems(run.replace("enabled", "disabled"), measured("enqueue"))
    ).toStrictEqual([
      "the run does not say that Hyperdrive's caching was enabled",
    ]);
  });
});

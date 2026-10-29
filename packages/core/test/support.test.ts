import {
  direct,
  hyperdrive,
  capabilities,
  cellOf,
  neonPooler,
  pgBouncer,
  featureRows,
} from "@pg-txmode/core";
import type { Feature } from "@pg-txmode/core";
import { describe, expect, test } from "vite-plus/test";

import {
  capCachedRead,
  operationIds,
  operationSupport,
  operations,
  requireOperation,
  supportOfOutcome,
  UnsupportedOperationError,
} from "../src/index.ts";

describe("the mode check", () => {
  test("every operation is supported on direct and on PgBouncer, and unverified on Hyperdrive except enqueue", () => {
    for (const id of operationIds) {
      expect(operationSupport(direct, id)).toBe("yes");
      expect(operationSupport(pgBouncer(0), id)).toBe("yes");
      expect(operationSupport(neonPooler, id)).toBe("yes");
      expect(operationSupport(hyperdrive, id)).toBe(
        id === "enqueue" ? "yes" : "unverified"
      );
    }
  });

  test("an unverified operation is refused with the catalogue's words unless the caller accepts it", () => {
    expect(() => {
      requireOperation(hyperdrive, "claimBatch");
    }).toThrow(UnsupportedOperationError);
    expect(() => {
      requireOperation(hyperdrive, "claimBatch");
    }).toThrow(/skip-locked/u);
    expect(() => {
      requireOperation(hyperdrive, "claimBatch", { allowUnverified: true });
    }).not.toThrow();
  });

  test("a read behind a read cache is unverified at best, however well documented its rows are", () => {
    expect(capCachedRead("yes", true, true)).toBe("unverified");
    expect(capCachedRead("yes", false, true)).toBe("yes");
    expect(capCachedRead("yes", true, false)).toBe("yes");
    expect(capCachedRead("no", true, true)).toBe("no");
  });

  test("the outcome mapping is the one capabilities() uses, for every row that has a feature name", () => {
    const features: readonly Feature[] = [
      "listen",
      "notify",
      "onConflict",
      "rowLocks",
      "savepoints",
      "sessionAdvisoryLock",
      "transactionAdvisoryLock",
      "isolationLevel",
      "pipelining",
    ];

    for (const mode of [direct, hyperdrive, neonPooler, pgBouncer(0)]) {
      for (const feature of features) {
        expect(
          supportOfOutcome(cellOf(mode, featureRows[feature]).outcome),
          `${feature} on ${JSON.stringify(mode)}`
        ).toBe(capabilities(mode)[feature]);
      }
    }
  });

  test("every operation names catalogue rows and every read is flagged", () => {
    expect(operations.every((operation) => operation.rows.length > 0)).toBe(
      true
    );
    expect(
      operations.filter((operation) => operation.reads).map((o) => o.id)
    ).toStrictEqual(["classify", "stale", "counts", "open"]);
  });
});

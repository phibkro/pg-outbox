import {
  direct,
  hyperdrive,
  capabilities,
  cellOf,
  neonPooler,
  pgBouncer,
  featureRows,
  rowById,
  supavisor,
} from "@pg-txmode/core";
import type { Feature } from "@pg-txmode/core";
import { describe, expect, test } from "vite-plus/test";

import {
  capCachedRead,
  coverageGaps,
  operationIds,
  operationSupport,
  operations,
  requireOperation,
  supportOfOutcome,
  UnsupportedOperationError,
} from "../src/index.ts";

describe("the mode check", () => {
  test("direct and PgBouncer support every operation; Hyperdrive and Supavisor, where nothing ran, say unverified for every one", () => {
    for (const id of operationIds) {
      expect(operationSupport(direct, id), `${id} direct`).toBe("yes");
      expect(operationSupport(pgBouncer(0), id), `${id} pgbouncer`).toBe("yes");
      expect(operationSupport(neonPooler, id), `${id} neon`).toBe("yes");
      expect(operationSupport(hyperdrive, id), `${id} hyperdrive`).toBe(
        "unverified"
      );
      expect(operationSupport(supavisor, id), `${id} supavisor`).toBe(
        "unverified"
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

  test("enqueue on Hyperdrive is refused for what the recorded run did not cover, and says so", () => {
    expect(() => {
      requireOperation(hyperdrive, "enqueue");
    }).toThrow(
      /concurrent DO NOTHING claim, with exactly one winner, was not run/u
    );
    expect(() => {
      requireOperation(hyperdrive, "enqueue", { allowUnverified: true });
    }).not.toThrow();
  });

  test("a Supavisor refusal says that the cell is the measured PgBouncer's and that no run was made on it", () => {
    expect(() => {
      requireOperation(supavisor, "claimById");
    }).toThrow(
      /inherited by a transaction-pooled \(supavisor\) connection, where no run was made/u
    );
  });

  test("every coverage gap names a sentence that the catalogue's note still holds", () => {
    expect(coverageGaps.length).toBeGreaterThan(0);

    for (const gap of coverageGaps) {
      expect(cellOf(gap.mode, gap.row).note, gap.row).toContain(gap.phrase);
    }
  });

  test("the rows the operations rest on have no cell of Supavisor's own, and none is `works` without being documented or measured", () => {
    const rows = new Set(operations.flatMap((operation) => operation.rows));

    for (const row of rows) {
      expect(cellOf(supavisor, row), `${row} on supavisor`).toBe(
        rowById(row).transactionPooled
      );

      for (const column of [
        "direct",
        "transactionPooled",
        "hyperdrive",
      ] as const) {
        const cell = rowById(row)[column];

        expect(
          cell.outcome === "works" && cell.verifiedBy === "unverified",
          `${row} ${column}`
        ).toBe(false);
      }
    }
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

describe("an operation is no stronger than the operations it may run after itself", () => {
  test("claimById can run classify, a read: the refusal says so and quotes both operations' rows", () => {
    expect(operationSupport(direct, "claimById")).toBe("yes");
    expect(operationSupport(hyperdrive, "claimById")).toBe("unverified");
    expect(() => {
      requireOperation(hyperdrive, "claimById");
    }).toThrow(/may run classify after itself/u);
  });
});

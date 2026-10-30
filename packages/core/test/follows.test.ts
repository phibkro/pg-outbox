import { direct } from "@pg-txmode/core";
import type * as Core from "@pg-txmode/core";
import { describe, expect, test, vi } from "vite-plus/test";

import { operationById, operationIds, operationSupport } from "../src/index.ts";

/**
 * A mode whose rows are all documented to work but whose connection caches reads: the one case where an operation that is
 * not a read (`claimById`) is weaker than its own cells, because it may run a read (`classify`) after itself. No mode of
 * the catalogue has these two facts at once, so the catalogue's `capabilities` is told that this connection caches reads.
 */
vi.mock("@pg-txmode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();

  return {
    ...actual,
    capabilities: (mode: Core.ConnectionMode) => ({
      ...actual.capabilities(mode),
      cachesReads: true,
    }),
  };
});

describe("an operation is no stronger than the operations it may run after itself", () => {
  test("a read is capped behind a cache, and so is the claim by id that may run one; the others are not", () => {
    expect(operationSupport(direct, "classify")).toBe("unverified");
    expect(operationSupport(direct, "claimById")).toBe("unverified");
    expect(operationSupport(direct, "ack")).toBe("yes");
    expect(operationSupport(direct, "claimBatch")).toBe("yes");
  });

  test("only claimById follows another operation, and what it follows is a read", () => {
    const following = operationIds
      .map((id) => operationById(id))
      .filter((operation) => operation.follows !== undefined);

    expect(following.map((operation) => operation.id)).toStrictEqual([
      "claimById",
    ]);
    expect(
      following.flatMap((operation) => operation.follows ?? [])
    ).toStrictEqual(["classify"]);
  });
});

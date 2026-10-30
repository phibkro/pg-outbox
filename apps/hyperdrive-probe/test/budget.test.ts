import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vite-plus/test";

import { BudgetExceededError, openBudget, stopAt } from "../src/budget.ts";

const now = () => new Date("2026-10-30T10:00:00Z");

const scratch = (): string =>
  path.join(mkdtempSync(path.join(tmpdir(), "budget-test-")), "used.json");

describe("the day's budget of statements through Hyperdrive", () => {
  test("the run stops before the limit: a limit of 3 lets three statements through and stops the fourth", () => {
    const budget = openBudget(scratch(), { limit: 3 });

    budget.spend(1);
    budget.spend(1);
    budget.spend(1);
    expect(() => {
      budget.spend(1);
    }).toThrow(BudgetExceededError);
    expect(budget.used()).toBe(3);
  });

  test("the count is kept across runs of the same day", () => {
    const file = scratch();
    const first = openBudget(file, { limit: 10, now });

    first.spend(4);
    first.flush();

    expect(openBudget(file, { limit: 10, now }).used()).toBe(4);
  });

  test("control: yesterday's file counts as nothing, and the Free plan's stop is 80,000 of its 100,000", () => {
    const file = scratch();

    writeFileSync(file, JSON.stringify({ date: "2026-10-29", used: 79_999 }));
    expect(
      openBudget(file, { now: () => new Date("2026-10-30T00:00:01Z") }).used()
    ).toBe(0);
    expect(stopAt).toBe(80_000);
  });

  test("a file that is not the budget's counts as nothing, and does not stop the run", () => {
    const file = scratch();

    writeFileSync(file, "not json");
    expect(openBudget(file).used()).toBe(0);
  });
});

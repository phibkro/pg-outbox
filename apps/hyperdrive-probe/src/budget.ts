import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

/** The Workers Free plan counts every statement through Hyperdrive: 100,000 a day, reset at 00:00 UTC (Cloudflare's pricing page). */
const dailyLimit = 100_000;

/** The run stops here, so that a mistake costs less than the day (operator decision, spec 0004). */
export const stopAt = 80_000;

if (stopAt >= dailyLimit) {
  throw new Error("the stop must be below the plan's daily limit");
}

export class BudgetExceededError extends Error {
  override readonly name = "BudgetExceededError";
}

const stored = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  used: z.number().int().nonnegative(),
});

const today = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * The statements of the day, kept in a file so that the next run starts from what the last one used. Every statement of a run
 * is counted before it is sent: a run that would pass the limit stops with `BudgetExceededError` and sends nothing more.
 */
export interface Budget {
  readonly spend: (statements: number) => void;
  readonly used: () => number;
  readonly flush: () => void;
}

export const openBudget = (
  file: string,
  options: { readonly limit?: number; readonly now?: () => Date } = {}
): Budget => {
  const limit = options.limit ?? stopAt;
  const now = options.now ?? (() => new Date());

  const read = (): number => {
    try {
      const parsed = stored.parse(JSON.parse(readFileSync(file, "utf-8")));

      return parsed.date === today(now()) ? parsed.used : 0;
    } catch {
      return 0;
    }
  };

  let used = read();

  const flush = (): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ date: today(now()), used }));
  };

  return {
    flush,
    spend: (statements) => {
      if (used + statements > limit) {
        flush();

        throw new BudgetExceededError(
          `the day's budget of ${limit} statements through Hyperdrive is used up (${used} used); the run stops`
        );
      }

      used += statements;
    },
    used: () => used,
  };
};

import { describe, expect, test } from "vite-plus/test";

import { declareOutbox, operationIds } from "../src/index.ts";

const outbox = declareOutbox({
  errorClasses: ["timeout"],
  retry: { delaysMs: [1], maxAttempts: 1 },
  table: "outbox",
});

const fallback = /COALESCE\(\$\d+::timestamptz, statement_timestamp\(\)\)/u;
const fallbackEverywhere = new RegExp(fallback.source, "gu");

/** The clocks a statement could read besides the caller's. */
const otherClocks =
  /\b(?:now\(\)|clock_timestamp\(\)|transaction_timestamp\(\)|current_timestamp|localtimestamp|current_date|timeofday\(\))/iu;

/** Texts whose time does not come from the `Now` argument: a clock read outside `COALESCE($n, statement_timestamp())`. */
const strayClocks = (
  texts: Readonly<Record<string, string>>
): readonly string[] =>
  Object.entries(texts).flatMap(([id, text]) => {
    const rest = text.replace(fallbackEverywhere, "");

    return /statement_timestamp\(\)/u.test(rest) || otherClocks.test(rest)
      ? [id]
      : [];
  });

describe("the clock is an explicit argument of every statement", () => {
  test("no statement reads a clock except as the fallback of its `now` parameter", () => {
    expect(strayClocks(outbox.sql)).toStrictEqual([]);
  });

  test("control: a bare now(), a bare statement_timestamp() and a clock inside the fallback's rival are found", () => {
    expect(
      strayClocks({
        a: "UPDATE t SET at = now()",
        b: "UPDATE t SET at = statement_timestamp()",
        c: "UPDATE t SET at = COALESCE($1::timestamptz, statement_timestamp())",
        d: "UPDATE t SET at = CURRENT_TIMESTAMP",
      })
    ).toStrictEqual(["a", "b", "d"]);
  });

  test("only holdClaim has no time: every other statement takes the `now` argument", () => {
    const untimed = operationIds.filter((id) => !fallback.test(outbox.sql[id]));

    expect(untimed).toStrictEqual(["holdClaim"]);
  });
});

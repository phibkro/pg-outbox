import {
  operationIds,
  operations,
  operationSupport,
  requireOperation,
  UnsupportedOperationError,
} from "@pg-outbox/core";
import type { OperationId } from "@pg-outbox/core";
import {
  direct,
  hyperdrive,
  neonPooler,
  pgBouncer,
  sessionPooled,
  supavisor,
} from "@pg-txmode/core";
import type { ConnectionMode } from "@pg-txmode/core";
import { lintStatements, uncachedFunctions } from "@pg-txmode/lint";
import type { Statement as LintStatement } from "@pg-txmode/lint";
import { expect } from "vite-plus/test";

import type { Env, Falsifier } from "./falsifier.ts";
import { at, claimed, enqueueOne } from "./fixtures.ts";
import { instantPattern, replacing } from "./mutation.ts";
import type { Subject } from "./subject.ts";

const lintModes: readonly ConnectionMode[] = [
  direct,
  sessionPooled,
  hyperdrive,
  pgBouncer(0),
  pgBouncer(1000),
  neonPooler,
  supavisor,
];

/** Every operation once, in the order a worker uses them, with the transaction each one needs. */
const journey = async (subject: Subject): Promise<void> => {
  await subject.migrate();

  const id = await subject.transaction(async (tx) => {
    const stored = await subject.enqueue(tx, {
      dedupeKey: "journey",
      kind: "Mail",
      now: at(0),
      payload: { journey: true },
    });

    return stored._tag === "Enqueued" ? stored.id : "0";
  });

  await subject.markQueued({ ids: [id], now: at(1) });
  await subject.stale({ limit: 5, now: at(2), olderThanMs: 1 });
  await subject.counts({ now: at(2) });
  await subject.open({ limit: 5, now: at(2) });

  const first = claimed(
    await subject.claimById({ id, leaseMs: 100, now: at(3) }),
    "the journey's claim"
  );

  await subject.claimById({ id, leaseMs: 100, now: at(4) });
  await subject.release({
    attempts: first.attempts,
    errorClass: "timeout",
    id,
    now: at(5),
    token: first.token,
  });

  const second = claimed(
    await subject.claimById({ id, leaseMs: 100, now: at(2000) }),
    "the second claim"
  );

  await subject.transaction(async (tx) => {
    await subject.holdClaim(tx, { id, token: second.token });
    await subject.ack({ id, now: at(2001), token: second.token }, tx);
  });

  const other = await enqueueOne(subject, { now: at(0) });

  await subject.claimBatch({ leaseMs: 100, limit: 3, now: at(3000) });

  const [third] = await subject.claimBatch({
    leaseMs: 100,
    limit: 3,
    now: at(4000),
  });

  await subject.bury({
    errorClass: "rejected",
    id: other,
    now: at(4001),
    token: third?.token ?? "",
  });
  await subject.cleanup({ limit: 5, now: at(9000), olderThanMs: 1 });
};

/** The statements of the journey, as the lint reads a recorded log: one sequence per connection. */
const fromLog = (env: Env): readonly LintStatement[] =>
  env.log.map((record, index) => ({
    line: index + 1,
    sequence: record.session,
    source: "journey",
    sql: record.sql,
  }));

/** Each operation's text on its own; an operation that needs a transaction gets one around it. */
const fromTexts = (env: Env): readonly LintStatement[] =>
  operationIds.flatMap((id: OperationId, index): LintStatement[] => {
    const needsTransaction = operations.some(
      (operation) => operation.id === id && operation.transaction === "requires"
    );

    const sequence = `text:${id}`;
    const base = { line: index + 1, sequence, source: `statement ${id}` };

    return [
      ...(needsTransaction ? [{ ...base, sql: "BEGIN" }] : []),
      { ...base, sql: env.texts[id] },
    ];
  });

export const noSessionFeatures: Falsifier = {
  controls: [
    {
      describe: "a LISTEN in a statement: no transaction pooler honours it",
      id: "statement-listens",
      mutation: {
        inspectOnly: true,
        kind: "statement",
        operation: "counts",
        rewrite: (text) => `LISTEN jobs; ${text}`,
      },
    },
    {
      describe: "a session advisory lock in a statement",
      id: "statement-advisory-lock",
      mutation: {
        inspectOnly: true,
        kind: "statement",
        operation: "claimById",
        rewrite: (text) => `SELECT pg_advisory_lock(1); ${text}`,
      },
    },
  ],
  id: "F8",
  run: async (env) => {
    await journey(env.subject);

    const statements = [
      ...fromLog(env),
      ...fromTexts(env),
      ...env.migration.map((sql, index) => ({
        line: index + 1,
        sequence: "migration",
        source: "migration",
        sql,
      })),
    ];

    for (const mode of lintModes) {
      const all = await lintStatements(statements, { mode });
      const findings = all.filter((finding) => finding.severity === "error");

      expect(
        findings.map(
          (finding) => `${finding.source}: ${finding.ruleId} ${finding.message}`
        ),
        `errors of the lint in ${JSON.stringify(mode)}`
      ).toStrictEqual([]);
    }
  },
  title:
    "no statement uses a session feature: the journey's log and every text pass the lint in every mode",
};

const poolers: readonly ConnectionMode[] = [
  direct,
  sessionPooled,
  pgBouncer(0),
  pgBouncer(1000),
  neonPooler,
];

/** The modes where nothing of this library ran: the evidence is another mode's or another use's. */
const unmeasured: readonly ConnectionMode[] = [hyperdrive, supavisor];

const uncachedCall = (text: string): boolean =>
  uncachedFunctions.some((name) => text.includes(`${name}(`));

export const modeCheck: Falsifier = {
  controls: [
    {
      describe:
        "a read that calls no uncached function would be served stale by Hyperdrive",
      id: "stale-cacheable-read",
      mutation: {
        inspectOnly: true,
        kind: "statement",
        operation: "stale",
        rewrite: replacing(new RegExp(instantPattern, "gu"), "$3::timestamptz"),
      },
    },
  ],
  id: "F12",
  run: ({ texts }) => {
    for (const mode of poolers) {
      for (const id of operationIds) {
        expect(
          operationSupport(mode, id),
          `${id} on ${JSON.stringify(mode)}`
        ).toBe("yes");
      }
    }

    // Hyperdrive and Supavisor: nothing was run through either (Hyperdrive's recorded run did not cover a concurrent
    // `ON CONFLICT DO NOTHING`; Supavisor's cells are PgBouncer's), so every operation is unverified and refused unless
    // the caller accepts that.
    for (const mode of unmeasured) {
      for (const id of operationIds) {
        expect(
          operationSupport(mode, id),
          `${id} on ${JSON.stringify(mode)}`
        ).toBe("unverified");
        expect(
          () => {
            requireOperation(mode, id);
          },
          `${id} refused by default on ${JSON.stringify(mode)}`
        ).toThrow(UnsupportedOperationError);
        expect(
          () => {
            requireOperation(mode, id, { allowUnverified: true });
          },
          `${id} accepted on request on ${JSON.stringify(mode)}`
        ).not.toThrow();
      }
    }

    const cacheable = operations
      .filter((operation) => operation.reads)
      .map((operation) => operation.id)
      .filter((id) => !uncachedCall(texts[id]));

    expect(
      cacheable,
      "every read calls a function that makes Hyperdrive skip its cache"
    ).toStrictEqual([]);
  },
  title:
    "the mode check: PgBouncer and direct accept every operation, Hyperdrive and Supavisor refuse every one as unverified, every read calls an uncached function",
};

import { exercisedBy, operationIds } from "@pg-outbox/core";
import { pgConnect } from "@pg-txmode/harness";
import { describe, expect, test } from "vite-plus/test";

import { coreSubject, falsifiers, suiteOutbox } from "../src/index.ts";
import { postgresServer } from "./postgresServer.ts";

/**
 * `exercisedBy` (core) says which falsifiers exercise each operation; a measurement through a mode rests on it ("every one of
 * these passed"). Here each falsifier runs once on PostgreSQL and the statements it sent are read: an operation is listed for a
 * falsifier only if that falsifier sent the operation's statement.
 */
const postgres = postgresServer();

const sentBy = async (id: string): Promise<ReadonlySet<string>> => {
  const falsifier = falsifiers.find((candidate) => candidate.id === id);

  if (falsifier === undefined) {
    throw new Error(`no falsifier ${id}`);
  }

  const { url } = postgres().endpoint;
  const built = coreSubject(suiteOutbox, async () => await pgConnect(url)());

  await falsifier.run({
    get log() {
      return built.log;
    },
    migration: built.migration,
    rounds: 3,
    subject: built.subject,
    texts: built.texts,
  });

  return new Set(built.log.map((statement) => statement.sql));
};

describe("the operations that each falsifier exercises", () => {
  test("every falsifier that exercisedBy names exists in the suite", () => {
    const known = new Set(falsifiers.map((falsifier) => falsifier.id));

    for (const operation of operationIds) {
      for (const id of exercisedBy[operation]) {
        expect(known.has(id), `${operation} names ${id}`).toBe(true);
      }
    }
  });

  test("a falsifier sent the statement of each operation that exercisedBy lists it for", async () => {
    const ids = new Set(
      operationIds.flatMap((operation) => exercisedBy[operation])
    );

    for (const id of ids) {
      const sent = await sentBy(id);

      for (const operation of operationIds) {
        if (exercisedBy[operation].includes(id)) {
          expect(
            sent.has(suiteOutbox.sql[operation]),
            `${id} sends no ${operation} statement`
          ).toBe(true);
        }
      }
    }
  });

  test("control: an operation that no falsifier lists is not claimed (every operation lists at least one falsifier)", () => {
    for (const operation of operationIds) {
      expect(exercisedBy[operation].length, operation).toBeGreaterThan(0);
    }
  });
});

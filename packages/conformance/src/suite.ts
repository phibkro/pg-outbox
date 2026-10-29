import type { Connect } from "@pg-txmode/harness";
import { describe, expect, test } from "vite-plus/test";

import { fence, hold, oneLiveHolder, typedAnswers } from "./claims.ts";
import { coreSubject } from "./coreSubject.ts";
import {
  ackJoins,
  crashDoesNotLose,
  transactionalEnqueue,
} from "./delivery.ts";
import type { Env, Falsifier } from "./falsifier.ts";
import { suiteOutbox } from "./fixtures.ts";
import { retention, sweep } from "./housekeeping.ts";
import { modeCheck, noSessionFeatures } from "./modes.ts";
import type { Mutation } from "./mutation.ts";
import { closedSet, dedupe, failureClasses } from "./policy.ts";

/** Every falsifier of spec 0001, in the order of its table. */
export const falsifiers: readonly Falsifier[] = [
  transactionalEnqueue,
  oneLiveHolder,
  fence,
  hold,
  ackJoins,
  crashDoesNotLose,
  failureClasses,
  noSessionFeatures,
  sweep,
  retention,
  modeCheck,
  closedSet,
  dedupe,
  typedAnswers,
];

export interface Target {
  /** What the tests print: the server or the pooler behind the connection. */
  readonly name: string;
  readonly connect: Connect;
}

const envOf = (target: Target, rounds: number, mutation?: Mutation): Env => {
  const core = coreSubject(suiteOutbox, target.connect, mutation);

  return {
    get log() {
      return core.log;
    },
    migration: core.migration,
    rounds,
    subject: core.subject,
    texts: core.texts,
  };
};

/** What the falsifier throws against this environment, or undefined when it holds. */
const failureOf = async (
  falsifier: Falsifier,
  env: Env
): Promise<Error | undefined> => {
  try {
    await falsifier.run(env);

    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
};

/** Rounds of a race: `PG_OUTBOX_ROUNDS`, default 100 (300 for the heavy run). */
export const roundsFromEnvironment = (): number => {
  const rounds = Number(process.env.PG_OUTBOX_ROUNDS ?? 100);

  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error("PG_OUTBOX_ROUNDS must be a positive integer");
  }

  return rounds;
};

/**
 * Registers, for one target, a test per falsifier (it must hold) and a test per control (the same run against a deliberate
 * defect must fail). The core's own statements are what runs; adapters register their own subject in their own packages.
 */
export const defineConformance = (target: Target, rounds: number): void => {
  describe(`conformance of the core on ${target.name}`, () => {
    for (const falsifier of falsifiers) {
      test(`${falsifier.id} holds: ${falsifier.title}`, async () => {
        await falsifier.run(envOf(target, rounds));
      });

      for (const control of falsifier.controls) {
        test(`${falsifier.id} control ${control.id} fails: ${control.describe}`, async () => {
          // Built here, outside the expectation: a control that changes nothing is a defect of the suite, not a pass.
          const env = envOf(target, rounds, control.mutation);

          const failure = await failureOf(falsifier, env);

          expect(
            failure,
            `the falsifier ${falsifier.id} did not see the defect "${control.id}"`
          ).toBeDefined();

          // A control that fails because its SQL is malformed (class 42: syntax, unknown column, untyped parameter) proves
          // nothing about the falsifier: the defect must be a legal statement that gives a wrong answer.
          const code =
            failure !== undefined && "code" in failure
              ? String(failure.code)
              : "";

          expect(
            code.startsWith("42"),
            `control ${control.id} is malformed SQL: ${failure?.message}`
          ).toBe(false);
          process.stderr.write(
            `control ${falsifier.id}/${control.id} on ${target.name}: ${(failure?.message ?? "").split("\n")[0]}\n`
          );
        });
      }
    }
  });
};

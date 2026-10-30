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
import type { Built } from "./mutated.ts";
import type { Mutation } from "./mutation.ts";
import { closedSet, dedupe, dedupeRace, failureClasses } from "./policy.ts";

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
  dedupeRace,
];

export interface Target {
  /** What the tests print: the server or the pooler behind the connection. */
  readonly name: string;
  readonly connect: Connect;
}

const envOf = (built: Built, rounds: number): Env => ({
  get log() {
    return built.log;
  },
  migration: built.migration,
  rounds,
  subject: built.subject,
  texts: built.texts,
});

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
 * Registers, for one subject, a test per falsifier (it must hold) and a test per control (the same run against a deliberate
 * defect must fail). `build` makes a fresh subject, with the control's defect applied when there is one: the core's
 * statements over a driver (`defineConformance`), or an adapter's functions (the adapters register their own in their
 * own packages), so that every falsifier runs on every way to call the protocol.
 */
export const defineSubjectConformance = (
  name: string,
  build: (mutation?: Mutation) => Built,
  rounds: number
): void => {
  describe(`conformance of ${name}`, () => {
    for (const falsifier of falsifiers) {
      test(`${falsifier.id} holds: ${falsifier.title}`, async () => {
        await falsifier.run(envOf(build(), rounds));
      });

      for (const control of falsifier.controls) {
        test(`${falsifier.id} control ${control.id} fails: ${control.describe}`, async () => {
          // Built here, outside the expectation: a control that changes nothing is a defect of the suite, not a pass.
          const env = envOf(build(control.mutation), rounds);

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
            `control ${falsifier.id}/${control.id} on ${name}: ${(failure?.message ?? "").split("\n")[0]}\n`
          );
        });
      }
    }
  });
};

/** The core's own statements over `target`, through `coreSubject`. */
export const defineConformance = (target: Target, rounds: number): void => {
  defineSubjectConformance(
    `the core on ${target.name}`,
    (mutation) => coreSubject(suiteOutbox, target.connect, mutation),
    rounds
  );
};

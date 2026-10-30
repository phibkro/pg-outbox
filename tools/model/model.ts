import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

/** The shape of `model/cases.json`: what TLC runs, and what each run must find. */
const Rules = z.object({
  ClassRule: z.boolean(),
  Fence: z.boolean(),
  HoldLocks: z.boolean(),
  LeaseLapses: z.boolean(),
  LiveCheck: z.boolean(),
  MarkAtClaim: z.boolean(),
});

const word = z.string().min(1);

const Case = z.discriminatedUnion("kind", [
  z.object({ id: word, kind: z.literal("holds") }),
  z.object({
    control: z.array(word).min(1),
    id: word,
    kind: z.literal("broken"),
    rules: Rules.partial(),
    violates: word,
  }),
  z.object({ id: word, kind: z.literal("reach"), violates: word }),
]);

const CasesSchema = z.object({
  cases: z.array(Case).min(1),
  constants: z.object({
    Delay: z.number().int(),
    Lease: z.number().int(),
    MaxAttempts: z.number().int(),
    MaxClaims: z.number().int(),
    MaxTime: z.number().int(),
    Workers: word,
  }),
  description: word,
  invariants: z.array(word).min(1),
  notModelled: z.record(word, word),
  rules: Rules,
});

export type Cases = z.infer<typeof CasesSchema>;

export type ModelCase = Cases["cases"][number];

export const readCases = (root: string): Cases =>
  CasesSchema.parse(
    JSON.parse(readFileSync(path.join(root, "model/cases.json"), "utf-8"))
  );

/**
 * The configuration file of one case: its constants, its switches and the invariant(s) it checks. A broken case checks the
 * invariant it names alone, or with `every` every invariant of the model (TLC then reports the first one it finds).
 */
export const configOf = (
  cases: Cases,
  model: ModelCase,
  options: { readonly every?: boolean } = {}
): string => {
  const rules = new Map<string, boolean | undefined>(
    Object.entries(cases.rules)
  );

  if (model.kind === "broken") {
    for (const [name, value] of Object.entries(model.rules)) {
      rules.set(name, value);
    }
  }

  const invariants =
    model.kind === "holds" ||
    (model.kind === "broken" && options.every === true)
      ? cases.invariants
      : [model.violates];

  return [
    "SPECIFICATION Spec",
    "CONSTANTS",
    ...Object.entries(cases.constants).map(
      ([name, value]) => `  ${name} = ${String(value)}`
    ),
    ...[...rules].map(
      ([name, value]) => `  ${name} = ${value === true ? "TRUE" : "FALSE"}`
    ),
    ...invariants.map((name) => `INVARIANT ${name}`),
    "",
  ].join("\n");
};

/** What a case must find: no error, or the violation of one named invariant. */
export const expectation = (model: ModelCase): string =>
  model.kind === "holds" ? "no error" : `violates ${model.violates}`;

export interface Confirmed {
  readonly digest: string;
  readonly covers: readonly string[];
}

const Confirmation = z.object({
  covers: z.array(word).min(1),
  digest: z.string().regex(/^[0-9a-f]{64}$/u),
});

export const readConfirmed = (root: string): Confirmed =>
  Confirmation.parse(
    JSON.parse(readFileSync(path.join(root, "model/confirmed.json"), "utf-8"))
  );

/** The digest of the covered files: their paths and contents in the order listed, so a moved or edited line changes it. */
export const digestOf = (root: string, covers: readonly string[]): string => {
  const hash = createHash("sha256");

  for (const file of covers) {
    hash.update(`${file}\n`);
    hash.update(readFileSync(path.join(root, file)));
    hash.update("\n");
  }

  return hash.digest("hex");
};

/** The operation ids that a TLA+ source tags: `@operation a b c` lines. */
export const taggedOperations = (source: string): readonly string[] =>
  [...source.matchAll(/@operation\s+(?<ids>[\w ]+)/gu)].flatMap((match) =>
    (match.groups?.ids ?? "").split(/\s+/u).filter((id) => id !== "")
  );

/** The ids that `operations.ts` declares, read from its source (a tool depends on no package). */
export const declaredOperations = (source: string): readonly string[] =>
  [...source.matchAll(/^\s+id: "(?<id>\w+)",$/gmu)].map(
    (match) => match.groups?.id ?? ""
  );

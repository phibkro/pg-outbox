// Provenance: adapted from phibkro/pg-txmode @ 12f1abac1eb9d3ebad7e123a12f56896f896a272 (vite.config.ts at spec 0000, f5efb53),
// which adapted it from reebeat/studio @ d4fd75eaca83b9e8a98f073d5b1d957da5d6b8b8, reebeat/reebeat
// @ f7c348877585f54b6bf00651608726dd7e5044d3 and phibkro/vektorprogrammet-reimagined @ 797e9e41d96194b9479ff224ac1c40bbc0545888.
// Deviations: no Foldkit or anti-slop Effect rules; the Oxlint Effect plugin's rules apply to `packages/effect/**` only (the
// core and the other packages must not depend on Effect; spec 0003 adds the group, as pg-txmode's vite.config.ts does); the
// restricted source paths name both this repository's packages and pg-txmode's. See PROVENANCE.md.
import { effect } from "@phibkro/oxlint-effect-plugin";
import type { EffectConfigInput } from "@phibkro/oxlint-effect-plugin";
import ultraciteFmt from "ultracite/oxfmt";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { defineConfig } from "vite-plus";

// Effect roles per path. The Effect adapter is the only package that uses Effect.
const effectConfig: EffectConfigInput = {
  groups: [
    {
      files: ["packages/effect/src/**"],
      platform: "node",
      role: "effect-library",
      strictness: "strict",
    },
    {
      files: ["packages/effect/test/**"],
      platform: "node",
      role: "test",
      strictness: "strict",
    },
    {
      // The test module that runs Effects from the promise-shaped conformance suite: the one place that starts a runtime.
      files: ["packages/effect/test/effectSubject.ts"],
      platform: "node",
      role: "composition-root",
      strictness: "strict",
    },
  ],
};

const effectConfigResult = effect(effectConfig);

const restrictedSourcePatterns = [
  {
    message:
      "Import another workspace package through its export map, not its source path.",
    regex: "^@pg-(?:outbox|txmode)/[^/]+/src(?:/|$)",
  },
  {
    message:
      "Import another workspace package through its export map, not its source path.",
    regex: "^(?:\\./|(?:\\.\\./)+)(?:packages|tools)/[^/]+/src(?:/|$)",
  },
];

export default defineConfig({
  // Prose is written by hand: Oxfmt re-wraps Markdown and joins hard line breaks, which changes meaning.
  fmt: {
    ...ultraciteFmt,
    ignorePatterns: [
      ...(ultraciteFmt.ignorePatterns ?? []),
      "**/*.md",
      "vendor/**",
    ],
  },
  lint: {
    extends: [core, antiSlop],
    ignorePatterns: ["vendor/**"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "complexity", specifier: "oxlint-plugin-complexity" },
      ...effectConfigResult.jsPlugins,
    ],
    options: { typeAware: true, typeCheck: true },
    overrides: [
      ...effectConfigResult.overrides,
      {
        // For the Effect adapter only. `func-names` asks a name for the generator that `Effect.gen(function* () {})`
        // requires to be anonymous. `promise-function-async` makes a function that returns a promise async, and the
        // language-service diagnostic `asyncFunction` (an error in `tsconfig.json`) forbids every async function; the
        // Effect rule stays. `unicorn/no-array-method-this-argument` misreads Effect's data-first `Arr.every(xs, fn)` as a
        // native `.every(fn, thisArg)` (the diagnostic `preferEffectArray` asks for the data-first form).
        files: ["packages/effect/**"],
        rules: {
          "eslint/func-names": "off",
          "typescript/promise-function-async": "off",
          "unicorn/no-array-method-this-argument": "off",
        },
      },
      {
        // `Schema.TaggedError` class definitions read as throw sites to `throw-new-error`, and a closed set of errors reads
        // as one table.
        files: ["packages/effect/src/errors.ts"],
        rules: {
          "eslint/max-classes-per-file": "off",
          "unicorn/throw-new-error": "off",
        },
      },
      {
        // The module that runs the Effect adapter for the promise-shaped conformance suite. It is a boundary by design: a
        // failure of any type arrives and is handed back as the falsifiers expect it (`unknown` in and out), a client is
        // wrapped by a `Proxy` that records and rewrites its statements (`object` keys, `Reflect.get`), and the
        // transaction's context is a WeakMap key. These four rules ask for the opposite at an I/O boundary that has no
        // domain type of its own to parse into.
        files: ["packages/effect/test/effectSubject.ts"],
        rules: {
          "anti-slop/no-object-parameters": "off",
          "anti-slop/no-reflect-get": "off",
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-unknown-returns": "off",
        },
      },
      {
        // The conformance suite and every test drive a server through sequential steps: each step waits for the one
        // before it (a transaction's statements, a race's rounds, a drain that stops at the first empty answer), and a
        // step that fails is compared, not rethrown. The rules below ask for loops over `await`, for no promise
        // constructor and for no `.then`, which these files cannot satisfy without hiding the order of the steps.
        files: ["packages/conformance/**", "**/test/**"],
        rules: {
          "eslint/no-await-in-loop": "off",
          "eslint/no-promise-executor-return": "off",
          "node/callback-return": "off",
          "promise/avoid-new": "off",
          "promise/prefer-await-to-callbacks": "off",
          "promise/prefer-await-to-then": "off",
          "unicorn/no-array-reduce": "off",
        },
      },
    ],
    rules: {
      "complexity/complexity": ["error", { cognitive: 15 }],
      // `typescript/promise-function-async` (on) makes a function that returns a promise async, and `require-await` then
      // rejects it for having no await. One of the two has to give; the typed one stays (as in pg-txmode's vite.config.ts).
      "eslint/require-await": "off",
      "no-restricted-imports": [
        "error",
        { patterns: [...restrictedSourcePatterns] },
      ],
      // Workspace modules use lower camelCase filenames.
      "unicorn/filename-case": ["error", { case: "camelCase" }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
  },
  run: { cache: true },
  staged: { "*": "vp check --fix" },
});

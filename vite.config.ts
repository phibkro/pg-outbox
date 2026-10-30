// Provenance: adapted from phibkro/pg-txmode @ 12f1abac1eb9d3ebad7e123a12f56896f896a272 (vite.config.ts at spec 0000, f5efb53),
// which adapted it from reebeat/studio @ d4fd75eaca83b9e8a98f073d5b1d957da5d6b8b8, reebeat/reebeat
// @ f7c348877585f54b6bf00651608726dd7e5044d3 and phibkro/vektorprogrammet-reimagined @ 797e9e41d96194b9479ff224ac1c40bbc0545888.
// Deviations: no Effect, Foldkit or anti-slop Effect rules (the core must not depend on Effect; the Effect adapter package
// adds its own group in its spec); the restricted source paths name both this repository's packages and pg-txmode's.
// See PROVENANCE.md.
import ultraciteFmt from "ultracite/oxfmt";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { defineConfig } from "vite-plus";

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
    ],
    options: { typeAware: true, typeCheck: true },
    overrides: [
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

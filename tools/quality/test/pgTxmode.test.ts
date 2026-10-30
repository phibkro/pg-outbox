import { existsSync, readFileSync, globSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vite-plus/test";

import { Manifest } from "./manifest.ts";
import { repoRoot, withScratch, writeFixture } from "./scriptHarness.ts";

// Spec 0005: pg-txmode comes from the registry, at one exact version, and no submodule is left.

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/u;

const manifestPaths = (root: string): readonly string[] => [
  "package.json",
  ...globSync("{apps,packages,tools}/*/package.json", { cwd: root }),
];

/** Every `@pg-txmode/*` dependency of every manifest, as `manifest: name@range`. */
const pgTxmodeDependencies = (
  root: string
): readonly { readonly where: string; readonly range: string }[] =>
  manifestPaths(root).flatMap((manifest) => {
    const parsed = Manifest.parse(
      JSON.parse(readFileSync(path.join(root, manifest), "utf-8"))
    );

    return [
      parsed.dependencies,
      parsed.devDependencies,
      parsed.optionalDependencies,
      parsed.peerDependencies,
    ].flatMap((fields) =>
      Object.entries(fields)
        .filter(([name]) => name.startsWith("@pg-txmode/"))
        .map(([name, range]) => ({ range, where: `${manifest}: ${name}` }))
    );
  });

/** The pin problems: a range that is not one exact version, and more than one version across the repository. */
const pinProblems = (root: string): readonly string[] => {
  const found = pgTxmodeDependencies(root);

  const inexact = found
    .filter(({ range }) => !exactVersion.test(range))
    .map(({ range, where }) => `${where} is ${range}, not one exact version`);

  const versions = new Set(found.map(({ range }) => range));

  return [
    ...inexact,
    ...(versions.size > 1
      ? [`more than one version: ${[...versions].toSorted().join(", ")}`]
      : []),
  ];
};

const configs = ["knip.json", ".jscpd.json", "vite.config.ts"];

/** What is left of the submodule: its files, its checkout in CI, its exceptions in a gate, its workspaces in the lockfile. */
const submoduleLeftovers = (root: string): readonly string[] => {
  const lock = existsSync(path.join(root, "bun.lock"))
    ? readFileSync(path.join(root, "bun.lock"), "utf-8")
    : "";

  const workflow = existsSync(path.join(root, ".github/workflows/checks.yml"))
    ? readFileSync(path.join(root, ".github/workflows/checks.yml"), "utf-8")
    : "";

  return [
    ...(existsSync(path.join(root, ".gitmodules")) ? [".gitmodules"] : []),
    ...(existsSync(path.join(root, "vendor")) ? ["vendor/"] : []),
    ...(/^\s*submodules:/mu.test(workflow)
      ? ["the workflow checks out submodules"]
      : []),
    ...configs.flatMap((file) =>
      existsSync(path.join(root, file)) &&
      readFileSync(path.join(root, file), "utf-8").includes("vendor/")
        ? [`${file} names vendor/`]
        : []
    ),
    ...(/@pg-txmode\/[a-z]+@workspace:/u.test(lock) || lock.includes('"vendor/')
      ? ["bun.lock resolves pg-txmode as a workspace"]
      : []),
  ];
};

describe("pg-txmode comes from the registry (spec 0005)", () => {
  test("S1: every @pg-txmode/* dependency is the same one exact version, none is a workspace or a range", () => {
    expect(pgTxmodeDependencies(repoRoot).length).toBeGreaterThan(0);
    expect(pinProblems(repoRoot)).toStrictEqual([]);
  });

  test("S1 control: a workspace, a range and a second version are found", () => {
    const found = withScratch((root) => {
      writeFixture(
        path.join(root, "package.json"),
        JSON.stringify({ dependencies: { "@pg-txmode/core": "workspace:*" } })
      );
      writeFixture(
        path.join(root, "packages/a/package.json"),
        JSON.stringify({ dependencies: { "@pg-txmode/pg": "~0.1.0-alpha.0" } })
      );
      writeFixture(
        path.join(root, "packages/b/package.json"),
        JSON.stringify({
          devDependencies: { "@pg-txmode/lint": "0.1.0-alpha.1" },
        })
      );
      writeFixture(
        path.join(root, "packages/c/package.json"),
        JSON.stringify({
          devDependencies: { "@pg-txmode/effect": "0.1.0-alpha.0" },
        })
      );

      return pinProblems(root);
    });

    expect(found).toStrictEqual([
      "package.json: @pg-txmode/core is workspace:*, not one exact version",
      "packages/a/package.json: @pg-txmode/pg is ~0.1.0-alpha.0, not one exact version",
      "more than one version: 0.1.0-alpha.0, 0.1.0-alpha.1, workspace:*, ~0.1.0-alpha.0",
    ]);
  });

  test("S2, S3: no submodule, no checkout of one, no gate exception for it, no workspace of pg-txmode in the lockfile", () => {
    expect(submoduleLeftovers(repoRoot)).toStrictEqual([]);
  });

  test("S2, S3 control: each leftover is found", () => {
    const found = withScratch((root) => {
      writeFixture(path.join(root, ".gitmodules"), "[submodule]\n");
      writeFixture(path.join(root, "vendor/pg-txmode/README.md"), "x\n");
      writeFixture(
        path.join(root, ".github/workflows/checks.yml"),
        "steps:\n  - with:\n      submodules: true\n"
      );
      writeFixture(
        path.join(root, "knip.json"),
        '{"ignoreWorkspaces":["vendor/**"]}'
      );
      writeFixture(
        path.join(root, "bun.lock"),
        '"@pg-txmode/core": ["@pg-txmode/core@workspace:vendor/pg-txmode/packages/core"]'
      );

      return submoduleLeftovers(root);
    });

    expect(found).toStrictEqual([
      ".gitmodules",
      "vendor/",
      "the workflow checks out submodules",
      "knip.json names vendor/",
      "bun.lock resolves pg-txmode as a workspace",
    ]);
  });
});

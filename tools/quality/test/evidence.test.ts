import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vite-plus/test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(repoRoot, "docs/evidence/hyperdrive");

/**
 * A recorded run is published in a public repository: it names no Worker address, no host of the database, no connection string,
 * no identifier of 32 or more hexadecimal digits (an account, a configuration, a token).
 */
const leaks = (text: string): readonly string[] =>
  [
    /\.workers\.dev/u,
    /\.neon\.tech/u,
    /postgres(?:ql)?:\/\//u,
    /\b[0-9a-f]{32,}\b/u,
    /Sec-WebSocket-Protocol: probe\./u,
  ].flatMap((pattern) => (pattern.test(text) ? [String(pattern)] : []));

const recorded = (): readonly string[] => {
  try {
    return readdirSync(directory).filter((file) => file.endsWith(".md"));
  } catch {
    return [];
  }
};

describe("the recorded runs through Hyperdrive carry no address, host, connection string or identifier", () => {
  test("every recorded run is clean", () => {
    for (const file of recorded()) {
      expect(
        leaks(readFileSync(path.join(directory, file), "utf-8")),
        file
      ).toStrictEqual([]);
    }
  });

  test("control: a Worker address, a host, a connection string and an identifier are found", () => {
    expect(
      leaks("https://pg-outbox-probe.someone.workers.dev/health")
    ).toHaveLength(1);
    expect(
      leaks("ep-quiet-sun-123456.eu-central-1.aws.neon.tech")
    ).toHaveLength(1);
    expect(leaks("postgres://user@host/db")).toHaveLength(1);
    expect(leaks("account 0123456789abcdef0123456789abcdef")).toHaveLength(1);
    expect(leaks("PASS F2 holds: one live claim per row")).toStrictEqual([]);
  });
});

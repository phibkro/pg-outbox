import {
  defineSubjectConformance,
  roundsFromEnvironment,
  suiteOutbox,
} from "@pg-outbox/conformance";
import { neonLayer } from "@pg-txmode/effect";
import { startStack } from "@pg-txmode/harness";
import type { Stack } from "@pg-txmode/harness";
import { ManagedRuntime, Redacted } from "effect";
import { afterAll, beforeAll } from "vite-plus/test";

import { effectSubject } from "./effectSubject.ts";
import type { Runtime } from "./effectSubject.ts";

/**
 * The Effect adapter behind PgBouncer 1.25 in transaction mode with Neon's settings (`max_prepared_statements` 1000, the
 * mode `neonLayer` builds for) and three server connections: concurrent clients really swap them.
 */
let stack: Stack | undefined;
let runtime: Runtime | undefined;

beforeAll(
  () =>
    startStack(3).then((started) => {
      stack = started;
      runtime = ManagedRuntime.make(
        neonLayer({
          maxConnections: 8,
          url: Redacted.make(started.pooler.endpoint.url),
        })
      );
    }),
  120_000
);

afterAll(() => Promise.resolve(runtime?.dispose()).then(() => stack?.stop()));

defineSubjectConformance(
  "the Effect adapter behind PgBouncer in transaction mode",
  (mutation) => {
    if (runtime === undefined) {
      throw new Error("the test stack is not running");
    }

    return effectSubject(suiteOutbox, runtime, mutation);
  },
  roundsFromEnvironment()
);

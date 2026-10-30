import {
  defineSubjectConformance,
  roundsFromEnvironment,
  suiteOutbox,
} from "@pg-outbox/conformance";
import { directLayer } from "@pg-txmode/effect";
import { startPostgres } from "@pg-txmode/harness";
import type { Postgres } from "@pg-txmode/harness";
import { ManagedRuntime, Redacted } from "effect";
import { afterAll, beforeAll } from "vite-plus/test";

import { effectSubject } from "./effectSubject.ts";
import type { Runtime } from "./effectSubject.ts";

/** The Effect adapter over a direct connection to PostgreSQL 18: the control of every falsifier. */
let postgres: Postgres | undefined;
let runtime: Runtime | undefined;

beforeAll(
  () =>
    startPostgres().then((started) => {
      postgres = started;
      runtime = ManagedRuntime.make(
        directLayer({
          maxConnections: 8,
          url: Redacted.make(started.endpoint.url),
        })
      );
    }),
  120_000
);

afterAll(() =>
  Promise.resolve(runtime?.dispose()).then(() => postgres?.stop())
);

defineSubjectConformance(
  "the Effect adapter on PostgreSQL directly",
  (mutation) => {
    if (runtime === undefined) {
      throw new Error("the test PostgreSQL is not running");
    }

    return effectSubject(suiteOutbox, runtime, mutation);
  },
  roundsFromEnvironment()
);

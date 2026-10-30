import * as Cloudflare from "@alchemy.run/cloudflare";
/**
 * The probe's infrastructure (spec 0004): ONE Worker, `pg-outbox-probe`, and ONE Hyperdrive configuration, `pg-outbox-probe`,
 * whose origin is a throwaway Neon branch (made by `scripts/probe.ts`, which also deletes it). Nothing else: no bucket, queue,
 * KV, DNS or custom domain. The state is a local file (`.alchemy/`, ignored by git), so `alchemy destroy` needs nothing but
 * this directory and the same profile.
 *
 * Connection details and the run's token are deploy-time environment variables, never committed and never printed:
 * PROBE_NEON_HOST, PROBE_NEON_DATABASE, PROBE_NEON_USER, PROBE_NEON_PASSWORD, PROBE_TOKEN.
 *
 * Deploy and destroy through `bun run probe up` and `bun run probe down`, which run the Alchemy CLI with the profile `default`.
 */
import * as Alchemy from "alchemy";
import { localState } from "alchemy/State";
import { Config, Effect } from "effect";

/** Compatibility date and flags of the Worker: `nodejs_compat` for `pg`, `enable_request_signal` as the downstream run used. */
const COMPATIBILITY = {
  date: "2026-10-01",
  flags: ["nodejs_compat", "enable_request_signal"],
};

/** The Neon project is in `aws-eu-central-1`; the Worker is placed next to it (the downstream run measured 216 ms there, 1014 ms elsewhere). */
const PLACEMENT = { mode: "targeted", region: "aws:eu-central-1" } as const;

export default Alchemy.Stack(
  "pg-outbox-probe",
  { providers: Cloudflare.providers(), state: localState() },
  Effect.gen(function* probe() {
    const database = yield* Cloudflare.Hyperdrive.Connection("Database", {
      // Caching stays ON, Hyperdrive's default: the library is measured as it would be deployed, with the read cache a write does
      // not purge. The statements that read call statement_timestamp(), which makes Hyperdrive skip its cache; the run shows it.
      name: "pg-outbox-probe",
      origin: {
        database: yield* Config.NonEmptyString("PROBE_NEON_DATABASE"),
        host: yield* Config.NonEmptyString("PROBE_NEON_HOST"),
        password: yield* Config.Redacted("PROBE_NEON_PASSWORD"),
        scheme: "postgres",
        user: yield* Config.NonEmptyString("PROBE_NEON_USER"),
      },
    });

    const worker = yield* Cloudflare.Worker("Probe", {
      compatibility: COMPATIBILITY,
      env: {
        HYPERDRIVE: database,
        PROBE_TOKEN: Config.Redacted("PROBE_TOKEN"),
      },
      main: "../src/worker.ts",
      name: "pg-outbox-probe",
      placement: PLACEMENT,
    });

    return { url: worker.url };
  })
);

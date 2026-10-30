import { databaseNow, fixedNow } from "@pg-outbox/core";
import type { Now } from "@pg-outbox/core";
import { Clock, Context, Effect } from "effect";

/**
 * Where an operation takes its time from: an Effect that produces the `Now` of one call. The default is the database's own
 * `statement_timestamp()` (`databaseNow`), so every consumer agrees whatever its host's clock says. `effectClock` reads
 * Effect's `Clock`, so `TestClock` controls leases in tests (and a deployment that trusts its hosts' clocks more than the
 * database's can use it too: then the lease must be much longer than the skew it accepts, spec 0001). A test that wants one
 * fixed instant provides `Effect.succeed(fixedNow(at))`. One reference, one way to set the time.
 */
export const OutboxClock = Context.Reference<Effect.Effect<Now>>(
  "@pg-outbox/effect/OutboxClock",
  { defaultValue: () => Effect.succeed(databaseNow) }
);

/** The `Now` of Effect's `Clock` at the moment the effect runs. */
export const effectClock: Effect.Effect<Now> = Effect.map(
  Clock.currentTimeMillis,
  (milliseconds) => fixedNow(milliseconds)
);

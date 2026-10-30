import { directLayer } from "@pg-txmode/effect";
import { startPostgres } from "@pg-txmode/harness";
import type { Postgres } from "@pg-txmode/harness";
import { Context, Effect, Layer, Redacted } from "effect";

/** A throwaway PostgreSQL 18, started when a `layer(...)` block starts and stopped when it ends. */
export class Database extends Context.Service<Database, Postgres>()(
  "test/Database"
) {
  static readonly layer = Layer.effect(
    Database,
    Effect.acquireRelease(
      Effect.promise(() => startPostgres()),
      (postgres) => Effect.promise(() => postgres.stop())
    )
  );
}

/** The database and a client of the `direct` mode on it (`SqlClient`, `TxClient`, `TxSession`). */
export const fixture = Layer.unwrap(
  Effect.map(Database, (postgres) =>
    directLayer({ url: Redacted.make(postgres.endpoint.url) })
  )
).pipe(Layer.provideMerge(Database.layer));

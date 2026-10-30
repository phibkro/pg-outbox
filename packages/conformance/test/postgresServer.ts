import { startPostgres } from "@pg-txmode/harness";
import type { Postgres } from "@pg-txmode/harness";
import { afterAll, beforeAll } from "vite-plus/test";

/** A PostgreSQL 18 for the tests of the file that calls this: started before them, stopped after them. */
export const postgresServer = (): (() => Postgres) => {
  let postgres: Postgres | undefined;

  beforeAll(async () => {
    postgres = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await postgres?.stop();
  });

  return () => {
    if (postgres === undefined) {
      throw new Error("the test PostgreSQL is not running");
    }

    return postgres;
  };
};

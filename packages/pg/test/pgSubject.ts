import type {
  Built,
  ErrorClass,
  Kind,
  Mutation,
  StatementRecord,
  Subject,
  SuiteOutbox,
  Tx,
} from "@pg-outbox/conformance";
import {
  bizTable,
  mutatedMigration,
  mutatedTexts,
  rewriteSent,
  runsOnOwnConnection,
} from "@pg-outbox/conformance";
import type { Param, Row, Transaction, TxClient } from "@pg-txmode/pg";

import { createPgOutbox } from "../src/index.ts";
import type { PgOutbox } from "../src/index.ts";

/**
 * The conformance subject of the `pg` adapter: the falsifiers call `createPgOutbox`'s functions over a real pool, and
 * the client handed to the adapter is a proxy that records what is sent, per connection, and applies a control's rewrite
 * to the statement the adapter built (found by its text), so the adapter itself knows nothing of controls.
 */
export const pgSubject = (
  outbox: SuiteOutbox,
  db: TxClient,
  mutation?: Mutation,
  settings: { readonly allowUnverified?: boolean } = {}
): Built => {
  const log: StatementRecord[] = [];
  const rewrite = rewriteSent(outbox, mutation);
  let connections = 0;

  const next = (): string => {
    connections += 1;

    return `c${connections}`;
  };

  const spy =
    (
      query: (
        text: string,
        values?: readonly Param[]
      ) => Promise<readonly Row[]>,
      session: string
    ) =>
    async (text: string, values: readonly Param[] = []) => {
      const sent = rewrite(text);

      log.push({ session, sql: sent });

      return await query(sent, values);
    };

  const proxy: TxClient = {
    capabilities: db.capabilities,
    end: async () => {
      await db.end();
    },
    mode: db.mode,
    query: async (text, values = []) =>
      await spy(async (sent, params) => await db.query(sent, params), next())(
        text,
        values
      ),
    transaction: async (body, options) => {
      const session = next();

      log.push({ session, sql: "BEGIN" });

      try {
        const value = await db.transaction(
          async (transaction) =>
            await body({
              attempt: transaction.attempt,
              query: spy(
                async (text, params) => await transaction.query(text, params),
                session
              ),
            }),
          options
        );

        log.push({ session, sql: "COMMIT" });

        return value;
      } catch (error) {
        log.push({ session, sql: "ROLLBACK" });

        throw error;
      }
    },
  };

  const adapter: PgOutbox<Kind, ErrorClass> = createPgOutbox({
    allowUnverified: settings.allowUnverified === true,
    db: proxy,
    outbox,
  });

  const transactions = new WeakMap<Tx, Transaction>();

  const joined = (tx: Tx | undefined): Transaction | undefined =>
    tx === undefined ? undefined : transactions.get(tx);

  const transactionOf = (tx: Tx): Transaction => {
    const found = transactions.get(tx);

    if (found === undefined) {
      throw new Error("this transaction was not opened by this subject");
    }

    return found;
  };

  const migration = mutatedMigration(outbox, mutation);

  const subject: Subject = {
    ack: async (args, on) =>
      await adapter.ack(
        args,
        runsOnOwnConnection(mutation, "ack") ? undefined : joined(on)
      ),
    bury: async (args, on) => await adapter.bury(args, joined(on)),
    claimBatch: async (args) => await adapter.claimBatch(args),
    claimById: async (args) => await adapter.claimById(args),
    cleanup: async (args) => await adapter.cleanup(args),
    counts: async (args) => await adapter.counts(args),
    enqueue: async (tx, args) =>
      runsOnOwnConnection(mutation, "enqueue")
        ? await proxy.transaction(
            async (own) => await adapter.enqueue(own, args)
          )
        : await adapter.enqueue(transactionOf(tx), args),
    holdClaim: async (tx, args) =>
      await adapter.holdClaim(transactionOf(tx), args),
    markQueued: async (args) => await adapter.markQueued(args),
    migrate: async () => {
      await proxy.query(`DROP TABLE IF EXISTS biz, ${outbox.table}`);
      await proxy.query(bizTable);

      for (const statement of migration) {
        await proxy.query(statement);
      }
    },
    open: async (args) => await adapter.open(args),
    outbox,
    release: async (args, on) => await adapter.release(args, joined(on)),
    sql: async (text, values) => await proxy.query(text, values),
    stale: async (args) => await adapter.stale(args),
    transaction: async (body) =>
      await proxy.transaction(async (transaction) => {
        const tx: Tx = {
          query: async (text, values) => await transaction.query(text, values),
        };

        transactions.set(tx, transaction);

        return await body(tx);
      }),
  };

  return { log, migration, subject, texts: mutatedTexts(outbox, mutation) };
};

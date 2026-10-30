import { execute } from "@pg-outbox/core";
import type { RawRow, Statement } from "@pg-outbox/core";
import type { Connect, Session } from "@pg-txmode/harness";

import {
  mutatedMigration,
  mutatedTexts,
  rewriteSent,
  runsOnOwnConnection,
} from "./mutated.ts";
import type { Built } from "./mutated.ts";
import type { Mutation } from "./mutation.ts";
import type { StatementRecord, Subject, SuiteOutbox, Tx } from "./subject.ts";

export const bizTable = "CREATE TABLE biz (n int NOT NULL)";

/**
 * The core's statements over harness sessions: each standalone call opens a connection of its own (a claimer is a client),
 * a transaction holds one connection from BEGIN to COMMIT, and a statement is run by `execute`, the interpreter every
 * adapter has. `mutation` rewrites what is sent, for a negative control.
 */
export const coreSubject = (
  outbox: SuiteOutbox,
  connect: Connect,
  mutation?: Mutation
): Built => {
  const log: StatementRecord[] = [];
  const rewrite = rewriteSent(outbox, mutation);
  const migration = mutatedMigration(outbox, mutation);
  let opened = 0;

  interface Held {
    readonly session: Session;
    readonly label: string;
  }

  const open = async (): Promise<Held> => {
    opened += 1;

    return { label: `s${opened}`, session: await connect() };
  };

  const send = async (
    { session, label }: Held,
    text: string,
    values: readonly (string | number | boolean | null)[] = []
  ): Promise<readonly RawRow[]> => {
    log.push({ session: label, sql: text });

    return await session.query(text, values);
  };

  const withSession = async <T>(
    use: (held: Held) => Promise<T>
  ): Promise<T> => {
    const held = await open();

    try {
      return await use(held);
    } finally {
      await held.session.end();
    }
  };

  const run = async <A>(held: Held, statement: Statement<A>): Promise<A> =>
    await execute(
      async (text, values) => await send(held, rewrite(text), values),
      statement
    );

  /** Standalone: a connection of its own, autocommit. */
  const alone = async <A>(statement: Statement<A>): Promise<A> =>
    await withSession(async (held) => await run(held, statement));

  const held = new WeakMap<Tx, Held>();

  const transaction = async <T>(body: (tx: Tx) => Promise<T>): Promise<T> =>
    await withSession(async (connection) => {
      const tx: Tx = {
        query: async (text, values) => await send(connection, text, values),
      };

      held.set(tx, connection);
      await send(connection, "BEGIN");

      try {
        const value = await body(tx);

        await send(connection, "COMMIT");

        return value;
      } catch (error) {
        await send(connection, "ROLLBACK");

        throw error;
      }
    });

  /** On the caller's transaction when `on` is given, else alone; a control can force the connection of its own. */
  const joining = async <A>(
    statement: Statement<A>,
    on: Tx | undefined
  ): Promise<A> => {
    const connection = on === undefined ? undefined : held.get(on);

    return connection === undefined ||
      runsOnOwnConnection(mutation, statement.operation)
      ? await alone(statement)
      : await run(connection, statement);
  };

  const inTransaction = async <A>(
    tx: Tx,
    statement: Statement<A>
  ): Promise<A> => {
    const connection = held.get(tx);

    if (connection === undefined) {
      throw new Error("holdClaim needs a transaction of this subject");
    }

    return await run(connection, statement);
  };

  const subject: Subject = {
    ack: async (args, on) => await joining(outbox.ack(args), on),
    bury: async (args, on) => await joining(outbox.bury(args), on),
    claimBatch: async (args) => await alone(outbox.claimBatch(args)),
    claimById: async (args) => await alone(outbox.claimById(args)),
    cleanup: async (args) => await alone(outbox.cleanup(args)),
    counts: async (args) => await alone(outbox.counts(args)),
    enqueue: async (tx, args) => await joining(outbox.enqueue(args), tx),
    holdClaim: async (tx, args) =>
      await inTransaction(tx, outbox.holdClaim(args)),
    markQueued: async (args) => await alone(outbox.markQueued(args)),
    migrate: async () => {
      await withSession(async (connection) => {
        await send(connection, `DROP TABLE IF EXISTS biz, ${outbox.table}`);
        await send(connection, bizTable);

        for (const statement of migration) {
          await send(connection, statement);
        }
      });
    },
    open: async (args) => await alone(outbox.open(args)),
    outbox,
    release: async (args, on) => await joining(outbox.release(args), on),
    sql: async (text, values) =>
      await withSession(
        async (connection) => await send(connection, text, values)
      ),
    stale: async (args) => await alone(outbox.stale(args)),
    transaction,
  };

  return { log, migration, subject, texts: mutatedTexts(outbox, mutation) };
};

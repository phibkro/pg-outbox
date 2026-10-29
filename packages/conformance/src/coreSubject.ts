import type { OperationId, RawRow, Statement } from "@pg-outbox/core";
import type { Connect, Session } from "@pg-txmode/harness";

import { parts, rewritten } from "./mutation.ts";
import type { Mutation } from "./mutation.ts";
import type { StatementRecord, Subject, SuiteOutbox, Tx } from "./subject.ts";

const bizTable = "CREATE TABLE biz (n int NOT NULL)";

export interface CoreSubject {
  readonly subject: Subject;
  /** Every statement sent so far, per connection, in order. */
  readonly log: StatementRecord[];
  /** The text of each operation as this subject sends it (a control's rewrite applied). */
  readonly texts: Readonly<Record<OperationId, string>>;
  /** The statements that create the table, as this subject runs them. */
  readonly migration: readonly string[];
}

const textsOf = (
  outbox: SuiteOutbox,
  mutation: Mutation | undefined
): Readonly<Record<OperationId, string>> => {
  const texts: Record<OperationId, string> = { ...outbox.sql };

  for (const part of parts(mutation)) {
    if (part.kind === "statement") {
      texts[part.operation] = rewritten(
        texts[part.operation],
        part.rewrite,
        `statement ${part.operation}`
      );
    }
  }

  return texts;
};

const migrationOf = (
  outbox: SuiteOutbox,
  mutation: Mutation | undefined
): readonly string[] => {
  let statements = outbox.migration;

  for (const part of parts(mutation)) {
    if (part.kind === "migration") {
      statements = part.rewrite(statements);
    }
  }

  const changed = parts(mutation).some((part) => part.kind === "migration");

  if (changed && statements.join("\n") === outbox.migration.join("\n")) {
    throw new Error("the migration rewrite changed nothing");
  }

  return statements;
};

/** What runs: an inspect-only rewrite is read by a check and never sent. */
const sentTexts = (
  outbox: SuiteOutbox,
  mutation: Mutation | undefined
): Readonly<Record<OperationId, string>> => {
  const runnable = parts(mutation).filter(
    (part) => !(part.kind === "statement" && part.inspectOnly === true)
  );

  return textsOf(outbox, { kind: "all", of: runnable });
};

/**
 * The core's statements over harness sessions: each standalone call opens a connection of its own (a claimer is a client),
 * a transaction holds one connection from BEGIN to COMMIT, and a statement is run by the loop of `Statement` (the
 * interpreter every adapter has). `mutation` rewrites what is sent, for a negative control.
 */
export const coreSubject = (
  outbox: SuiteOutbox,
  connect: Connect,
  mutation?: Mutation
): CoreSubject => {
  const log: StatementRecord[] = [];
  const texts = textsOf(outbox, mutation);
  const sent = sentTexts(outbox, mutation);
  const migration = migrationOf(outbox, mutation);
  let opened = 0;

  const open = async (): Promise<{
    readonly session: Session;
    readonly label: string;
  }> => {
    opened += 1;

    return { label: `s${opened}`, session: await connect() };
  };

  const send = async (
    session: Session,
    label: string,
    text: string,
    values: readonly (string | number | boolean | null)[] = []
  ): Promise<readonly RawRow[]> => {
    log.push({ session: label, sql: text });

    return await session.query(text, values);
  };

  const withSession = async <T>(
    use: (session: Session, label: string) => Promise<T>
  ): Promise<T> => {
    const { session, label } = await open();

    try {
      return await use(session, label);
    } finally {
      await session.end();
    }
  };

  const run = async <A>(
    session: Session,
    label: string,
    statement: Statement<A>
  ): Promise<A> => {
    let step = statement.decode(
      await send(session, label, sent[statement.operation], statement.values)
    );

    while (!step.done) {
      const { next } = step;

      step = next.decode(
        await send(session, label, sent[next.operation], next.values)
      );
    }

    return step.value;
  };

  /** Standalone: a connection of its own, autocommit. */
  const alone = async <A>(statement: Statement<A>): Promise<A> =>
    await withSession(
      async (session, label) => await run(session, label, statement)
    );

  const txOf = (session: Session, label: string): Tx & { label: string } => ({
    label,
    query: async (text, values) => await send(session, label, text, values),
  });

  const sessions = new WeakMap<Tx, { session: Session; label: string }>();

  const transaction = async <T>(body: (tx: Tx) => Promise<T>): Promise<T> =>
    await withSession(async (session, label) => {
      const tx = txOf(session, label);

      sessions.set(tx, { label, session });
      await send(session, label, "BEGIN");

      try {
        const value = await body(tx);

        await send(session, label, "COMMIT");

        return value;
      } catch (error) {
        await send(session, label, "ROLLBACK");

        throw error;
      }
    });

  /** On the caller's transaction when `on` is given, else alone; a control can force the connection of its own. */
  const joining = async <A>(
    operation: OperationId,
    statement: Statement<A>,
    on: Tx | undefined
  ): Promise<A> => {
    const held = on === undefined ? undefined : sessions.get(on);

    if (
      held === undefined ||
      parts(mutation).some(
        (part) => part.kind === "ownConnection" && part.operation === operation
      )
    ) {
      return await alone(statement);
    }

    return await run(held.session, held.label, statement);
  };

  const inTransaction = async <A>(
    tx: Tx,
    statement: Statement<A>
  ): Promise<A> => {
    const held = sessions.get(tx);

    if (held === undefined) {
      throw new Error("holdClaim needs a transaction of this subject");
    }

    return await run(held.session, held.label, statement);
  };

  const subject: Subject = {
    ack: async (args, on) => await joining("ack", outbox.ack(args), on),
    bury: async (args, on) => await joining("bury", outbox.bury(args), on),
    claimBatch: async (args) => await alone(outbox.claimBatch(args)),
    claimById: async (args) => await alone(outbox.claimById(args)),
    cleanup: async (args) => await alone(outbox.cleanup(args)),
    counts: async (args) => await alone(outbox.counts(args)),
    enqueue: async (tx, args) =>
      await joining("enqueue", outbox.enqueue(args), tx),
    holdClaim: async (tx, args) =>
      await inTransaction(tx, outbox.holdClaim(args)),
    markQueued: async (args) => await alone(outbox.markQueued(args)),
    migrate: async () => {
      await withSession(async (session, label) => {
        await send(session, label, `DROP TABLE IF EXISTS biz, ${outbox.table}`);
        await send(session, label, bizTable);

        for (const statement of migration) {
          await send(session, label, statement);
        }
      });
    },
    open: async (args) => await alone(outbox.open(args)),
    outbox,
    release: async (args, on) =>
      await joining("release", outbox.release(args), on),
    sql: async (text, values) =>
      await withSession(
        async (session, label) => await send(session, label, text, values)
      ),
    stale: async (args) => await alone(outbox.stale(args)),
    transaction,
  };

  return { log, migration, subject, texts };
};

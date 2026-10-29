import { operationIds } from "@pg-outbox/core";
import type { OperationId } from "@pg-outbox/core";

import { parts, rewritten } from "./mutation.ts";
import type { Mutation } from "./mutation.ts";
import type { StatementRecord, Subject, SuiteOutbox } from "./subject.ts";

/**
 * What a subject is built from: the subject itself, what it has sent (per connection, in order), the text of each operation as
 * the falsifier's check reads it (a control's rewrite applied, even an inspect-only one) and the statements that create the
 * table. `coreSubject` and every adapter's subject return one, so the same falsifiers run on each.
 */
export interface Built {
  readonly subject: Subject;
  readonly log: StatementRecord[];
  readonly texts: Readonly<Record<OperationId, string>>;
  readonly migration: readonly string[];
}

/** The text of each operation with the control's statement rewrites applied (inspect-only ones included). */
export const mutatedTexts = (
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

/** The text of each operation as it is sent: an inspect-only rewrite is read by a check and never sent. */
export const sentTexts = (
  outbox: SuiteOutbox,
  mutation: Mutation | undefined
): Readonly<Record<OperationId, string>> =>
  mutatedTexts(outbox, {
    kind: "all",
    of: parts(mutation).filter(
      (part) => !(part.kind === "statement" && part.inspectOnly === true)
    ),
  });

/** The statements that create the table, with the control's migration rewrites applied. */
export const mutatedMigration = (
  outbox: SuiteOutbox,
  mutation: Mutation | undefined
): readonly string[] => {
  let statements = outbox.migration;
  let changes = false;

  for (const part of parts(mutation)) {
    if (part.kind === "migration") {
      statements = part.rewrite(statements);
      changes = true;
    }
  }

  if (changes && statements.join("\n") === outbox.migration.join("\n")) {
    throw new Error("the migration rewrite changed nothing");
  }

  return statements;
};

/** Whether the control runs `operation` on a connection of its own, outside the caller's transaction. */
export const runsOnOwnConnection = (
  mutation: Mutation | undefined,
  operation: OperationId
): boolean =>
  parts(mutation).some(
    (part) => part.kind === "ownConnection" && part.operation === operation
  );

/**
 * A function that turns the declaration's own text into the text a control sends, for a driver that sends what a builder
 * produced (an adapter): the operation is found by its text, so no adapter needs to know about controls.
 */
export const rewriteSent = (
  outbox: SuiteOutbox,
  mutation: Mutation | undefined
): ((text: string) => string) => {
  const sent = sentTexts(outbox, mutation);

  const replacement = new Map(
    operationIds.map((id) => [outbox.sql[id], sent[id]])
  );

  return (text) => replacement.get(text) ?? text;
};

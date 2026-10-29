import type { OperationId } from "@pg-outbox/core";

import type { Control } from "./mutation.ts";
import type { StatementRecord, Subject } from "./subject.ts";

/** What a falsifier runs with: the subject, and what the subject sent (a control's rewrite applied to the text). */
export interface Env {
  readonly subject: Subject;
  /** The text of each operation as the subject sends it. */
  readonly texts: Readonly<Record<OperationId, string>>;
  /** The statements that create the table, as the subject runs them. */
  readonly migration: readonly string[];
  /** Every statement the subject has sent, per connection, in order. */
  readonly log: readonly StatementRecord[];
  /** Fresh-state rounds of a race (`PG_OUTBOX_ROUNDS`, default 100). */
  readonly rounds: number;
}

/**
 * A property that must hold, and the defects that it must catch. `run` throws when the property is violated; each control is
 * a defect, and `run` against it must throw (`suite.ts` checks both).
 */
export interface Falsifier {
  readonly id: string;
  readonly title: string;
  readonly run: (env: Env) => Promise<void> | void;
  readonly controls: readonly Control[];
}

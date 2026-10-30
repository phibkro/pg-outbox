import { Schema } from "effect";

/**
 * The claim token is not the row's current one, or the row is no longer pending: nothing was written. Raised by `ack`,
 * `release`, `bury` and `holdClaim` in the **error channel**, so that "claim lost" cannot be dropped as an empty result: a
 * caller that does not handle it fails, and an `ack` or a hold inside the caller's transaction rolls that transaction back
 * (which is what a worker that lost its claim wants: its writes under the claim do not commit). To treat it as a value,
 * recover it by tag: `Effect.catchTag("ClaimLost", …)`.
 */
export class ClaimLost extends Schema.TaggedError<
  ClaimLost,
  { readonly brand: unique symbol }
>()("ClaimLost", {
  id: Schema.String,
  message: Schema.String,
  operation: Schema.Literals(["ack", "bury", "holdClaim", "release"]),
}) {}

/**
 * The mode cannot honour an operation the process said it uses (its catalogue cell is not `works`, or `unverified` without
 * `allowUnverified`). Raised when the outbox is built, with the core's message, which quotes the catalogue row and its sources.
 */
export class OperationRefusedError extends Schema.TaggedError<
  OperationRefusedError,
  { readonly brand: unique symbol }
>()("OperationRefusedError", {
  message: Schema.String,
  operation: Schema.String,
  rows: Schema.Array(Schema.String),
  support: Schema.Literals(["no", "unverified"]),
}) {}

/**
 * A defect, not an expected failure: `enqueue` or `holdClaim` ran with the `InTransaction` proof but no transaction of this
 * client is open (a proof forged by hand, or one from another client). The type makes it unreachable; this is the check
 * behind the type.
 */
export class NotInTransactionDefect extends Schema.TaggedError<
  NotInTransactionDefect,
  { readonly brand: unique symbol }
>()("NotInTransactionDefect", {
  message: Schema.String,
  operation: Schema.String,
}) {}

/**
 * A defect: a claim, receipt, sweep, report or cleanup ran inside a transaction. A claim inside an open transaction is
 * invisible to every other claimer until it ends, and keeps its row lock while the worker sends.
 */
export class StandaloneInTransactionDefect extends Schema.TaggedError<
  StandaloneInTransactionDefect,
  { readonly brand: unique symbol }
>()("StandaloneInTransactionDefect", {
  message: Schema.String,
  operation: Schema.String,
}) {}

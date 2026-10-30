import type {
  TransactionOptions,
  InvalidTransactionOptionsError,
  ModeRefusedError,
  NestedTransactionError,
} from "@pg-txmode/effect";
import { TxClient } from "@pg-txmode/effect";
import { Context, Effect } from "effect";
import type { SqlError } from "effect/sql/SqlError";

const proofBrand: unique symbol = Symbol("@pg-outbox/effect/InTransaction");

/**
 * The proof that a transaction is open: a requirement of `enqueue` and `holdClaim`, provided by `transaction` below and by
 * nothing else. A program that calls `enqueue` outside `transaction` has an unsatisfied requirement and does not run (it does
 * not compile when it is run through a typed entry point). The value's only member is keyed by a symbol that this module does
 * not export, so it cannot be written without a cast; and `enqueue` checks at run time that a transaction of its client is
 * open (a forged proof is a defect: `NotInTransactionDefect`).
 */
export class InTransaction extends Context.Service<
  InTransaction,
  { readonly [proofBrand]: true }
>()("@pg-outbox/effect/InTransaction") {}

/** What `transaction` can fail with besides the body's own errors: the driver, and the refusals of `@pg-txmode/effect`. */
export type TransactionError =
  | InvalidTransactionOptionsError
  | ModeRefusedError
  | NestedTransactionError
  | SqlError;

const proof = InTransaction.of({ [proofBrand]: true });

/**
 * Runs `body` in one transaction of the `TxClient`'s connection (pg-txmode's `TxClient.transaction`: isolation level and
 * timeouts, the whole body again after 40001 and 40P01, rolled back on failure and on interruption) and provides the
 * `InTransaction` proof to it.
 *
 * Contract. Success, error and requirements are the body's, minus `InTransaction`, plus `TxClient` and the errors of
 * `TxClient.transaction`. It does nothing until run. The body MUST be safe to run again (see `TxAttempt`). An
 * `ack` or `holdClaim` that fails with `ClaimLost` inside the body rolls the transaction back.
 */
export const transaction = <A, E, R>(
  body: Effect.Effect<A, E, R>,
  options?: TransactionOptions
): Effect.Effect<
  A,
  E | TransactionError,
  Exclude<R, InTransaction> | TxClient
> =>
  Effect.flatMap(TxClient, (client) =>
    client.transaction(
      Effect.provideService(body, InTransaction, proof),
      options
    )
  );

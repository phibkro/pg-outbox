import {
  databaseNow,
  execute,
  operationIds,
  requireOperation,
} from "@pg-outbox/core";
import type {
  AckResult,
  WithoutClock,
  BuilderName,
  BuryResult,
  ClaimResult,
  Claimed,
  Counts,
  EnqueueResult,
  HoldResult,
  Now,
  OpenRow,
  OperationId,
  Outbox,
  OutboxId,
  Query,
  ReleaseResult,
} from "@pg-outbox/core";
import type { Transaction, TxClient } from "@pg-txmode/pg";

export interface PgOutboxOptions<
  Kind extends string,
  ErrorClass extends string,
> {
  /** The declaration: the table, the closed sets and the retry policy. */
  readonly outbox: Outbox<Kind, ErrorClass>;
  /**
   * A client of `@pg-txmode/pg`, built for the connection mode that stands between this process and PostgreSQL. The mode
   * decides which operations are safe: an operation whose catalogue cell is not `works` for the mode is refused when the
   * outbox is built, quoting the catalogue (unless `allowUnverified`).
   */
  readonly db: TxClient;
  /**
   * The operations this process uses; every operation by default. A process that only enqueues on Hyperdrive says
   * `["enqueue"]` and is not refused for the claim statements it never runs.
   */
  readonly operations?: readonly OperationId[];
  /** Accept an operation that the catalogue marks `unverified` for the mode (neither documented nor measured). Off by default. */
  readonly allowUnverified?: boolean;
}

/**
 * What a call takes: the builder's arguments, with the clock optional. A call without `now` uses the database's own
 * `statement_timestamp()` (`databaseNow`), so every consumer agrees whatever its host's clock says; pass `fixedNow(at)` to
 * give the time yourself (a test, or a clock you trust more than the database's).
 */
type Call<
  Kind extends string,
  ErrorClass extends string,
  Operation extends BuilderName,
> = WithoutClock<Kind, ErrorClass, Operation> & {
  readonly now?: Now | undefined;
};

/**
 * The protocol as `pg` functions. Contract:
 *
 * - **Transactions are in the types.** `enqueue` and `holdClaim` take the `Transaction` of `db.transaction`: there is no way to
 *   call them without one, so a message cannot be written outside the business transaction. `ack`, `release` and `bury` take
 *   it optionally and join it when given (one conditional write that commits or rolls back with the caller's writes); the
 *   claims, the receipt, the sweep, the reports and the cleanup take none: each is one autocommit statement on a connection
 *   of the pool, and one that sat in a caller's transaction would hide its claim from every other claimer until it ended.
 * - **Results are values.** `ClaimLost` is a case of the result, never an empty array. A rejection of the driver (a
 *   `DatabaseError` with its SQLSTATE, a closed pool) is the caller's, unchanged, as is a transaction's own retry on 40001 and
 *   40P01 (`db.transaction`: the whole body runs again, so a body that enqueues must be safe to run twice).
 * - **Errors of the protocol.** An argument the protocol cannot send is an `InvalidArgumentError` before any statement runs; a
 *   row that is not the promised shape is a `ProtocolError`.
 * - **Cancellation.** A statement is not cancelled by this adapter. Cancel a transaction through `db.transaction`'s `signal`.
 * - **Nothing runs at construction** except the mode check, which reads the catalogue and sends nothing.
 */
export interface PgOutbox<Kind extends string, ErrorClass extends string> {
  readonly enqueue: (
    tx: Transaction,
    args: Call<Kind, ErrorClass, "enqueue">
  ) => Promise<EnqueueResult>;
  readonly claimById: (
    args: Call<Kind, ErrorClass, "claimById">
  ) => Promise<ClaimResult<Kind>>;
  readonly claimBatch: (
    args: Call<Kind, ErrorClass, "claimBatch">
  ) => Promise<readonly Claimed<Kind>[]>;
  readonly ack: (
    args: Call<Kind, ErrorClass, "ack">,
    tx?: Transaction
  ) => Promise<AckResult>;
  readonly release: (
    args: Call<Kind, ErrorClass, "release">,
    tx?: Transaction
  ) => Promise<ReleaseResult>;
  readonly bury: (
    args: Call<Kind, ErrorClass, "bury">,
    tx?: Transaction
  ) => Promise<BuryResult>;
  readonly holdClaim: (
    tx: Transaction,
    args: Call<Kind, ErrorClass, "holdClaim">
  ) => Promise<HoldResult>;
  readonly markQueued: (
    args: Call<Kind, ErrorClass, "markQueued">
  ) => Promise<number>;
  readonly stale: (
    args: Call<Kind, ErrorClass, "stale">
  ) => Promise<readonly OutboxId[]>;
  readonly counts: (args?: Call<Kind, ErrorClass, "counts">) => Promise<Counts>;
  readonly open: (
    args: Call<Kind, ErrorClass, "open">
  ) => Promise<readonly OpenRow<Kind, ErrorClass>[]>;
  readonly cleanup: (
    args: Call<Kind, ErrorClass, "cleanup">
  ) => Promise<number>;
}

const inTransaction =
  (tx: Transaction): Query =>
  async (text, values) =>
    await tx.query(text, values);

const at = (now: Now | undefined): Now => now ?? databaseNow;

/** The `pg` function set of one declared outbox over one `@pg-txmode/pg` client. */
export const createPgOutbox = <
  const Kind extends string,
  const ErrorClass extends string,
>(
  options: PgOutboxOptions<Kind, ErrorClass>
): PgOutbox<Kind, ErrorClass> => {
  const { outbox, db } = options;

  for (const id of options.operations ?? operationIds) {
    requireOperation(db.mode, id, {
      allowUnverified: options.allowUnverified === true,
    });
  }

  const alone: Query = async (text, values) => await db.query(text, values);

  /** On the caller's transaction when there is one, else alone. */
  const joining = (tx: Transaction | undefined): Query =>
    tx === undefined ? alone : inTransaction(tx);

  return {
    ack: async (args, tx) =>
      await execute(joining(tx), outbox.ack({ ...args, now: at(args.now) })),
    bury: async (args, tx) =>
      await execute(joining(tx), outbox.bury({ ...args, now: at(args.now) })),
    claimBatch: async (args) =>
      await execute(alone, outbox.claimBatch({ ...args, now: at(args.now) })),
    claimById: async (args) =>
      await execute(alone, outbox.claimById({ ...args, now: at(args.now) })),
    cleanup: async (args) =>
      await execute(alone, outbox.cleanup({ ...args, now: at(args.now) })),
    counts: async (args) =>
      await execute(alone, outbox.counts({ now: at(args?.now) })),
    enqueue: async (tx, args) =>
      await execute(
        inTransaction(tx),
        outbox.enqueue({ ...args, now: at(args.now) })
      ),
    holdClaim: async (tx, args) =>
      await execute(inTransaction(tx), outbox.holdClaim(args)),
    markQueued: async (args) =>
      await execute(alone, outbox.markQueued({ ...args, now: at(args.now) })),
    open: async (args) =>
      await execute(alone, outbox.open({ ...args, now: at(args.now) })),
    release: async (args, tx) =>
      await execute(
        joining(tx),
        outbox.release({ ...args, now: at(args.now) })
      ),
    stale: async (args) =>
      await execute(alone, outbox.stale({ ...args, now: at(args.now) })),
  };
};

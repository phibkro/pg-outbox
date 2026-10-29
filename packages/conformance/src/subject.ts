import type {
  AckResult,
  BuilderArgs,
  BuilderName,
  BuryResult,
  ClaimResult,
  Claimed,
  Counts,
  EnqueueResult,
  HoldResult,
  OpenRow,
  Outbox,
  OutboxId,
  Param,
  RawRow,
  ReleaseResult,
} from "@pg-outbox/core";

/** What a falsifier needs of one open transaction: raw statements (the business writes) and nothing else. */
export interface Tx {
  readonly query: (
    text: string,
    values?: readonly Param[]
  ) => Promise<readonly RawRow[]>;
}

/** The kinds and classes every conformance run declares. */
export type Kind = "Hook" | "Mail";

export type ErrorClass = "rejected" | "timeout" | "undecodable";

export type SuiteOutbox = Outbox<Kind, ErrorClass>;

/** The arguments of a builder of the declared outbox: a subject takes the same arguments, in promises. */
type ArgsOf<Operation extends BuilderName> = BuilderArgs<
  Kind,
  ErrorClass,
  Operation
>;

/**
 * The protocol as one client exposes it, in promises: the core's statements behind the core's own loop
 * (`coreSubject`), or an adapter's functions (specs 0002 and 0003 bring their own subject). The same falsifiers run on each.
 * Every call that touches time takes the `Now` of the falsifier, so a lease lapses by arithmetic, not by sleeping.
 */
export interface Subject {
  readonly outbox: SuiteOutbox;
  /** Drops and creates the outbox table and the falsifiers' `biz` table. */
  readonly migrate: () => Promise<void>;
  /** One autocommit statement on a connection of its own: fixtures, and the observations a falsifier makes. */
  readonly sql: (
    text: string,
    values?: readonly Param[]
  ) => Promise<readonly RawRow[]>;
  /** The whole of `body` in one transaction on one connection: COMMIT when it returns, ROLLBACK when it throws. */
  readonly transaction: <T>(body: (tx: Tx) => Promise<T>) => Promise<T>;
  readonly enqueue: (tx: Tx, args: ArgsOf<"enqueue">) => Promise<EnqueueResult>;
  readonly claimById: (args: ArgsOf<"claimById">) => Promise<ClaimResult<Kind>>;
  readonly claimBatch: (
    args: ArgsOf<"claimBatch">
  ) => Promise<readonly Claimed<Kind>[]>;
  /** `on` is the caller's transaction; without it the statement commits alone. */
  readonly ack: (args: ArgsOf<"ack">, on?: Tx) => Promise<AckResult>;
  readonly release: (
    args: ArgsOf<"release">,
    on?: Tx
  ) => Promise<ReleaseResult>;
  readonly bury: (args: ArgsOf<"bury">, on?: Tx) => Promise<BuryResult>;
  readonly holdClaim: (
    tx: Tx,
    args: ArgsOf<"holdClaim">
  ) => Promise<HoldResult>;
  readonly markQueued: (args: ArgsOf<"markQueued">) => Promise<number>;
  readonly stale: (args: ArgsOf<"stale">) => Promise<readonly OutboxId[]>;
  readonly counts: (args: ArgsOf<"counts">) => Promise<Counts>;
  readonly open: (
    args: ArgsOf<"open">
  ) => Promise<readonly OpenRow<Kind, ErrorClass>[]>;
  readonly cleanup: (args: ArgsOf<"cleanup">) => Promise<number>;
}

/** The statements that a subject sent, in order, per connection: what the lint reads (falsifier F8). */
export interface StatementRecord {
  readonly sql: string;
  readonly session: string;
}

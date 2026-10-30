import type { Now } from "./now.ts";
import type { OperationId } from "./operations.ts";
import type {
  AckResult,
  BuryResult,
  ClaimResult,
  Claimed,
  Counts,
  EnqueueResult,
  HoldResult,
  Json,
  OpenRow,
  OutboxId,
  ReleaseResult,
} from "./results.ts";
import type { Statement } from "./statement.ts";

/** The declared protocol of one outbox: its schema, its policy and a builder for every statement. */
export interface Outbox<
  Kind extends string = string,
  ErrorClass extends string = string,
> {
  readonly name: string;
  /** The quoted, qualified table name as the statements use it. */
  readonly table: string;
  readonly kinds: readonly string[] | undefined;
  readonly errorClasses: readonly string[];
  readonly maxAttempts: number;
  /** The text of every statement by operation: the single source the builders and the conformance controls read. */
  readonly sql: Readonly<Record<OperationId, string>>;
  /** `CREATE` statements in order, for the caller's migration tool. */
  readonly migration: readonly string[];
  readonly teardown: readonly string[];
  /** The delay before the next attempt after the `attempts`-th claim failed. */
  readonly retryDelayMs: (attempts: number) => number;
  readonly enqueue: (args: {
    readonly kind: Kind;
    readonly payload: Json;
    /**
     * Messages with the same `kind` and `dedupeKey` are stored once: the second is `Duplicate`. The unique index covers every
     * row of the table, so a delivered or dead row keeps blocking its key **until `cleanup` deletes it**; a key can be reused
     * only after the retention window.
     */
    readonly dedupeKey?: string | undefined;
    readonly now: Now;
  }) => Statement<EnqueueResult>;
  readonly claimById: (args: {
    readonly id: string;
    readonly leaseMs: number;
    readonly now: Now;
  }) => Statement<ClaimResult<Kind>>;
  readonly claimBatch: (args: {
    readonly limit: number;
    readonly leaseMs: number;
    readonly now: Now;
  }) => Statement<readonly Claimed<Kind>[]>;
  readonly ack: (args: {
    readonly id: string;
    readonly token: string;
    readonly now: Now;
  }) => Statement<AckResult>;
  readonly release: (args: {
    readonly id: string;
    readonly token: string;
    /**
     * The `attempts` of the claim being released: the number `claimById` or `claimBatch` returned. It only picks the delay
     * from the declared list (`retryDelayMs`); whether the row ends is decided by the row's own `attempts`, which the token
     * ties to this claim (a token is unique to one claim), so the two are the same number unless the caller passes another.
     */
    readonly attempts: number;
    readonly errorClass?: ErrorClass | undefined;
    readonly retryAfterMs?: number | undefined;
    readonly now: Now;
  }) => Statement<ReleaseResult>;
  readonly bury: (args: {
    readonly id: string;
    readonly token: string;
    readonly errorClass: ErrorClass;
    readonly now: Now;
  }) => Statement<BuryResult>;
  readonly holdClaim: (args: {
    readonly id: string;
    readonly token: string;
  }) => Statement<HoldResult>;
  readonly markQueued: (args: {
    readonly ids: readonly string[];
    readonly now: Now;
  }) => Statement<number>;
  readonly stale: (args: {
    readonly olderThanMs: number;
    readonly limit: number;
    readonly now: Now;
  }) => Statement<readonly OutboxId[]>;
  readonly counts: (args: { readonly now: Now }) => Statement<Counts>;
  readonly open: (args: {
    readonly limit: number;
    readonly now: Now;
  }) => Statement<readonly OpenRow<Kind, ErrorClass>[]>;
  readonly cleanup: (args: {
    readonly olderThanMs: number;
    readonly limit: number;
    readonly now: Now;
  }) => Statement<number>;
}

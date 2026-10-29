/** What the protocol answers. Every answer is a value: "claim lost" is a case the caller must handle, never an empty result. */

/** A JSON value: what a payload is before it is stored and after it is read. */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

declare const idBrand: unique symbol;
declare const tokenBrand: unique symbol;

/** A row's id: a decimal string (`bigint` exceeds `Number`). Also the idempotency key for a provider that takes one. */
export type OutboxId = string & { readonly [idBrand]: true };

/** Proof of a claim, valid until the row is claimed again or settled. */
export type ClaimToken = string & { readonly [tokenBrand]: true };

export interface Enqueued {
  readonly _tag: "Enqueued";
  readonly id: OutboxId;
}

export interface Duplicate {
  readonly _tag: "Duplicate";
}

export type EnqueueResult = Enqueued | Duplicate;

/** A row this caller now holds. `attempts` counts claims including this one: the fencing number for a downstream system. */
export interface Claimed<Kind extends string = string> {
  readonly _tag: "Claimed";
  readonly id: OutboxId;
  readonly kind: Kind;
  readonly payload: Json;
  readonly token: ClaimToken;
  readonly attempts: number;
}

/** Another claim holds the row for about `remainingMs` more (0: it was released between the two statements; look again). */
export interface Held {
  readonly _tag: "Held";
  readonly remainingMs: number;
}

/** The row is pending and free, and its next attempt is `dueInMs` away. */
export interface NotDue {
  readonly _tag: "NotDue";
  readonly dueInMs: number;
}

/** The row is delivered, dead or gone: nothing to do. */
export interface Settled {
  readonly _tag: "Settled";
}

export type ClaimResult<Kind extends string = string> =
  | Claimed<Kind>
  | Held
  | NotDue
  | Settled;

/** The token is not the row's current one (or the row is no longer pending). Nothing was written. Do nothing more. */
export interface ClaimLost {
  readonly _tag: "ClaimLost";
}

export type AckResult = { readonly _tag: "Delivered" } | ClaimLost;

export interface Released {
  readonly _tag: "Released";
}

export interface Buried {
  readonly _tag: "Buried";
}

export type ReleaseResult = Released | Buried | ClaimLost;

export type BuryResult = Buried | ClaimLost;

/** The hold is taken: the row stays locked, and your claim current, until your transaction ends. */
export interface Holding {
  readonly _tag: "Holding";
}

export type HoldResult = Holding | ClaimLost;

export type Status = "pending" | "delivered" | "dead";

export type Counts = Readonly<Record<Status, number>>;

/** A pending row as an operator sees it: never the payload. */
export interface OpenRow<Kind extends string, ErrorClass extends string> {
  readonly id: OutboxId;
  readonly kind: Kind;
  readonly attempts: number;
  readonly lastError: ErrorClass | null;
  /** Milliseconds until the live claim ends; 0 when none. */
  readonly heldMs: number;
  /** Milliseconds until the next attempt is due; 0 when it is due. */
  readonly dueInMs: number;
}

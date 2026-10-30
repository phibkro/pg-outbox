import {
  claimedRow,
  classifyRow,
  countRow,
  idRow,
  openRow,
  parsePayload,
  parseRow,
  releaseRow,
} from "./decode.ts";
import { nowParam } from "./now.ts";
import type { Now } from "./now.ts";
import type { OperationId } from "./operations.ts";
import type { Outbox } from "./outboxType.ts";
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
  Status,
} from "./results.ts";
import { migration, teardown } from "./schema.ts";
import { statements } from "./sql.ts";
import { andThen, done, ProtocolError } from "./statement.ts";
import type { Param, RawRow, Statement, Step } from "./statement.ts";
import {
  checkIdentifier,
  checkWord,
  claimToken,
  InvalidArgumentError,
  outboxId,
  positiveNumber,
  wholeNumber,
} from "./validate.ts";

/** At most one row: the statements that cannot match more than one say so, and a second row is a defect. */
const only = (
  operation: OperationId,
  rows: readonly RawRow[]
): RawRow | undefined => {
  if (rows.length > 1) {
    throw new ProtocolError(
      operation,
      `${rows.length} rows where at most one is possible`
    );
  }

  return rows[0];
};

/** The retry policy, as data: how many claims a row may use up, and how long to wait after each failed one. */
export interface RetryPolicy {
  /** `release` ends a row `dead` once it has been claimed this many times and a failure class is on record. */
  readonly maxAttempts: number;
  /** After the n-th failed attempt the next is due `delaysMs[min(n, length) - 1]` later. */
  readonly delaysMs: readonly [number, ...number[]];
}

export interface OutboxConfig<Kind extends string, ErrorClass extends string> {
  /** A lower-case name; the library quotes it, so it needs no escaping. */
  readonly table: string;
  readonly schema?: string;
  /** A closed set of message kinds, checked by the table. Omit it to accept any kind (then `Kind` is `string`). */
  readonly kinds?: readonly [Kind, ...Kind[]];
  /** The only values `last_error` can hold: a class, never provider text. Checked by the table. */
  readonly errorClasses: readonly [ErrorClass, ...ErrorClass[]];
  readonly retry: RetryPolicy;
}

const unique = (what: string, values: readonly string[]): void => {
  if (new Set(values).size !== values.length) {
    throw new InvalidArgumentError(`${what} has a duplicate`);
  }
};

const checkRetry = (retry: RetryPolicy): void => {
  positiveNumber("retry.maxAttempts", retry.maxAttempts);

  for (const delay of retry.delaysMs) {
    wholeNumber("retry.delaysMs entry", delay);
  }
};

/** `dedupeKey` is optional text; an absent key is a null, which never conflicts. */
const dedupeParam = (key: string | undefined): Param => key ?? null;

/**
 * A declaration: the table, the closed sets and the retry policy of one outbox, and from them everything else (the
 * migration, every statement with its typed answer). Pure data and pure functions: nothing here touches a database, and
 * building a statement runs nothing. An adapter executes `Statement`s.
 */
export const declareOutbox = <
  const Kind extends string = string,
  const ErrorClass extends string = string,
>(
  config: OutboxConfig<Kind, ErrorClass>
): Outbox<Kind, ErrorClass> => {
  const name = checkIdentifier("table", config.table);

  const schema =
    config.schema === undefined
      ? undefined
      : checkIdentifier("schema", config.schema);

  const table = schema === undefined ? `"${name}"` : `"${schema}"."${name}"`;

  const kinds: readonly string[] | undefined = config.kinds?.map((kind) =>
    checkWord("kind", kind)
  );

  const errorClasses: readonly string[] = config.errorClasses.map((value) =>
    checkWord("error class", value)
  );

  unique("kinds", kinds ?? []);
  unique("errorClasses", errorClasses);
  checkRetry(config.retry);

  const sql = statements(table);
  const { retry } = config;

  const isKind = (value: string): value is Kind =>
    kinds === undefined || kinds.includes(value);

  const isErrorClass = (value: string): value is ErrorClass =>
    errorClasses.includes(value);

  const checkKind = (value: string): Kind => {
    if (!isKind(value)) {
      throw new InvalidArgumentError(`kind ${value} is not declared`);
    }

    return value;
  };

  const checkClass = (value: string): ErrorClass => {
    if (!isErrorClass(value)) {
      throw new InvalidArgumentError(
        `error class ${value} is not declared (a class, never provider text)`
      );
    }

    return value;
  };

  /** A row of a kind or class that the declaration does not know was written by someone else: a defect, not an answer. */
  const storedKind = (operation: OperationId, value: string): Kind => {
    if (!isKind(value)) {
      throw new ProtocolError(operation, `kind ${value} is not declared`);
    }

    return value;
  };

  const storedClass = (operation: OperationId, value: string): ErrorClass => {
    if (!isErrorClass(value)) {
      throw new ProtocolError(
        operation,
        `error class ${value} is not declared`
      );
    }

    return value;
  };

  const decodeClaimed = (
    operation: OperationId,
    row: RawRow
  ): Claimed<Kind> => {
    const parsed = parseRow(operation, claimedRow, row);

    return {
      _tag: "Claimed",
      attempts: parsed.attempts,
      id: outboxId(parsed.id),
      kind: storedKind(operation, parsed.kind),
      payload: parsePayload(operation, parsed.payload),
      token: claimToken(parsed.claim_token),
    };
  };

  const make = <A>(
    operation: OperationId,
    values: readonly Param[],
    decode: (rows: readonly RawRow[]) => Step<A>
  ): Statement<A> => ({ decode, operation, text: sql[operation], values });

  /** Why a claim by id matched nothing. */
  const classify = (id: OutboxId, now: Now): Statement<ClaimResult<Kind>> =>
    make<ClaimResult<Kind>>("classify", [id, nowParam(now)], (rows) => {
      const row = only("classify", rows);

      if (row === undefined) {
        return done({ _tag: "Settled" });
      }

      const parsed = parseRow("classify", classifyRow, row);

      if (parsed.status !== "pending") {
        return done({ _tag: "Settled" });
      }

      if (parsed.held_ms > 0) {
        return done({ _tag: "Held", remainingMs: parsed.held_ms });
      }

      return parsed.due_ms > 0
        ? done({ _tag: "NotDue", dueInMs: parsed.due_ms })
        : done({ _tag: "Held", remainingMs: 0 });
    });

  const claimById: Outbox<Kind, ErrorClass>["claimById"] = (args) => {
    const id = outboxId(args.id);

    return make(
      "claimById",
      [id, wholeNumber("leaseMs", args.leaseMs), nowParam(args.now)],
      (rows) => {
        const row = only("claimById", rows);

        return row === undefined
          ? andThen(classify(id, args.now))
          : done(decodeClaimed("claimById", row));
      }
    );
  };

  const claimBatch: Outbox<Kind, ErrorClass>["claimBatch"] = (args) =>
    make(
      "claimBatch",
      [
        positiveNumber("limit", args.limit),
        wholeNumber("leaseMs", args.leaseMs),
        nowParam(args.now),
      ],
      (rows) => done(rows.map((row) => decodeClaimed("claimBatch", row)))
    );

  const enqueue: Outbox<Kind, ErrorClass>["enqueue"] = (args) =>
    make<EnqueueResult>(
      "enqueue",
      [
        checkKind(args.kind),
        dedupeParam(args.dedupeKey),
        JSON.stringify(args.payload satisfies Json),
        nowParam(args.now),
      ],
      (rows) => {
        const row = only("enqueue", rows);

        return done(
          row === undefined
            ? { _tag: "Duplicate" }
            : {
                _tag: "Enqueued",
                id: outboxId(parseRow("enqueue", idRow, row).id),
              }
        );
      }
    );

  const ack: Outbox<Kind, ErrorClass>["ack"] = (args) =>
    make<AckResult>(
      "ack",
      [outboxId(args.id), claimToken(args.token), nowParam(args.now)],
      (rows) =>
        done(
          only("ack", rows) === undefined
            ? { _tag: "ClaimLost" }
            : { _tag: "Delivered" }
        )
    );

  const bury: Outbox<Kind, ErrorClass>["bury"] = (args) =>
    make<BuryResult>(
      "bury",
      [
        outboxId(args.id),
        claimToken(args.token),
        checkClass(args.errorClass),
        nowParam(args.now),
      ],
      (rows) =>
        done(
          only("bury", rows) === undefined
            ? { _tag: "ClaimLost" }
            : { _tag: "Buried" }
        )
    );

  const retryDelayMs = (attempts: number): number =>
    retry.delaysMs[
      Math.min(positiveNumber("attempts", attempts), retry.delaysMs.length) - 1
    ] ?? 0;

  const release: Outbox<Kind, ErrorClass>["release"] = (args) =>
    make<ReleaseResult>(
      "release",
      [
        outboxId(args.id),
        claimToken(args.token),
        args.errorClass === undefined ? null : checkClass(args.errorClass),
        args.retryAfterMs === undefined
          ? retryDelayMs(args.attempts)
          : wholeNumber("retryAfterMs", args.retryAfterMs),
        retry.maxAttempts,
        nowParam(args.now),
      ],
      (rows) => {
        const row = only("release", rows);

        if (row === undefined) {
          return done({ _tag: "ClaimLost" });
        }

        return done(
          parseRow("release", releaseRow, row).status === "dead"
            ? { _tag: "Buried" }
            : { _tag: "Released" }
        );
      }
    );

  const holdClaim: Outbox<Kind, ErrorClass>["holdClaim"] = (args) =>
    make<HoldResult>(
      "holdClaim",
      [outboxId(args.id), claimToken(args.token)],
      (rows) =>
        done(
          only("holdClaim", rows) === undefined
            ? { _tag: "ClaimLost" }
            : { _tag: "Holding" }
        )
    );

  const markQueued: Outbox<Kind, ErrorClass>["markQueued"] = (args) =>
    make(
      "markQueued",
      [JSON.stringify(args.ids.map(outboxId)), nowParam(args.now)],
      (rows) => done(rows.length)
    );

  const stale: Outbox<Kind, ErrorClass>["stale"] = (args) =>
    make(
      "stale",
      [
        wholeNumber("olderThanMs", args.olderThanMs),
        positiveNumber("limit", args.limit),
        nowParam(args.now),
      ],
      (rows) =>
        done(rows.map((row) => outboxId(parseRow("stale", idRow, row).id)))
    );

  const counts: Outbox<Kind, ErrorClass>["counts"] = (args) =>
    make("counts", [nowParam(args.now)], (rows) => {
      const tally: Record<Status, number> = {
        dead: 0,
        delivered: 0,
        pending: 0,
      };

      for (const row of rows) {
        const parsed = parseRow("counts", countRow, row);

        tally[parsed.status] = parsed.n;
      }

      const result: Counts = tally;

      return done(result);
    });

  const open: Outbox<Kind, ErrorClass>["open"] = (args) =>
    make(
      "open",
      [positiveNumber("limit", args.limit), nowParam(args.now)],
      (rows) =>
        done(
          rows.map((row): OpenRow<Kind, ErrorClass> => {
            const parsed = parseRow("open", openRow, row);

            return {
              attempts: parsed.attempts,
              dueInMs: parsed.due_ms,
              heldMs: parsed.held_ms,
              id: outboxId(parsed.id),
              kind: storedKind("open", parsed.kind),
              lastError:
                parsed.last_error === null
                  ? null
                  : storedClass("open", parsed.last_error),
            };
          })
        )
    );

  const cleanup: Outbox<Kind, ErrorClass>["cleanup"] = (args) =>
    make(
      "cleanup",
      [
        wholeNumber("olderThanMs", args.olderThanMs),
        positiveNumber("limit", args.limit),
        nowParam(args.now),
      ],
      (rows) => done(rows.length)
    );

  return {
    ack,
    bury,
    claimBatch,
    claimById,
    cleanup,
    counts,
    enqueue,
    errorClasses,
    holdClaim,
    kinds,
    markQueued,
    maxAttempts: retry.maxAttempts,
    migration: migration({ errorClasses, kinds, name, table }),
    name,
    open,
    release,
    retryDelayMs,
    sql,
    stale,
    table,
    teardown: teardown(table),
  };
};

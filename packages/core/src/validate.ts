import type { ClaimToken, OutboxId } from "./results.ts";

/** An argument the protocol cannot send: a bug of the caller, found before any statement runs. */
export class InvalidArgumentError extends Error {
  override readonly name = "InvalidArgumentError";
}

const decimal = /^[0-9]{1,19}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** `decimal` admits only the decimal text of a bigint id; the guard is what makes the brand true. */
const isOutboxId = (text: string): text is OutboxId => decimal.test(text);

/** `uuid` admits only the text form of a UUID, which is what `gen_random_uuid()` produces. */
const isClaimToken = (text: string): text is ClaimToken => uuid.test(text);

export const outboxId = (text: string): OutboxId => {
  if (!isOutboxId(text)) {
    throw new InvalidArgumentError(`${text} is not an outbox id`);
  }

  return text;
};

export const claimToken = (text: string): ClaimToken => {
  if (!isClaimToken(text)) {
    throw new InvalidArgumentError(`${text} is not a claim token`);
  }

  return text;
};

/** An integer in 0 to 2^31 - 1: a lease, a delay, a limit or a count that PostgreSQL takes as `int`. */
export const wholeNumber = (what: string, value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new InvalidArgumentError(
      `${what} must be an integer from 0 to 2147483647, got ${String(value)}`
    );
  }

  return value;
};

export const positiveNumber = (what: string, value: number): number => {
  if (wholeNumber(what, value) === 0) {
    throw new InvalidArgumentError(`${what} must be at least 1`);
  }

  return value;
};

/** A kind or a failure class: text that is safe inside a SQL literal without quoting. */
const word = /^[A-Za-z][A-Za-z0-9_.:-]{0,62}$/u;

export const checkWord = (what: string, value: string): string => {
  if (!word.test(value)) {
    throw new InvalidArgumentError(
      `${what} ${JSON.stringify(value)} must match ${String(word)}`
    );
  }

  return value;
};

/** A table or schema name: lower-case letters, digits and underscores, so the name is safe once quoted. */
const identifier = /^[a-z_][a-z0-9_]{0,40}$/u;

export const checkIdentifier = (what: string, value: string): string => {
  if (!identifier.test(value)) {
    throw new InvalidArgumentError(
      `${what} ${JSON.stringify(value)} must match ${String(identifier)}`
    );
  }

  return value;
};

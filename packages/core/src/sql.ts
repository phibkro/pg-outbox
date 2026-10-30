/**
 * The text of every statement of the protocol, as functions of the quoted table name. Parameters are numbered in the order
 * of the builders' `values` (`outbox.ts`). Time is `instant(n)`: the caller's `Now`, else the database's clock.
 *
 * Every statement is one autocommit statement; none needs a session (no LISTEN, no advisory lock, no SET, no named
 * statement), so each runs the same behind a transaction pooler. The fence relies on READ COMMITTED, PostgreSQL's default:
 * a second claimer waits for the row lock and re-reads the row. Under REPEATABLE READ the loser gets 40001 instead.
 */
import { instant } from "./now.ts";
import type { OperationId } from "./operations.ts";

const ms = (position: number): string =>
  `$${position}::float8 * interval '1 millisecond'`;

const returningClaimed = (table: string): string =>
  `${table}.id::text AS id, ${table}.kind AS kind, ${table}.payload::text AS payload, ${table}.claim_token::text AS claim_token, ${table}.attempts AS attempts`;

/** `release` ends the row when the declared attempts are used and a failure class is on record (this call's or earlier). */
const ending =
  "(attempts >= $5::int AND COALESCE($3::text, last_error) IS NOT NULL)";

export const statements = (table: string): Record<OperationId, string> => ({
  ack: `UPDATE ${table} SET status = 'delivered', settled_at = ${instant(3)}, claim_token = NULL, claimed_until = NULL WHERE id = $1::bigint AND claim_token = $2::uuid AND status = 'pending' RETURNING id::text AS id`,
  bury: `UPDATE ${table} SET status = 'dead', settled_at = ${instant(4)}, claim_token = NULL, claimed_until = NULL, last_error = $3::text WHERE id = $1::bigint AND claim_token = $2::uuid AND status = 'pending' RETURNING id::text AS id`,
  claimBatch: `WITH due AS (SELECT id FROM ${table} WHERE status = 'pending' AND next_attempt_at <= ${instant(3)} AND (claimed_until IS NULL OR claimed_until <= ${instant(3)}) ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT $1::int) UPDATE ${table} SET claim_token = gen_random_uuid(), claimed_until = ${instant(3)} + ${ms(2)}, attempts = ${table}.attempts + 1 FROM due WHERE ${table}.id = due.id RETURNING ${returningClaimed(table)}`,
  claimById: `UPDATE ${table} SET claim_token = gen_random_uuid(), claimed_until = ${instant(3)} + ${ms(2)}, attempts = attempts + 1 WHERE id = $1::bigint AND status = 'pending' AND next_attempt_at <= ${instant(3)} AND (claimed_until IS NULL OR claimed_until <= ${instant(3)}) RETURNING ${returningClaimed(table)}`,
  classify: `SELECT status, CASE WHEN claimed_until > ${instant(2)} THEN ceil(extract(epoch FROM claimed_until - ${instant(2)}) * 1000)::bigint ELSE 0 END AS held_ms, CASE WHEN next_attempt_at > ${instant(2)} THEN ceil(extract(epoch FROM next_attempt_at - ${instant(2)}) * 1000)::bigint ELSE 0 END AS due_ms FROM ${table} WHERE id = $1::bigint`,
  cleanup: `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE status IN ('delivered', 'dead') AND settled_at <= ${instant(3)} - ${ms(1)} ORDER BY id LIMIT $2::int) RETURNING id::text AS id`,
  counts: `SELECT status, count(*)::int AS n, ${instant(1)}::text AS at FROM ${table} GROUP BY status`,
  enqueue: `INSERT INTO ${table} (kind, dedupe_key, payload, created_at, next_attempt_at) VALUES ($1::text, $2::text, $3::jsonb, ${instant(4)}, ${instant(4)}) ON CONFLICT (kind, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id::text AS id`,
  holdClaim: `SELECT id::text AS id FROM ${table} WHERE id = $1::bigint AND claim_token = $2::uuid AND status = 'pending' FOR NO KEY UPDATE`,
  markQueued: `UPDATE ${table} SET queued_at = ${instant(2)} WHERE id IN (SELECT value::bigint FROM jsonb_array_elements_text($1::jsonb)) AND status = 'pending' RETURNING id::text AS id`,
  open: `SELECT id::text AS id, kind, attempts, last_error, CASE WHEN claimed_until > ${instant(2)} THEN ceil(extract(epoch FROM claimed_until - ${instant(2)}) * 1000)::bigint ELSE 0 END AS held_ms, CASE WHEN next_attempt_at > ${instant(2)} THEN ceil(extract(epoch FROM next_attempt_at - ${instant(2)}) * 1000)::bigint ELSE 0 END AS due_ms FROM ${table} WHERE status = 'pending' ORDER BY id DESC LIMIT $1::int`,
  release: `UPDATE ${table} SET last_error = COALESCE($3::text, last_error), status = CASE WHEN ${ending} THEN 'dead' ELSE 'pending' END, settled_at = CASE WHEN ${ending} THEN ${instant(6)} END, next_attempt_at = CASE WHEN ${ending} THEN next_attempt_at ELSE ${instant(6)} + ${ms(4)} END, claim_token = NULL, claimed_until = NULL WHERE id = $1::bigint AND claim_token = $2::uuid AND status = 'pending' RETURNING id::text AS id, status`,
  stale: `SELECT id::text AS id FROM ${table} WHERE status = 'pending' AND (claimed_until IS NULL OR claimed_until <= ${instant(3)}) AND GREATEST(COALESCE(queued_at, created_at), next_attempt_at) <= ${instant(3)} - ${ms(1)} ORDER BY id LIMIT $2::int`,
});

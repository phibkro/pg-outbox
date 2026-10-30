/** The table, its indexes and its constraints, as statements: the caller's migration tool runs them in order. */

/** `'a', 'b'` for a list that `declareOutbox` already checked for quotes. */
const literals = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

export interface SchemaInput {
  /** The quoted, qualified table name. */
  readonly table: string;
  /** The bare table name, for constraint and index names. */
  readonly name: string;
  readonly kinds: readonly string[] | undefined;
  readonly errorClasses: readonly string[];
}

export const schemaVersion = 1;

export const migration = ({
  table,
  name,
  kinds,
  errorClasses,
}: SchemaInput): readonly string[] => [
  `CREATE TABLE ${table} (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL${kinds === undefined ? "" : ` CONSTRAINT ${name}_kind CHECK (kind IN (${literals(kinds)}))`},
  dedupe_key text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claim_token uuid,
  claimed_until timestamptz,
  next_attempt_at timestamptz NOT NULL,
  queued_at timestamptz,
  settled_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  CONSTRAINT ${name}_status CHECK (status IN ('pending', 'delivered', 'dead')),
  CONSTRAINT ${name}_attempts CHECK (attempts >= 0),
  CONSTRAINT ${name}_lease CHECK ((claim_token IS NULL) = (claimed_until IS NULL)),
  CONSTRAINT ${name}_claim_open CHECK (claim_token IS NULL OR status = 'pending'),
  CONSTRAINT ${name}_settled CHECK ((status = 'pending') = (settled_at IS NULL)),
  CONSTRAINT ${name}_dead_class CHECK (status <> 'dead' OR last_error IS NOT NULL),
  CONSTRAINT ${name}_error_class CHECK (last_error IS NULL OR last_error IN (${literals(errorClasses)}))
)`,
  `CREATE INDEX ${name}_due ON ${table} (next_attempt_at) WHERE status = 'pending'`,
  `CREATE UNIQUE INDEX ${name}_dedupe ON ${table} (kind, dedupe_key) WHERE dedupe_key IS NOT NULL`,
  `COMMENT ON TABLE ${table} IS 'pg-outbox schema ${schemaVersion}'`,
];

export const teardown = (table: string): readonly string[] => [
  `DROP TABLE IF EXISTS ${table}`,
];

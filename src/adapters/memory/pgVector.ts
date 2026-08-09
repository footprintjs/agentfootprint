/**
 * adapters/memory/pgVector — the target our own port has named since 2.x.
 *
 * `MemoryStore`'s docstring has listed the backends it was designed for from
 * the beginning — *"Every storage backend (InMemory, Redis, DynamoDB,
 * **Postgres**, Bedrock AgentCore) implements this interface"* — and named the
 * query, twice, in the places an implementer would look: *"**Postgres**:
 * multi-row INSERT … ON CONFLICT DO UPDATE"* for `putMany`, *"**pgvector**:
 * `ORDER BY embedding <=> query LIMIT k`"* for `search`. Every one of those
 * sentences was true about the design and false about the shipped package.
 * This is the adapter that makes them the same sentence.
 *
 * It matters more than one row in a table of backends. Postgres is the database
 * most teams already run, `pgvector` is an extension away, and a corpus that
 * lives beside the application's own data inherits its backups, its failover,
 * its access control and its migrations. `sqliteVectorStore` is one machine;
 * `s3VectorsStore` is serverless and eventually consistent; this is the one for
 * a fleet that already has a database.
 *
 * ── The table, and why this does not create it ──────────────────────────────
 * A `vector(N)` column fixes N at creation, and N is a fact about your
 * embedder. Creating the table implicitly would pick that number — and the
 * index type, and the operator class — on your behalf, in a migration you never
 * reviewed, in a database whose DDL is usually somebody's job. So the schema is
 * yours to run, and this store REFUSES a table that is missing rather than
 * silently answering "no matches" against nothing:
 *
 * ```sql
 * CREATE EXTENSION IF NOT EXISTS vector;
 *
 * -- 1024 = your embedder's dimensions. bedrockEmbedder() default: 1024.
 * --        openaiEmbedder() default: 1536. staticEmbedder(): 256.
 * CREATE TABLE af_vectors (
 *   namespace        TEXT    NOT NULL,
 *   id               TEXT    NOT NULL,
 *   value            JSONB   NOT NULL,
 *   metadata         JSONB,
 *   embedding        vector(1024),
 *   embedder_fp      TEXT,
 *   version          INTEGER NOT NULL,
 *   created_at       BIGINT  NOT NULL,
 *   updated_at       BIGINT  NOT NULL,
 *   last_accessed_at BIGINT  NOT NULL,
 *   access_count     INTEGER NOT NULL,
 *   ttl              BIGINT,
 *   tier             TEXT,
 *   source           JSONB,
 *   embedding_model  TEXT,
 *   PRIMARY KEY (namespace, id)
 * );
 *
 * -- Cosine, because that is the score this port reports and every threshold
 * -- in this library is calibrated on. Match the operator class to the metric.
 * CREATE INDEX af_vectors_hnsw ON af_vectors
 *   USING hnsw (embedding vector_cosine_ops);
 * CREATE INDEX af_vectors_ns ON af_vectors (namespace);
 *
 * -- Recognition (`seen`/`recordSignature`), usefulness feedback, and the
 * -- per-namespace embedder fingerprint. Small, and each one is a port method
 * -- that would otherwise have to be refused.
 * CREATE TABLE af_signatures (
 *   namespace TEXT NOT NULL, signature TEXT NOT NULL,
 *   PRIMARY KEY (namespace, signature)
 * );
 * CREATE TABLE af_feedback (
 *   namespace TEXT NOT NULL, id TEXT NOT NULL,
 *   total DOUBLE PRECISION NOT NULL, count INTEGER NOT NULL,
 *   PRIMARY KEY (namespace, id)
 * );
 * CREATE TABLE af_index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 * ```
 *
 * Every table and column name above is an OPTION with that value as its
 * default, so this drops into a schema that already has naming conventions —
 * see {@link PgVectorStoreOptions}. Identifiers are validated and quoted; a
 * name that is not a plain SQL identifier is refused rather than interpolated.
 *
 * ── Cosine, and only cosine ─────────────────────────────────────────────────
 * `search` is `1 - (embedding <=> $query::vector)` — pgvector's cosine
 * DISTANCE, converted to the cosine SIMILARITY the port reports and
 * `defineRAG`'s 0.7 default is calibrated on. `<->` (L2) and `<#>` (inner
 * product) are deliberately not options: their ranges are not that range, and a
 * number that reads like a cosine and is not one is the failure mode the whole
 * fingerprint machinery exists to prevent. Build the HNSW index with
 * `vector_cosine_ops` so the operator and the index agree — with the wrong
 * operator class the query still returns the right answer, slowly, by scanning.
 *
 * ── One statement at a time, on purpose ─────────────────────────────────────
 * The client here is anything with `query()` — a `pg.Pool` is the expected one,
 * and a Pool hands each `query()` its own connection. `BEGIN` on one and the
 * next statement on another is a transaction that silently is not one, so this
 * adapter never writes multi-statement transactions. Everything that must be
 * atomic is ONE statement: `putMany` is one multi-row upsert, `putIfVersion` is
 * one conditional upsert, `forget` is one statement with CTEs across all four
 * tables. That is a constraint that made the code better.
 *
 * ── Lazy peer dependency ────────────────────────────────────────────────────
 * `pg` is an OPTIONAL peer dependency, required at construction time. Importing
 * `agentfootprint/memory` costs nothing for consumers who never build one of
 * these. Pass `client` to reuse the pool your app already has — which is the
 * recommended shape, because a second pool to the same database is a second set
 * of connections nobody counted.
 */

import { identityNamespace } from '../../memory/identity/index.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import {
  EmbedderMismatchError,
  fingerprintConflict,
  fingerprintText,
  parseFingerprint,
  type Fingerprint,
} from '../../lib/embedderMismatch.js';
import type { MemoryIdentity } from '../../memory/identity/index.js';
import type { MemoryEntry } from '../../memory/entry/index.js';
import type {
  ListOptions,
  ListResult,
  MemoryStore,
  PutIfVersionResult,
  ScoredEntry,
  SearchOptions,
} from '../../memory/store/types.js';

// ─── The little bit of `pg` this adapter uses ────────────────────────

/** One result set, as this adapter reads it. */
export interface PgQueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

/**
 * The slice of a `pg` client this adapter calls.
 *
 * Structural, so a `Pool`, a `Client`, a pgBouncer-fronted wrapper or a test
 * double all satisfy it without this package taking a hard type dependency on
 * the optional peer.
 */
export interface PgLikeClient {
  query(text: string, params?: readonly unknown[]): Promise<PgQueryResult>;
  /** Optional — awaited by {@link PgVectorStore.close} when this store built the pool. */
  end?(): Promise<void>;
}

/** The one constructor this adapter needs out of `pg`. */
export interface PgSdkModule {
  readonly Pool?: new (config: { connectionString?: string }) => PgLikeClient;
}

// ─── Options ─────────────────────────────────────────────────────────

/**
 * Column names, so this store fits a schema that already has conventions.
 * Every one defaults to the name in the `CREATE TABLE` above.
 */
export interface PgVectorColumns {
  readonly namespace?: string;
  readonly id?: string;
  readonly value?: string;
  readonly metadata?: string;
  readonly embedding?: string;
  readonly embedderFp?: string;
  readonly version?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly lastAccessedAt?: string;
  readonly accessCount?: string;
  readonly ttl?: string;
  readonly tier?: string;
  readonly source?: string;
  readonly embeddingModel?: string;
}

export interface PgVectorStoreOptions {
  /**
   * Postgres connection string, used only when this store builds its own pool.
   * Prefer `client` — a second pool to one database is a second set of
   * connections nobody counted.
   */
  readonly connectionString?: string;
  /** A pre-built `pg.Pool` (or anything with `query`). Recommended. */
  readonly client?: PgLikeClient;
  /** Schema the tables live in. Default `'public'`. */
  readonly schema?: string;
  /** The vectors table. Default `'af_vectors'`. */
  readonly table?: string;
  /** The recognition-set table (`seen`/`recordSignature`). Default `'af_signatures'`. */
  readonly signaturesTable?: string;
  /** The usefulness-aggregate table. Default `'af_feedback'`. */
  readonly feedbackTable?: string;
  /** The key/value table holding one embedder fingerprint per namespace. Default `'af_index_meta'`. */
  readonly metaTable?: string;
  /** Column names inside {@link table}. Each defaults to the documented one. */
  readonly columns?: PgVectorColumns;
  /**
   * Rows per multi-row upsert. Default 500.
   *
   * Postgres caps a statement at 65,535 bound parameters and this store binds
   * 15 per row, so 500 leaves an order of magnitude of headroom. Raising it
   * trades round-trips for a statement that fails all-or-nothing on a bigger
   * unit.
   */
  readonly batchSize?: number;
  /** @internal Test injection — skips the `pg` require entirely. */
  readonly _client?: PgLikeClient;
  /** @internal Test injection — the `pg` module (exercises the real shim with a mock module). */
  readonly _pg?: PgSdkModule;
}

/** A Postgres-backed vector store, plus the two things it owns beyond the port. */
export interface PgVectorStore extends MemoryStore {
  /**
   * The embedder fingerprint (`'<id>@<dims>'`) a namespace was built with, or
   * `undefined` when nothing with a vector has been written to it yet.
   *
   * Read this before an embedder swap: it is the fact `EmbedderMismatchError`
   * refuses on, available up front instead of at the first failed write.
   */
  fingerprintOf(identity: MemoryIdentity): Promise<string | undefined>;
  /**
   * Release the pool, if this store built one. Idempotent. A client you passed
   * in is yours and is left alone.
   */
  close(): Promise<void>;
}

/**
 * Raised when the database is reachable but its schema is not this store's.
 *
 * The law `sqliteVectorStore` states for a file, one backend over: **an
 * unreadable index and an empty one are different facts, and only one of them
 * is safe to answer with "no matches".** A store that treated a missing table
 * as an empty corpus would answer every question from the model's own weights
 * and log nothing.
 */
export class PgVectorSchemaError extends Error {
  readonly code = 'ERR_PGVECTOR_SCHEMA' as const;
  /** The schema-qualified table that could not be used. */
  readonly table: string;
  /** Columns this store needs and did not find. Empty when the table is absent entirely. */
  readonly missingColumns: readonly string[];

  constructor(table: string, missingColumns: readonly string[], detail: string) {
    super(
      `[memory] the pgVectorStore table ${table} cannot be used: ${detail}\n` +
        `  A missing table and an empty corpus are different facts, and only one of them is ` +
        `safe to answer with "no matches" — so this refuses rather than quietly answering ` +
        `every question from the model alone.\n` +
        `  Fix:  run the CREATE TABLE from the pgVectorStore docs (it also needs ` +
        `CREATE EXTENSION vector), or point \`table\`/\`columns\` at the schema you have.`,
    );
    this.name = 'PgVectorSchemaError';
    this.table = table;
    this.missingColumns = missingColumns;
  }
}

const DEFAULT_COLUMNS: Required<PgVectorColumns> = {
  namespace: 'namespace',
  id: 'id',
  value: 'value',
  metadata: 'metadata',
  embedding: 'embedding',
  embedderFp: 'embedder_fp',
  version: 'version',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  lastAccessedAt: 'last_accessed_at',
  accessCount: 'access_count',
  ttl: 'ttl',
  tier: 'tier',
  source: 'source',
  embeddingModel: 'embedding_model',
};

/**
 * Open a `MemoryStore` over an existing Postgres + pgvector table.
 *
 * @throws when `pg` is absent and no `client` was passed.
 * @throws PgVectorSchemaError on the first call, when the table or a column it
 *         needs is not there.
 * @throws EmbedderMismatchError from `put`/`putMany`/`search` when a vector
 *         meets a namespace built by a different embedder.
 *
 * @example  A corpus beside the application's own data
 * ```ts
 * import { Pool } from 'pg';
 * import { defineRAG, indexDocuments } from 'agentfootprint';
 * import { pgVectorStore } from 'agentfootprint/memory';
 * import { openaiEmbedder } from 'agentfootprint/providers';
 *
 * const store = pgVectorStore({ client: new Pool({ connectionString: process.env.DATABASE_URL }) });
 * const embedder = openaiEmbedder();
 *
 * await indexDocuments(store, embedder, docs, { embedderId: embedder.id });
 *
 * const agent = Agent.create({ provider })
 *   .rag(defineRAG({ id: 'docs', store, embedder, embedderId: embedder.id }))
 *   .build();
 * ```
 */
export function pgVectorStore(options: PgVectorStoreOptions = {}): PgVectorStore {
  const schema = ident(options.schema ?? 'public', 'schema');
  const vectorsTable = qualified(schema, ident(options.table ?? 'af_vectors', 'table'));
  const signaturesTable = qualified(
    schema,
    ident(options.signaturesTable ?? 'af_signatures', 'signaturesTable'),
  );
  const feedbackTable = qualified(
    schema,
    ident(options.feedbackTable ?? 'af_feedback', 'feedbackTable'),
  );
  const metaTable = qualified(schema, ident(options.metaTable ?? 'af_index_meta', 'metaTable'));
  const rawTableName = options.table ?? 'af_vectors';
  const rawSchemaName = options.schema ?? 'public';

  const col = resolveColumns(options.columns);
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 500));

  /** The 15 columns a row is written with and read back through, in one order. */
  const WRITE_COLUMNS = [
    col.namespace,
    col.id,
    col.value,
    col.metadata,
    col.embedding,
    col.embedderFp,
    col.version,
    col.createdAt,
    col.updatedAt,
    col.lastAccessedAt,
    col.accessCount,
    col.ttl,
    col.tier,
    col.source,
    col.embeddingModel,
  ] as const;

  const READ_COLUMNS = [
    col.id,
    col.value,
    col.metadata,
    col.version,
    col.createdAt,
    col.updatedAt,
    col.lastAccessedAt,
    col.accessCount,
    col.ttl,
    col.tier,
    col.source,
    col.embeddingModel,
  ]
    .map(quote)
    .join(', ');

  let owned = false;
  let client: PgLikeClient | undefined;
  const connect = (): PgLikeClient => {
    if (client) return client;
    if (options._client) {
      client = options._client;
      return client;
    }
    if (options.client) {
      client = options.client;
      return client;
    }
    const pg = options._pg ?? loadPg();
    if (typeof pg.Pool !== 'function') {
      throw new Error(
        'pgVectorStore: `pg` is installed but `Pool` was not found. Update the driver, or ' +
          'pass `client` with a pre-built pool.',
      );
    }
    if (!options.connectionString) {
      throw new Error(
        'pgVectorStore: pass `client` (recommended — reuse the pool your app already has) ' +
          'or `connectionString` for this store to build one.',
      );
    }
    client = new pg.Pool({ connectionString: options.connectionString });
    owned = true;
    return client;
  };

  let closed = false;
  const open = (verb: string): void => {
    if (closed) {
      throw new Error(
        `[memory] the pgVectorStore for ${vectorsTable} is closed, so it cannot ${verb}. ` +
          `close() is final by design — reopening the pool behind you would hide a ` +
          `shutdown-ordering bug rather than surface it. Build a new store if you need one ` +
          `after closing this.`,
      );
    }
  };

  /**
   * Verify the schema ONCE, on the first call, and refuse by name.
   *
   * Not at construction: building a store must not require a live connection
   * (a module that connects on import is a module that fails at import). Not on
   * every call either — the answer cannot change under a running process
   * without a migration, and paying an `information_schema` read per retrieval
   * would be a tax on the hot path for a fact checked at boot.
   */
  let verified: Promise<void> | undefined;
  const ensureSchema = (): Promise<void> => {
    return (verified ??= (async () => {
      const db = connect();
      const result = await db.query(
        `SELECT column_name FROM information_schema.columns ` +
          `WHERE table_schema = $1 AND table_name = $2`,
        [rawSchemaName, rawTableName],
      );
      const found = new Set(result.rows.map((r) => String(r['column_name'])));
      if (found.size === 0) {
        throw new PgVectorSchemaError(
          vectorsTable,
          [],
          `no such table (looked in schema '${rawSchemaName}').`,
        );
      }
      const missing = WRITE_COLUMNS.filter((name) => !found.has(name));
      if (missing.length > 0) {
        throw new PgVectorSchemaError(
          vectorsTable,
          missing,
          `it exists but is missing ${missing.join(', ')} — this is a table of that name ` +
            `belonging to something else, or a schema from a different release.`,
        );
      }
    })());
  };

  const query = async (
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]> => {
    await ensureSchema();
    const result = await connect().query(text, params);
    return result.rows ?? [];
  };

  // ── Fingerprints ──────────────────────────────────────────────────
  const fingerprints = new Map<string, string>();

  const readFingerprint = async (ns: string): Promise<string | undefined> => {
    const held = fingerprints.get(ns);
    if (held !== undefined) return held;
    const rows = await query(`SELECT "value" FROM ${metaTable} WHERE "key" = $1`, [`fp:${ns}`]);
    const value = rows[0]?.['value'];
    if (typeof value !== 'string') return undefined;
    fingerprints.set(ns, value);
    return value;
  };

  const recordFingerprint = async (ns: string, fp: string): Promise<void> => {
    await query(
      `INSERT INTO ${metaTable} ("key", "value") VALUES ($1, $2) ` +
        `ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`,
      [`fp:${ns}`, fp],
    );
    fingerprints.set(ns, fp);
  };

  /** The `sqliteVectorStore` rule, one backend over: dimensions always decide. */
  const reconcile = async (
    ns: string,
    incoming: Fingerprint,
    operation: 'write to' | 'search',
  ): Promise<void> => {
    const storedText = await readFingerprint(ns);
    if (storedText === undefined) {
      if (operation === 'write to') await recordFingerprint(ns, fingerprintText(incoming));
      return;
    }
    const stored = parseFingerprint(storedText);
    const conflict = fingerprintConflict(stored, incoming);
    if (conflict !== null) {
      throw new EmbedderMismatchError(
        ns,
        storedText,
        fingerprintText(incoming),
        conflict,
        operation,
        'point this store at a different table',
      );
    }
    if (operation === 'write to' && stored.id === undefined && incoming.id !== undefined) {
      await recordFingerprint(ns, fingerprintText(incoming));
    }
  };

  /** The 15 bound values one row is written with, in `WRITE_COLUMNS` order. */
  const rowValues = (ns: string, entry: MemoryEntry<unknown>): unknown[] => {
    const embedding = entry.embedding;
    const fp =
      embedding && embedding.length > 0
        ? fingerprintText({
            ...(entry.embeddingModel !== undefined && { id: entry.embeddingModel }),
            dims: embedding.length,
          })
        : null;
    return [
      ns,
      entry.id,
      JSON.stringify(entry.value ?? null),
      entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
      // pgvector reads its own literal form, `'[1,2,3]'`, cast to `vector`.
      embedding && embedding.length > 0 ? `[${embedding.join(',')}]` : null,
      fp,
      entry.version,
      entry.createdAt,
      entry.updatedAt,
      entry.lastAccessedAt,
      entry.accessCount,
      entry.ttl ?? null,
      entry.tier ?? null,
      entry.source === undefined ? null : JSON.stringify(entry.source),
      entry.embeddingModel ?? null,
    ];
  };

  /**
   * The SQL type of each bound value, in `WRITE_COLUMNS` order.
   *
   * Every parameter is cast EXPLICITLY rather than left to inference. In an
   * `INSERT … VALUES` Postgres can infer from the target column, but in the
   * `INSERT … SELECT` form `putIfVersion` needs it cannot, and an uncast
   * parameter arrives as text — which fails on the first integer column with
   * an error about a type nobody wrote. One list, both statements, no
   * inference to reason about.
   */
  const CASTS = [
    'text', // namespace
    'text', // id
    'jsonb', // value
    'jsonb', // metadata
    'vector', // embedding
    'text', // embedder_fp
    'int', // version
    'bigint', // created_at
    'bigint', // updated_at
    'bigint', // last_accessed_at
    'int', // access_count
    'bigint', // ttl
    'text', // tier
    'jsonb', // source
    'text', // embedding_model
  ] as const;

  /** `$1::text, $2::text, $3::jsonb, …` for one row, offset into the batch. */
  const rowParams = (offset: number): string =>
    CASTS.map((cast, i) => `$${offset + i + 1}::${cast}`).join(', ');

  const upsertSet = WRITE_COLUMNS.slice(2)
    .map((name) => `${quote(name)} = EXCLUDED.${quote(name)}`)
    .join(', ');
  const insertColumns = WRITE_COLUMNS.map(quote).join(', ');
  const conflictTarget = `(${quote(col.namespace)}, ${quote(col.id)})`;

  const store: PgVectorStore = {
    // Vectors in, ranked vectors out — `ORDER BY embedding <=> $query` ranks
    // the embeddings this store was handed.
    supportsVectorSearch: true,
    ranksBy: 'vector',

    async fingerprintOf(identity: MemoryIdentity): Promise<string | undefined> {
      open('report a fingerprint');
      return readFingerprint(identityNamespace(identity));
    },

    async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
      open('read an entry');
      const ns = identityNamespace(identity);
      const rows = await query(
        `SELECT ${READ_COLUMNS} FROM ${vectorsTable} ` +
          `WHERE ${quote(col.namespace)} = $1 AND ${quote(col.id)} = $2`,
        [ns, id],
      );
      const row = rows[0];
      if (row === undefined) return null;
      const entry = rowToEntry<T>(row, col);
      if (entry.ttl !== undefined && entry.ttl <= Date.now()) return null;
      // Decay signals, the same side effect the port documents for `get`.
      await query(
        `UPDATE ${vectorsTable} SET ${quote(col.lastAccessedAt)} = $1, ` +
          `${quote(col.accessCount)} = ${quote(col.accessCount)} + 1 ` +
          `WHERE ${quote(col.namespace)} = $2 AND ${quote(col.id)} = $3`,
        [Date.now(), ns, id],
      );
      return entry;
    },

    async put<T = unknown>(identity: MemoryIdentity, entry: MemoryEntry<T>): Promise<void> {
      await this.putMany(identity, [entry]);
    },

    async putMany<T = unknown>(
      identity: MemoryIdentity,
      entries: readonly MemoryEntry<T>[],
    ): Promise<void> {
      open('write entries');
      // The port requires an empty batch to be a no-op — callers rely on it to
      // skip a round-trip on a turn that produced nothing.
      if (entries.length === 0) return;
      const ns = identityNamespace(identity);

      for (const entry of entries) {
        const embedding = entry.embedding;
        if (embedding && embedding.length > 0) {
          await reconcile(
            ns,
            {
              ...(entry.embeddingModel !== undefined && { id: entry.embeddingModel }),
              dims: embedding.length,
            },
            'write to',
          );
        }
      }

      // ONE multi-row upsert per chunk — the statement the port's own docstring
      // has named for this backend since 2.x. One statement is one implicit
      // transaction, so a chunk lands whole or not at all: a HALF-INDEXED
      // corpus keeps answering and quietly cannot see what did not land.
      for (let i = 0; i < entries.length; i += batchSize) {
        const chunk = entries.slice(i, i + batchSize);
        const params: unknown[] = [];
        const tuples: string[] = [];
        for (const entry of chunk) {
          tuples.push(`(${rowParams(params.length)})`);
          params.push(...rowValues(ns, entry));
        }
        await query(
          `INSERT INTO ${vectorsTable} (${insertColumns}) VALUES ${tuples.join(', ')} ` +
            `ON CONFLICT ${conflictTarget} DO UPDATE SET ${upsertSet}`,
          params,
        );
      }
    },

    async putIfVersion<T = unknown>(
      identity: MemoryIdentity,
      entry: MemoryEntry<T>,
      expectedVersion: number,
    ): Promise<PutIfVersionResult> {
      open('write an entry');
      const ns = identityNamespace(identity);
      const embedding = entry.embedding;
      if (embedding && embedding.length > 0) {
        await reconcile(
          ns,
          {
            ...(entry.embeddingModel !== undefined && { id: entry.embeddingModel }),
            dims: embedding.length,
          },
          'write to',
        );
      }

      // ONE statement, so the check and the write cannot be separated by
      // another writer — which is the entire point of a compare-and-set, and
      // is why this is not a SELECT followed by an UPDATE (a Pool would happily
      // run those two on different connections).
      //
      // The `WHERE` on the source SELECT is what makes the absent-row case
      // correct: with `expectedVersion !== 0` and no existing row, no source
      // row is produced, nothing is inserted, and nothing comes back. With a
      // row present, the source row IS produced, the conflict fires, and the
      // `DO UPDATE … WHERE version = expected` decides.
      const params = rowValues(ns, entry);
      const expectedParam = `$${params.length + 1}`;
      params.push(expectedVersion);
      const rows = await query(
        `INSERT INTO ${vectorsTable} AS af_target (${insertColumns}) ` +
          `SELECT ${rowParams(0)} ` +
          `WHERE ${expectedParam}::int = 0 OR EXISTS (SELECT 1 FROM ${vectorsTable} AS af_probe ` +
          `WHERE af_probe.${quote(col.namespace)} = $1 AND af_probe.${quote(col.id)} = $2) ` +
          `ON CONFLICT ${conflictTarget} DO UPDATE SET ${upsertSet} ` +
          `WHERE af_target.${quote(col.version)} = ${expectedParam}::int ` +
          `RETURNING af_target.${quote(col.version)}`,
        params,
      );
      if (rows.length > 0) return { applied: true };

      // Advisory, and read AFTER the failed attempt rather than inside it:
      // the port describes `currentVersion` as what the caller decides a retry
      // against, not as a value it may assume is still current.
      const current = await query(
        `SELECT ${quote(col.version)} FROM ${vectorsTable} ` +
          `WHERE ${quote(col.namespace)} = $1 AND ${quote(col.id)} = $2`,
        [ns, entry.id],
      );
      const version = current[0]?.[col.version];
      return version === undefined || version === null
        ? { applied: false }
        : { applied: false, currentVersion: num(version) };
    },

    async list<T = unknown>(
      identity: MemoryIdentity,
      listOptions?: ListOptions,
    ): Promise<ListResult<T>> {
      open('list entries');
      const ns = identityNamespace(identity);
      const limit = Math.max(1, Math.floor(listOptions?.limit ?? 100));
      const after = listOptions?.cursor ?? '';
      // Keyset pagination on the primary key: stable under concurrent writes,
      // unlike OFFSET, and the cursor is the last id rather than a position.
      const rows = await query(
        `SELECT ${READ_COLUMNS} FROM ${vectorsTable} ` +
          `WHERE ${quote(col.namespace)} = $1 AND ${quote(col.id)} > $2 ` +
          `ORDER BY ${quote(col.id)} LIMIT $3`,
        [ns, after, limit + 1],
      );

      const tierFilter = listOptions?.tiers ? new Set(listOptions.tiers) : undefined;
      const page: MemoryEntry<T>[] = [];
      let cursor: string | undefined;
      for (const row of rows) {
        if (page.length === limit) {
          // The extra row only ever exists to prove there IS a next page.
          cursor = page[page.length - 1]?.id;
          break;
        }
        const entry = rowToEntry<T>(row, col);
        if (entry.ttl !== undefined && entry.ttl <= Date.now()) continue;
        if (tierFilter && (entry.tier === undefined || !tierFilter.has(entry.tier))) continue;
        page.push(entry);
      }
      return { entries: page, ...(cursor !== undefined && { cursor }) };
    },

    async delete(identity: MemoryIdentity, id: string): Promise<void> {
      open('delete an entry');
      await query(
        `DELETE FROM ${vectorsTable} WHERE ${quote(col.namespace)} = $1 AND ${quote(col.id)} = $2`,
        [identityNamespace(identity), id],
      );
    },

    async seen(identity: MemoryIdentity, signature: string): Promise<boolean> {
      open('check a signature');
      const rows = await query(
        `SELECT 1 FROM ${signaturesTable} WHERE "namespace" = $1 AND "signature" = $2`,
        [identityNamespace(identity), signature],
      );
      return rows.length > 0;
    },

    async recordSignature(identity: MemoryIdentity, signature: string): Promise<void> {
      open('record a signature');
      await query(
        `INSERT INTO ${signaturesTable} ("namespace", "signature") VALUES ($1, $2) ` +
          `ON CONFLICT ("namespace", "signature") DO NOTHING`,
        [identityNamespace(identity), signature],
      );
    },

    async feedback(identity: MemoryIdentity, id: string, usefulness: number): Promise<void> {
      open('record feedback');
      // Non-finite values poison the aggregate; the port says adapters must
      // reject them, and clamp the rest.
      if (!Number.isFinite(usefulness)) return;
      const clamped = Math.max(-1, Math.min(1, usefulness));
      await query(
        `INSERT INTO ${feedbackTable} AS af_fb ("namespace", "id", "total", "count") ` +
          `VALUES ($1::text, $2::text, $3::double precision, 1) ` +
          `ON CONFLICT ("namespace", "id") DO UPDATE SET ` +
          `"total" = af_fb."total" + EXCLUDED."total", "count" = af_fb."count" + 1`,
        [identityNamespace(identity), id, clamped],
      );
    },

    async getFeedback(
      identity: MemoryIdentity,
      id: string,
    ): Promise<{ average: number; count: number } | null> {
      open('read feedback');
      const rows = await query(
        `SELECT "total", "count" FROM ${feedbackTable} WHERE "namespace" = $1 AND "id" = $2`,
        [identityNamespace(identity), id],
      );
      const row = rows[0];
      const count = row === undefined ? 0 : num(row['count']);
      if (count === 0) return null;
      return { average: num(row?.['total']) / count, count };
    },

    async forget(identity: MemoryIdentity): Promise<void> {
      open('forget a namespace');
      const ns = identityNamespace(identity);
      // ONE statement across all four tables. A GDPR erasure that removed the
      // vectors and left the signatures behind would be a deletion that is not
      // one, and a Pool cannot be trusted to keep four statements on one
      // connection — so they are one statement, and therefore one transaction.
      await query(
        `WITH cleared_vectors AS (DELETE FROM ${vectorsTable} WHERE ${quote(
          col.namespace,
        )} = $1), ` +
          `cleared_signatures AS (DELETE FROM ${signaturesTable} WHERE "namespace" = $1), ` +
          `cleared_feedback AS (DELETE FROM ${feedbackTable} WHERE "namespace" = $1) ` +
          `DELETE FROM ${metaTable} WHERE "key" = $2`,
        [ns, `fp:${ns}`],
      );
      fingerprints.delete(ns);
    },

    async search<T = unknown>(
      identity: MemoryIdentity,
      queryVector: readonly number[],
      searchOptions?: SearchOptions,
    ): Promise<readonly ScoredEntry<T>[]> {
      open('search');
      const ns = identityNamespace(identity);
      const k = Math.max(1, Math.floor(searchOptions?.k ?? 10));
      if (queryVector.length === 0) return [];
      // pgvector's cosine distance is undefined for a zero vector (it divides
      // by the norm) and comes back as NaN, which sorts unpredictably. An
      // unscoreable query is empty rather than arbitrary.
      if (queryVector.every((v) => v === 0)) return [];

      // Refused BEFORE the scan, on both halves of the fingerprint. A swapped
      // embedder must not score against the old vectors — the numbers come
      // back in the same range as real ones and no threshold separates them.
      await reconcile(
        ns,
        {
          ...(searchOptions?.embedderId !== undefined && { id: searchOptions.embedderId }),
          dims: queryVector.length,
        },
        'search',
      );

      const params: unknown[] = [ns, `[${queryVector.join(',')}]`];
      const where: string[] = [
        `${quote(col.namespace)} = $1`,
        `${quote(col.embedding)} IS NOT NULL`,
        `(${quote(col.ttl)} IS NULL OR ${quote(col.ttl)} > ${bind(params, Date.now())})`,
      ];
      const tiers = searchOptions?.tiers;
      if (tiers && tiers.length > 0) {
        where.push(`${quote(col.tier)} = ANY(${bind(params, [...tiers])}::text[])`);
      }
      if (searchOptions?.embedderId !== undefined) {
        // A row that never named its embedder is not evidence of a different
        // one — the same asymmetry the fingerprint rule uses.
        const p = bind(params, searchOptions.embedderId);
        where.push(`(${quote(col.embeddingModel)} IS NULL OR ${quote(col.embeddingModel)} = ${p})`);
      }
      if (searchOptions?.minScore !== undefined) {
        const p = bind(params, searchOptions.minScore);
        where.push(`1 - (${quote(col.embedding)} <=> $2::vector) >= ${p}`);
      }
      const limitParam = bind(params, k);

      // The query the port's docstring has named for this backend since 2.x —
      // `ORDER BY embedding <=> query LIMIT k` — with the distance turned into
      // the cosine SIMILARITY the port reports.
      const rows = await query(
        `SELECT ${READ_COLUMNS}, 1 - (${quote(col.embedding)} <=> $2::vector) AS af_score ` +
          `FROM ${vectorsTable} WHERE ${where.join(' AND ')} ` +
          `ORDER BY ${quote(col.embedding)} <=> $2::vector, ${quote(col.id)} ` +
          `LIMIT ${limitParam}`,
        params,
      );

      return rows.map((row) => ({
        entry: rowToEntry<T>(row, col),
        score: num(row['af_score']),
      }));
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (owned) await client?.end?.();
    },
  };

  return store;
}

// ─── Identifiers ─────────────────────────────────────────────────────

/**
 * Validate a caller-supplied identifier, or refuse it.
 *
 * Table and column names are the one part of a query that cannot be a bound
 * parameter — they are interpolated into the SQL text. So they are checked
 * against a plain-identifier shape and refused otherwise, rather than escaped
 * and hoped for. A store configured from an environment variable is one
 * `DB_TABLE` away from being an injection point, and "we quoted it" is not the
 * answer that lets you stop thinking about it.
 */
function ident(name: string, option: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new TypeError(
      `pgVectorStore: \`${option}\` must be a plain SQL identifier — letters, digits and ` +
        `underscores, not starting with a digit. Received ${JSON.stringify(name)}.\n` +
        `  Table and column names cannot be bound parameters; they are interpolated into the ` +
        `statement, so anything else is refused rather than escaped and hoped for.`,
    );
  }
  return name;
}

function quote(name: string): string {
  return `"${name}"`;
}

function qualified(schema: string, table: string): string {
  return `${quote(schema)}.${quote(table)}`;
}

function resolveColumns(overrides?: PgVectorColumns): Required<PgVectorColumns> {
  const out = { ...DEFAULT_COLUMNS };
  for (const key of Object.keys(DEFAULT_COLUMNS) as (keyof PgVectorColumns)[]) {
    const value = overrides?.[key];
    if (value !== undefined) out[key] = ident(value, `columns.${key}`);
  }
  return out;
}

/** Append a value to the parameter list and return its `$n` placeholder. */
function bind(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

// ─── Row mapping ─────────────────────────────────────────────────────

/**
 * `BIGINT` comes back from `pg` as a STRING by default (it does not fit in a
 * JavaScript number in general), and every timestamp here is one. Coerced in
 * one place, so a `createdAt` never reaches a consumer as `'1754640000000'`.
 */
function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** `JSONB` arrives already parsed from `pg`; a mock or a `TEXT` column may not. */
function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function rowToEntry<T>(
  row: Record<string, unknown>,
  col: Required<PgVectorColumns>,
): MemoryEntry<T> {
  const metadata = row[col.metadata];
  const source = row[col.source];
  const ttl = row[col.ttl];
  const tier = row[col.tier];
  const model = row[col.embeddingModel];
  return {
    id: String(row[col.id]),
    value: json(row[col.value]) as T,
    ...(metadata !== null &&
      metadata !== undefined && { metadata: json(metadata) as Record<string, unknown> }),
    version: num(row[col.version]),
    createdAt: num(row[col.createdAt]),
    updatedAt: num(row[col.updatedAt]),
    lastAccessedAt: num(row[col.lastAccessedAt]),
    accessCount: num(row[col.accessCount]),
    ...(ttl !== null && ttl !== undefined && { ttl: num(ttl) }),
    ...(typeof tier === 'string' && { tier: tier as 'hot' | 'warm' | 'cold' }),
    ...(source !== null &&
      source !== undefined && { source: json(source) as MemoryEntry<T>['source'] }),
    ...(typeof model === 'string' && { embeddingModel: model }),
  };
}

// ─── Driver loading ──────────────────────────────────────────────────

function loadPg(): PgSdkModule {
  try {
    return lazyRequire<PgSdkModule>('pg');
  } catch {
    throw new Error(
      'pgVectorStore requires the `pg` peer dependency.\n' +
        '  Install:  npm install pg\n' +
        '  And in the database:  CREATE EXTENSION IF NOT EXISTS vector;\n' +
        '  Or pass `client` with a pre-built pool — recommended, so one pool serves the ' +
        'whole app.',
    );
  }
}

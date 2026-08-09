/**
 * pgVectorStore (9.3.0) — the backend our own port has named since 2.x.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 *
 * Every test here injects a client. NOTHING in this file starts a database,
 * needs a connection string, or installs `pg` — `_client` takes anything with
 * `query()`, which is the whole surface this adapter uses, so a double sees
 * exactly the SQL that would have reached Postgres.
 *
 * What this file exists to pin:
 *
 *   1. **The two statements the port's docstring promised.** `putMany` is ONE
 *      multi-row `INSERT … ON CONFLICT DO UPDATE`; `search` is
 *      `ORDER BY embedding <=> query LIMIT k`. Those sentences were in
 *      `MemoryStore`'s own documentation before any adapter made them true.
 *   2. Nothing is ever two statements pretending to be a transaction — a Pool
 *      hands each `query()` its own connection, so `putIfVersion` and `forget`
 *      are single statements or they are lies.
 *   3. A missing table is REFUSED, never read as an empty corpus.
 *   4. Table and column names are validated identifiers, not interpolated text.
 */

import { describe, expect, it } from 'vitest';

import {
  pgVectorStore,
  PgVectorSchemaError,
  EmbedderMismatchError,
} from '../../../src/memory-providers.js';
import { indexDocuments } from '../../../src/index.js';
import { mockEmbedder } from '../../../src/memory/index.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import { identityNamespace } from '../../../src/memory/identity/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

const CORPUS: MemoryIdentity = { conversationId: '_global' };
const NS = identityNamespace(CORPUS);

/** The 15 columns the schema check must find, in the documented spelling. */
const COLUMNS = [
  'namespace',
  'id',
  'value',
  'metadata',
  'embedding',
  'embedder_fp',
  'version',
  'created_at',
  'updated_at',
  'last_accessed_at',
  'access_count',
  'ttl',
  'tier',
  'source',
  'embedding_model',
];

interface Statement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * A Postgres double.
 *
 * `answer` decides what a statement returns, matched on a substring of the SQL
 * — which keeps a test's setup about the QUERY it is answering rather than
 * about call ordering.
 */
function fakePg(
  answer: (sql: string, params: readonly unknown[]) => unknown[] | undefined = () => undefined,
) {
  const statements: Statement[] = [];
  return {
    statements,
    /** Every statement, joined — for asserting a thing happened exactly once. */
    sqlFor: (fragment: string): Statement[] => statements.filter((s) => s.sql.includes(fragment)),
    client: {
      query: async (sql: string, params?: readonly unknown[]) => {
        statements.push({ sql, params: params ?? [] });
        // The schema probe: answer with the documented columns unless a test
        // says otherwise.
        if (sql.includes('information_schema.columns')) {
          const rows = answer(sql, params ?? []);
          return { rows: rows ?? COLUMNS.map((column_name) => ({ column_name })) };
        }
        return { rows: answer(sql, params ?? []) ?? [] };
      },
    },
  };
}

function open(answer?: (sql: string, params: readonly unknown[]) => unknown[] | undefined) {
  const pg = fakePg(answer);
  return { store: pgVectorStore({ _client: pg.client }), pg };
}

function entry(
  id: string,
  embedding: number[] | undefined,
  extra: Partial<MemoryEntry<unknown>> = {},
): MemoryEntry<unknown> {
  const now = Date.now();
  return {
    id,
    value: { id, content: `content of ${id}` },
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...(embedding && { embedding }),
    ...extra,
  } as MemoryEntry<unknown>;
}

/** A row as `pg` hands one back from the READ column list. */
function pgRow(id: string, score?: number) {
  return {
    id,
    value: JSON.stringify({ id, content: `content of ${id}` }),
    metadata: null,
    version: 1,
    created_at: '1754640000000', // BIGINT arrives as a STRING from `pg`
    updated_at: '1754640000000',
    last_accessed_at: '1754640000000',
    access_count: 0,
    ttl: null,
    tier: null,
    source: null,
    embedding_model: null,
    ...(score !== undefined && { af_score: score }),
  };
}

// ─── Unit — the two statements the port promised ───────────────────

describe('pgVectorStore — the statements MemoryStore named', () => {
  it('putMany is ONE multi-row upsert, not N inserts', async () => {
    const { store, pg } = open();
    await store.putMany(
      CORPUS,
      ['a', 'b', 'c'].map((id) => entry(id, [1, 0, 0, 0])),
    );
    const upserts = pg.sqlFor('INSERT INTO "public"."af_vectors"');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.sql).toMatch(/INSERT INTO "public"."af_vectors"/);
    expect(upserts[0]?.sql).toMatch(/DO UPDATE SET/);
    // 15 bound values per row, three rows, one statement.
    expect(upserts[0]?.params).toHaveLength(45);
  });

  it('search is ORDER BY embedding <=> query LIMIT k, with the cosine SIMILARITY selected', async () => {
    const { store, pg } = open((sql) =>
      sql.includes('af_score') ? [pgRow('a', 0.91), pgRow('b', 0.4)] : undefined,
    );
    const hits = await store.search(CORPUS, [1, 0, 0, 0], { k: 2 });
    const search = pg.sqlFor('af_score')[0];
    expect(search?.sql).toMatch(/ORDER BY "embedding" <=> \$2::vector/);
    expect(search?.sql).toMatch(/1 - \("embedding" <=> \$2::vector\) AS af_score/);
    expect(search?.sql).toMatch(/LIMIT \$/);
    // pgvector reads its own literal form for the query vector.
    expect(search?.params[1]).toBe('[1,0,0,0]');
    expect(hits.map((h) => h.score)).toEqual([0.91, 0.4]);
    expect(hits[0]?.entry.id).toBe('a');
  });

  it('a BIGINT that arrives as a string is a number by the time a consumer sees it', async () => {
    const { store } = open((sql) =>
      sql.includes('FROM "public"."af_vectors"') ? [pgRow('a')] : undefined,
    );
    const found = await store.get(CORPUS, 'a');
    expect(found?.createdAt).toBe(1754640000000);
    expect(typeof found?.createdAt).toBe('number');
  });
});

// ─── Boundary — batches, pages and empty inputs ────────────────────

describe('pgVectorStore — boundary', () => {
  it('an empty batch is a no-op — not even a schema probe', async () => {
    const { store, pg } = open();
    await store.putMany(CORPUS, []);
    expect(pg.statements).toHaveLength(0);
  });

  it('a batch larger than batchSize becomes N statements, each whole', async () => {
    const pg = fakePg();
    const store = pgVectorStore({ _client: pg.client, batchSize: 2 });
    await store.putMany(
      CORPUS,
      ['a', 'b', 'c', 'd', 'e'].map((id) => entry(id, [1, 0, 0, 0])),
    );
    expect(pg.sqlFor('INSERT INTO "public"."af_vectors"')).toHaveLength(3);
  });

  it('an empty or all-zero query vector returns nothing rather than a NaN ranking', async () => {
    const { store, pg } = open();
    expect(await store.search(CORPUS, [])).toEqual([]);
    expect(await store.search(CORPUS, [0, 0, 0, 0])).toEqual([]);
    expect(pg.sqlFor('af_score')).toHaveLength(0);
  });

  it('list pages by KEYSET, and only returns a cursor when there is a next page', async () => {
    const rows = ['a', 'b', 'c'].map((id) => pgRow(id));
    const { store, pg } = open((sql) => (sql.includes('ORDER BY "id"') ? rows : undefined));
    const page = await store.list(CORPUS, { limit: 2 });
    expect(page.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(page.cursor).toBe('b');
    // limit + 1: the extra row exists only to prove there IS a next page.
    expect(pg.sqlFor('ORDER BY "id"')[0]?.params[2]).toBe(3);
  });
});

// ─── Scenario — schema verification and shutdown ───────────────────

describe('pgVectorStore — scenario', () => {
  it('verifies the schema ONCE, on the first call, and never again', async () => {
    const { store, pg } = open();
    await store.get(CORPUS, 'a');
    await store.get(CORPUS, 'b');
    await store.search(CORPUS, [1, 0, 0, 0]);
    expect(pg.sqlFor('information_schema.columns')).toHaveLength(1);
  });

  it('does not connect at construction — a module that connects on import fails at import', () => {
    // No `_client`, no `client`, no `pg` installed in this repo.
    expect(() => pgVectorStore({ connectionString: 'postgres://nowhere/db' })).not.toThrow();
  });

  it('builds its own pool from a connection string, and close() ends only what it built', async () => {
    const ended: string[] = [];
    const store = pgVectorStore({
      connectionString: 'postgres://localhost/app',
      _pg: {
        Pool: class {
          constructor(public config: { connectionString?: string }) {}
          async query(): Promise<{ rows: Record<string, unknown>[] }> {
            return { rows: COLUMNS.map((column_name) => ({ column_name })) };
          }
          async end(): Promise<void> {
            ended.push('own');
          }
        },
      },
    });
    await store.get(CORPUS, 'a');
    await store.close();
    expect(ended).toEqual(['own']);
  });

  it('a pool you passed in is yours — close() leaves it open', async () => {
    const ended: string[] = [];
    const pg = fakePg();
    const store = pgVectorStore({
      client: {
        ...pg.client,
        end: async () => {
          ended.push('yours');
        },
      },
    });
    await store.get(CORPUS, 'a');
    await store.close();
    expect(ended).toEqual([]);
  });

  it('forget erases all four tables in ONE statement', async () => {
    const { store, pg } = open();
    await store.forget(CORPUS);
    const deletes = pg.statements.filter((s) => s.sql.includes('DELETE FROM'));
    expect(deletes).toHaveLength(1);
    // A Pool cannot be trusted to keep four statements on one connection, so
    // the erasure is one statement with CTEs — or it is not an erasure.
    expect(deletes[0]?.sql).toMatch(/WITH cleared_vectors AS/);
    expect(deletes[0]?.sql).toMatch(/cleared_signatures/);
    expect(deletes[0]?.sql).toMatch(/cleared_feedback/);
  });

  it('putIfVersion is ONE conditional statement, never a SELECT then an UPDATE', async () => {
    const { store, pg } = open((sql) => (sql.includes('RETURNING') ? [{ version: 2 }] : undefined));
    const result = await store.putIfVersion!(CORPUS, entry('a', [1, 0, 0, 0]), 1);
    expect(result.applied).toBe(true);
    const conditional = pg.sqlFor('RETURNING');
    expect(conditional).toHaveLength(1);
    expect(conditional[0]?.sql).toMatch(/WHERE af_target\."version" = \$\d+::int/);
  });
});

// ─── Property — declarations and column overrides ──────────────────

describe('pgVectorStore — property', () => {
  it('declares that it ranks the vectors it is given, both ways', () => {
    const { store } = open();
    expect(store.supportsVectorSearch).toBe(true);
    expect(store.ranksBy).toBe('vector');
  });

  it('every table and column name is an option, so it fits a schema with conventions', async () => {
    const pg = fakePg(() =>
      [{ column_name: 'ns' }, { column_name: 'doc_id' }].concat(
        COLUMNS.slice(2).map((column_name) => ({ column_name })),
      ),
    );
    const store = pgVectorStore({
      _client: pg.client,
      schema: 'rag',
      table: 'passages',
      columns: { namespace: 'ns', id: 'doc_id' },
    });
    await store.put(CORPUS, entry('a', [1, 0, 0, 0]));
    const upsert = pg.sqlFor('INSERT INTO "rag"."passages"')[0];
    expect(upsert?.sql).toMatch(/"ns", "doc_id"/);
  });

  it('an embedderId filter admits rows that never named their embedder', async () => {
    // The same asymmetry the fingerprint rule uses: an anonymous row is not
    // evidence of a DIFFERENT embedder.
    const { store, pg } = open((sql) => (sql.includes('af_score') ? [] : undefined));
    await store.search(CORPUS, [1, 0, 0, 0], { embedderId: 'mock' });
    expect(pg.sqlFor('af_score')[0]?.sql).toMatch(
      /"embedding_model" IS NULL OR "embedding_model" = \$/,
    );
  });
});

// ─── Security — identifiers are not interpolated text ──────────────

describe('pgVectorStore — security', () => {
  it('refuses a table name that is not a plain identifier rather than escaping it', () => {
    expect(() => pgVectorStore({ table: 'af_vectors; DROP TABLE users' })).toThrow(TypeError);
    expect(() => pgVectorStore({ table: 'af"vectors' })).toThrow(/plain SQL identifier/);
    expect(() => pgVectorStore({ columns: { id: '1id' } })).toThrow(/columns.id/);
  });

  it('the identity is a BOUND parameter on every read, never part of the SQL text', async () => {
    const { store, pg } = open((sql) => (sql.includes('af_score') ? [] : undefined));
    await store.search({ conversationId: "bobby'; --" }, [1, 0, 0, 0]);
    const search = pg.sqlFor('af_score')[0];
    expect(search?.sql).not.toContain('bobby');
    expect(String(search?.params[0])).toContain("bobby'; --");
  });
});

// ─── Refusal — a missing table is not an empty corpus ──────────────

describe('pgVectorStore — refusal', () => {
  it('refuses a missing table rather than answering "no matches" against nothing', async () => {
    const { store } = open((sql) => (sql.includes('information_schema.columns') ? [] : undefined));
    await expect(store.search(CORPUS, [1, 0, 0, 0])).rejects.toBeInstanceOf(PgVectorSchemaError);
    await expect(store.search(CORPUS, [1, 0, 0, 0])).rejects.toThrow(/no such table/);
  });

  it('refuses a table of the right NAME belonging to something else, naming the columns', async () => {
    const { store } = open((sql) =>
      sql.includes('information_schema.columns')
        ? [{ column_name: 'namespace' }, { column_name: 'id' }]
        : undefined,
    );
    const error = await store.get(CORPUS, 'a').catch((e: unknown) => e as PgVectorSchemaError);
    expect(error).toBeInstanceOf(PgVectorSchemaError);
    expect((error as PgVectorSchemaError).missingColumns).toContain('embedding');
  });

  it('refuses a second embedding space at WRITE, from the fingerprint the table holds', async () => {
    const { store } = open((sql) =>
      sql.includes('SELECT "value" FROM') ? [{ value: 'first-embedder@4' }] : undefined,
    );
    await expect(
      store.put(CORPUS, entry('a', [1, 0], { embeddingModel: 'second-embedder' })),
    ).rejects.toBeInstanceOf(EmbedderMismatchError);
  });

  it('refuses a swapped embedder at SEARCH, before the scan', async () => {
    const { store, pg } = open((sql) =>
      sql.includes('SELECT "value" FROM') ? [{ value: 'first-embedder@4' }] : undefined,
    );
    await expect(
      store.search(CORPUS, [1, 0, 0, 0], { embedderId: 'second-embedder' }),
    ).rejects.toThrow(EmbedderMismatchError);
    // Refused BEFORE the scan: no ranking was ever asked for.
    expect(pg.sqlFor('af_score')).toHaveLength(0);
  });

  it('names the missing peer dependency, and says what the database needs too', async () => {
    // No `client`, no `_pg`, and `pg` is not installed in this repo.
    const store = pgVectorStore({ connectionString: 'postgres://localhost/app' });
    await expect(store.get(CORPUS, 'a')).rejects.toThrow(/CREATE EXTENSION IF NOT EXISTS vector/);
  });

  it('a closed store refuses rather than reopening itself', async () => {
    const { store } = open();
    await store.close();
    await expect(store.get(CORPUS, 'a')).rejects.toThrow(/is closed/);
  });
});

// ─── Integration — the corpus builders run against it unchanged ────

describe('pgVectorStore — integration', () => {
  it('indexDocuments writes a corpus, fingerprint and all, through the upsert', async () => {
    const { store, pg } = open();
    const embedder = mockEmbedder();
    const written = await indexDocuments(
      store,
      embedder,
      [
        { id: 'refunds.md#0', content: 'Refunds take 3 business days.' },
        { id: 'returns.md#0', content: 'Returns are free within 30 days.' },
      ],
      { embedderId: embedder.id },
    );
    expect(written).toBe(2);
    const upsert = pg.sqlFor('INSERT INTO "public"."af_vectors"')[0];
    // namespace, id, value, metadata, embedding, embedder_fp …
    expect(upsert?.params[0]).toBe(NS);
    expect(upsert?.params[5]).toBe(`${String(embedder.id)}@${String(embedder.dimensions)}`);
    // …and the fingerprint was recorded for the namespace, once.
    expect(pg.sqlFor('INSERT INTO "public"."af_index_meta"')).toHaveLength(1);
  });
});

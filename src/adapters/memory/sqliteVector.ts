/**
 * adapters/memory/sqliteVector — a corpus in a file, so you embed it once.
 *
 * `InMemoryStore` is a `Map`, and its cost is the one nobody notices until the
 * bill arrives: **restart the process and the whole corpus is re-embedded.**
 * That is fine for three documents and absurd for ten thousand. The step up was
 * "bring a vector database", and the step between those two — *one machine, one
 * file, nothing to install* — was a store every consumer had to write for
 * themselves. This is that store.
 *
 * ── The two-phase cost model this exists to fix ─────────────────────────────
 * **Index time** embeds the corpus. It happens once, in its own process, and
 * its cost scales with the size of your documents. **Query time** embeds one
 * thing — the user's question — per retrieval, and its cost scales with
 * traffic. A 10,000-chunk corpus is 10,000 embeddings *once* and one embedding
 * per question thereafter. With a `Map` it is 10,000 embeddings *per restart*.
 * That is the whole argument for a file.
 *
 * ── Exact search, and the ceiling said out loud ─────────────────────────────
 * Vectors live in SQLite as `Float32Array` blobs. On the first search of a
 * namespace they are hydrated into ONE resident `Float32Array` matrix,
 * normalised, and every later query is an exact dot product across it. There is
 * **no approximate index and no pretence of one**: this returns the true top-K,
 * or it does not answer.
 *
 * Measured against THIS implementation on Node 22.16, Apple silicon, one
 * namespace, median of five queries:
 *
 * | corpus | query | resident matrix | file | first search (hydration) |
 * |---|---|---|---|---|
 * | 10,000 × 384-d | 6 ms | 15 MB | 21 MB | 45 ms |
 * | 50,000 × 384-d | 31 ms | 77 MB | 105 MB | 251 ms |
 * | 100,000 × 384-d | 65 ms | 154 MB | 211 MB | 939 ms |
 * | 10,000 × 1536-d | 16 ms | 61 MB | 83 MB | 122 ms |
 * | 50,000 × 1536-d | 89 ms | 307 MB | 413 MB | **5.7 s** |
 *
 * **The documented ceiling is 50,000 chunks.** Below it, every query is under
 * 100 ms at every embedder this library ships and the resident matrix is under
 * ~300 MB. It degrades linearly and predictably to about 100,000. Above that,
 * or when the process cannot hold the matrix, move to a managed vector database
 * — `MemoryStore` is the seam, and nothing else in your code changes. For scale
 * intuition: 50,000 chunks at ~1,000 characters is roughly 50 MB of text, on
 * the order of 25,000 pages.
 *
 * **Hydration is the number to plan around, not the query.** Steady-state
 * search is fast everywhere in that table; reading the vectors off disk the
 * FIRST time is what costs, and at 50,000 × 1536 it is 5.7 seconds. Paid
 * lazily, that lands on whoever asks the first question after a deploy. Call
 * {@link SqliteVectorStore.warm} at boot to pay it somewhere you chose — see
 * that method. Smaller vectors are dramatically cheaper here: 384 dimensions
 * hydrates 100,000 chunks in under a second, which is one more reason a
 * 384-dimension embedder is the better default for a corpus this size.
 *
 * A loadable extension (sqlite-vec) was measured against this and deliberately
 * NOT taken: it is roughly 2× faster at these sizes, and costs a native binary
 * on a five-platform matrix (no musl, no Windows/arm64) plus a pre-1.0
 * dependency. Two times, at sizes where we are already under 100 ms, does not
 * buy that.
 *
 * ── One process on one machine ──────────────────────────────────────────────
 * The same ceiling `sqliteSessions` states, for the same reason. It survives a
 * restart, a crash, a deploy. It is NOT distributed. WAL gives one writer and
 * many readers at once; a second writer waits up to `busyTimeoutMs` and then
 * fails loudly rather than queueing forever.
 *
 * ── Zero dependencies, and the version floor that buys ──────────────────────
 * SQLite is *inside Node* — no install, no native build, no peer dependency.
 * The price is a version floor this package does not otherwise have, so the
 * module is loaded when you actually construct a store and its absence is
 * refused by name. There is deliberately **no fallback to memory**: a corpus
 * that silently forgot every document on restart looks, from the outside,
 * exactly like a corpus that was never built.
 */

import { identityNamespace } from '../../memory/identity/index.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { SqliteUnavailableError } from '../../lib/sqliteUnavailable.js';
import {
  EmbedderMismatchError as SharedEmbedderMismatchError,
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

// ─── The little bit of `node:sqlite` this adapter uses ───────────────

/** One prepared statement, as this adapter calls it. */
export interface SqliteVectorStatementLike {
  run(...params: readonly unknown[]): unknown;
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown[];
}

/** One open database, as this adapter calls it. */
export interface SqliteVectorDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteVectorStatementLike;
  close(): void;
}

/** The shape of `node:sqlite` this adapter needs, declared locally. */
export interface SqliteVectorModuleLike {
  new (path: string): SqliteVectorDatabaseLike;
}

// ─── Options ─────────────────────────────────────────────────────────

export interface SqliteVectorStoreOptions {
  /**
   * The database file. Created if it does not exist, along with its parent
   * directory — "no infrastructure" would be a thin promise if you still had
   * to `mkdir` first.
   *
   * `':memory:'` is refused: it looks like a file, keeps nothing across a
   * restart, and re-embedding the corpus on every boot is the exact cost this
   * store exists to remove. Use `InMemoryStore` when that is what you want —
   * it says so in its name.
   */
  readonly file: string;
  /**
   * How long a write waits for another writer's lock before failing, in
   * milliseconds. Default 5000. It fails rather than waiting forever on
   * purpose: a request hung on a lock looks exactly like a slow model, and the
   * two need different fixes.
   */
  readonly busyTimeoutMs?: number;
  /**
   * @internal Test seam only — the `node:sqlite` module, injected. Not public
   * API, not supported, and not a place to plug in another SQLite driver.
   */
  readonly _sqlite?: SqliteVectorModuleLike;
}

// ─── The refusals ────────────────────────────────────────────────────

/**
 * Raised when the file exists but this runtime cannot use it as a vector index.
 *
 * The law `sqliteSessions` states for a session file, one domain over: **an
 * unreadable index and an empty one are different facts, and only one of them
 * is safe to answer with "no matches".** A store that opened a corrupt file as
 * an empty database would answer every question from the model's own weights
 * and log nothing.
 *
 * `problem` is the fact to branch on:
 *
 *  - `'cannot-open'` — not a SQLite database, or not readable.
 *  - `'not-our-schema'` — a database whose `af_vectors` table is somebody
 *    else's table of that name. Point the store at its own file.
 *  - `'newer-schema'` — written by a newer agentfootprint than this one.
 */
export class UnreadableIndexFileError extends Error {
  readonly code = 'ERR_UNREADABLE_INDEX_FILE' as const;
  /** The file that was refused. */
  readonly file: string;
  /** Which of the three cases this is. */
  readonly problem: 'cannot-open' | 'not-our-schema' | 'newer-schema';

  constructor(file: string, problem: UnreadableIndexFileError['problem'], detail: string) {
    super(
      `[memory] the vector index at '${file}' cannot be used: ${detail} ` +
        `An unreadable index and an empty one are different facts, and only one of them ` +
        `is safe to answer with "no matches" — so this refuses rather than quietly ` +
        `answering every question from the model alone on top of a file that already ` +
        `exists. ` +
        (problem === 'newer-schema'
          ? `An index written by a newer agentfootprint needs a runtime that knows that ` +
            `schema; roll forward, or point this one at its own file.`
          : problem === 'not-our-schema'
          ? `Give the store a file of its own rather than sharing one with tables of ` +
            `the same name.`
          : `Check the path and its permissions, or move the file aside to start a ` + `new one.`),
    );
    this.name = 'UnreadableIndexFileError';
    this.file = file;
    this.problem = problem;
  }
}

/**
 * Raised when a vector meets an index built by a different embedder.
 *
 * Since 9.3.0 this is ONE class shared by every store that can make the check
 * (`lib/embedderMismatch.ts`), re-exported here so the import path that has
 * worked since 8.9.0 keeps working. A second class of the same name would make
 * `instanceof` depend on which store threw.
 */
export { EmbedderMismatchError } from '../../lib/embedderMismatch.js';

// ─── The schema ──────────────────────────────────────────────────────

/**
 * What this runtime writes. Bumped only for a change an older reader could not
 * survive — and an older reader meeting a newer number refuses by name rather
 * than reading what it half-understands.
 */
const SCHEMA_VERSION = 1;

const VECTORS_TABLE = 'af_vectors';
const SIGNATURES_TABLE = 'af_signatures';
const FEEDBACK_TABLE = 'af_feedback';
const META_TABLE = 'af_index_meta';

/**
 * `dims`, `embedder_fp` and `source_uri` are COLUMNS as well as facts inside the
 * JSON, and the redundancy is deliberate: it lets the file answer "what is in
 * this index, and who built it?" from the `sqlite3` command line during an
 * incident, without a JSON parser and without this library. An index you cannot
 * inspect with the tools already on the box is one you debug by guessing.
 */
const VECTORS_COLUMNS = [
  'namespace',
  'id',
  'value',
  'metadata',
  'embedding',
  'dims',
  'embedder_fp',
  'version',
  'created_at',
  'updated_at',
  'last_accessed_at',
  'access_count',
  'ttl',
  'tier',
  'source',
  'source_uri',
] as const;

// ─── The store ───────────────────────────────────────────────────────

/** A durable vector store, plus the three things a file owns beyond the port. */
export interface SqliteVectorStore extends MemoryStore {
  /**
   * The journalling mode the file **actually has**, read back from SQLite
   * rather than assumed from what was asked for.
   *
   * Normally `'wal'`. Something else when the file lives where WAL cannot work
   * — a network filesystem is the usual reason — and that is a fact worth being
   * able to read: the store still works, with one writer *or* one reader at a
   * time instead of both. A silent downgrade is only ever discovered under load.
   */
  readonly journalMode: string;
  /** The file this store is backed by. */
  readonly file: string;
  /**
   * The embedder fingerprint (`'<id>@<dims>'`) a namespace was built with, or
   * `undefined` when nothing with a vector has been written to it yet.
   *
   * Read this before an embedder swap: it is the fact `EmbedderMismatchError`
   * refuses on, available up front instead of at the first failed write.
   */
  fingerprintOf(identity: MemoryIdentity): string | undefined;
  /**
   * Read a namespace's vectors into memory NOW, and report how many and how
   * long it took.
   *
   * The first search of a namespace pays for hydration — 251 ms for 50,000
   * 384-dimension vectors, 5.7 s for 50,000 at 1536. Left alone that bill
   * lands on whoever asks the first question after a deploy, which is the
   * worst possible person to hand it to and the hardest latency to explain
   * afterwards.
   *
   * Calling this at boot moves the cost somewhere you chose. It is optional,
   * idempotent, and changes no result: a warmed store and a cold one answer
   * identically, one of them just answers the first question faster.
   *
   * ```ts
   * const store = sqliteVectorStore({ file: './corpus.db' });
   * const { count, durationMs } = await store.warm({ conversationId: '_global' });
   * console.log(`corpus ready: ${count} vectors in ${durationMs}ms`);
   * ```
   */
  warm(identity: MemoryIdentity): Promise<{ count: number; durationMs: number }>;
  /**
   * Close the file. Idempotent — a shutdown hook and an explicit close can
   * coexist. Reading or writing afterwards refuses by name rather than
   * reopening behind your back.
   */
  close(): void;
}

/** One namespace's vectors, resident and normalised, ready for exact search. */
interface WarmMatrix {
  readonly ids: string[];
  readonly matrix: Float32Array;
  readonly dims: number;
  /** Per-row TTL, so expiry is applied at query time without a rebuild. */
  readonly ttls: (number | undefined)[];
  readonly tiers: (string | undefined)[];
  readonly embedderIds: (string | undefined)[];
  /** Rows whose vector had zero magnitude — unscoreable, skipped. */
  readonly degenerate: Set<number>;
}

/**
 * Open (or create) a vector index in one SQLite file.
 *
 * @throws SqliteUnavailableError when the running Node has no `node:sqlite`.
 * @throws UnreadableIndexFileError when the file exists but cannot be used —
 *   never answered with an empty index.
 * @throws EmbedderMismatchError from `put`/`putMany`/`search` when a vector
 *   meets a namespace built by a different embedder.
 *
 * @example  Embed the corpus once, ever
 * ```ts
 * import { indexDocuments, defineRAG } from 'agentfootprint';
 * import { sqliteVectorStore } from 'agentfootprint/memory';
 * import { staticEmbedder } from 'agentfootprint/providers';
 *
 * const store = sqliteVectorStore({ file: './corpus.db' });
 * const embedder = staticEmbedder();
 *
 * // First boot indexes; every boot after this one finds the vectors already there.
 * await indexDocuments(store, embedder, docs, { embedderId: embedder.id });
 *
 * const agent = Agent.create({ provider })
 *   .rag(defineRAG({ id: 'docs', store, embedder, embedderId: embedder.id }))
 *   .build();
 * ```
 */
export function sqliteVectorStore(options: SqliteVectorStoreOptions): SqliteVectorStore {
  const { file, busyTimeoutMs = 5000 } = options;

  if (file === ':memory:' || file.trim() === '') {
    throw new TypeError(
      `[memory] sqliteVectorStore({ file: '${file}' }) is not a durable index. ` +
        `':memory:' looks like a file and keeps nothing across a restart, so every boot ` +
        `would re-embed the whole corpus — the one cost this store exists to remove. ` +
        `Use InMemoryStore when an in-process index is what you want — it says so in ` +
        `its name — or give this one a real path.`,
    );
  }

  const DatabaseSync = options._sqlite ?? loadSqlite();
  ensureParentDirectory(file);

  let db: SqliteVectorDatabaseLike;
  try {
    db = new DatabaseSync(file);
  } catch (err) {
    throw new UnreadableIndexFileError(file, 'cannot-open', `${describe(err)}.`);
  }

  let journalMode: string;
  try {
    journalMode = applyPragmas(db, busyTimeoutMs);
    ensureSchema(db, file);
  } catch (err) {
    db.close();
    if (err instanceof UnreadableIndexFileError) throw err;
    throw new UnreadableIndexFileError(file, 'cannot-open', `${describe(err)}.`);
  }

  const stmt = prepareStatements(db);

  /** Resident matrices, one per namespace, dropped on any write to that namespace. */
  const warm = new Map<string, WarmMatrix>();
  /** Fingerprints, read once per namespace and then held. */
  const fingerprints = new Map<string, string>();

  let closed = false;
  const open = (verb: string): void => {
    if (closed) {
      throw new Error(
        `[memory] the sqliteVectorStore at '${file}' is closed, so it cannot ${verb}. ` +
          `close() is final by design — reopening the file behind you would hide a ` +
          `shutdown-ordering bug rather than surface it. Build a new store if you need ` +
          `one after closing this.`,
      );
    }
  };

  const readFingerprint = (ns: string): string | undefined => {
    const held = fingerprints.get(ns);
    if (held !== undefined) return held;
    const row = stmt.readFp.get(`fp:${ns}`) as { value?: unknown } | undefined;
    if (typeof row?.value !== 'string') return undefined;
    fingerprints.set(ns, row.value);
    return row.value;
  };

  const recordFingerprint = (ns: string, fp: string): void => {
    stmt.writeFp.run(`fp:${ns}`, fp);
    fingerprints.set(ns, fp);
  };

  /**
   * Compare an arriving fingerprint against the namespace's, refuse a real
   * conflict, and adopt the arriving one when it is the first or the more
   * specific of the two.
   */
  const reconcileFingerprint = (
    ns: string,
    incoming: Fingerprint,
    operation: 'write to' | 'search',
  ): void => {
    const storedText = readFingerprint(ns);
    if (storedText === undefined) {
      if (operation === 'write to') recordFingerprint(ns, fingerprintText(incoming));
      return;
    }
    const stored = parseFingerprint(storedText);
    const conflict = fingerprintConflict(stored, incoming);
    if (conflict !== null) {
      throw new SharedEmbedderMismatchError(
        ns,
        storedText,
        fingerprintText(incoming),
        conflict,
        operation,
        // This store's own second way out: a namespace lives in a file, so
        // another file is another index.
        'point this store at a different file',
      );
    }
    // Compatible. If the index recorded an anonymous embedder and this vector
    // names one, upgrade the record — a named fingerprint can refuse a future
    // swap that an anonymous one has to let through.
    if (operation === 'write to' && stored.id === undefined && incoming.id !== undefined) {
      recordFingerprint(ns, fingerprintText(incoming));
    }
  };

  const writeEntry = (ns: string, entry: MemoryEntry<unknown>): void => {
    const vector = toFloat32(entry.embedding);
    if (vector) {
      reconcileFingerprint(
        ns,
        {
          ...(entry.embeddingModel !== undefined && { id: entry.embeddingModel }),
          dims: vector.length,
        },
        'write to',
      );
    }
    stmt.upsert.run(
      ns,
      entry.id,
      JSON.stringify(entry.value ?? null),
      entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
      vector ? blobOf(vector) : null,
      vector ? vector.length : 0,
      vector
        ? fingerprintText({
            ...(entry.embeddingModel !== undefined && { id: entry.embeddingModel }),
            dims: vector.length,
          })
        : null,
      entry.version,
      entry.createdAt,
      entry.updatedAt,
      entry.lastAccessedAt,
      entry.accessCount,
      entry.ttl ?? null,
      entry.tier ?? null,
      entry.source === undefined ? null : JSON.stringify(entry.source),
      readSourceUri(entry),
      entry.embeddingModel ?? null,
    );
    warm.delete(ns);
  };

  const hydrate = (ns: string): WarmMatrix => {
    const held = warm.get(ns);
    if (held) return held;

    const rows = stmt.vectorsOf.all(ns) as {
      id: string;
      embedding: Uint8Array;
      dims: number;
      ttl: number | null;
      tier: string | null;
      embedding_model: string | null;
    }[];

    const dims = rows.length > 0 ? rows[0]?.dims ?? 0 : 0;
    const matrix = new Float32Array(rows.length * dims);
    const ids: string[] = [];
    const ttls: (number | undefined)[] = [];
    const tiers: (string | undefined)[] = [];
    const embedderIds: (string | undefined)[] = [];
    const degenerate = new Set<number>();

    let row = 0;
    for (const r of rows) {
      // A namespace cannot hold two vector lengths — the fingerprint refusal
      // above is what guarantees it — but a file edited by hand can, and a
      // ragged matrix is worse than a skipped row.
      if (r.dims !== dims) continue;
      const vec = readFloat32(r.embedding, dims);
      let norm = 0;
      for (let i = 0; i < dims; i++) norm += (vec[i] ?? 0) * (vec[i] ?? 0);
      norm = Math.sqrt(norm);
      const offset = row * dims;
      if (norm === 0) {
        degenerate.add(row);
      } else {
        // Normalised at hydration, so every query is a dot product. The BLOB on
        // disk keeps the ORIGINAL vector, so `get`/`list` round-trip exactly
        // what the caller wrote.
        for (let i = 0; i < dims; i++) matrix[offset + i] = (vec[i] ?? 0) / norm;
      }
      ids.push(r.id);
      ttls.push(r.ttl ?? undefined);
      tiers.push(r.tier ?? undefined);
      embedderIds.push(r.embedding_model ?? undefined);
      row += 1;
    }

    const built: WarmMatrix = { ids, matrix, dims, ttls, tiers, embedderIds, degenerate };
    warm.set(ns, built);
    return built;
  };

  const store: SqliteVectorStore = {
    journalMode,
    file,

    // Vectors in, ranked vectors out — exact cosine over the embeddings this
    // store was handed. Declared so the corpus builders can tell this apart
    // from a store whose search() ranks on someone else's side.
    supportsVectorSearch: true,

    fingerprintOf(identity: MemoryIdentity): string | undefined {
      open('report a fingerprint');
      return readFingerprint(identityNamespace(identity));
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async warm(identity: MemoryIdentity): Promise<{ count: number; durationMs: number }> {
      open('warm a namespace');
      const startedAt = Date.now();
      const warmed = hydrate(identityNamespace(identity));
      return { count: warmed.ids.length, durationMs: Date.now() - startedAt };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
      open('read an entry');
      const ns = identityNamespace(identity);
      const row = stmt.select.get(ns, id) as RawRow | undefined;
      if (row === undefined) return null;
      if (isExpired(row.ttl)) return null;
      // Decay signals, the same side effect the port documents for `get`. It
      // does NOT invalidate the warm matrix: access counters are not vectors.
      stmt.touch.run(Date.now(), ns, id);
      return rowToEntry<T>(row);
    },

    async put<T = unknown>(identity: MemoryIdentity, entry: MemoryEntry<T>): Promise<void> {
      await this.putMany(identity, [entry]);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async putMany<T = unknown>(
      identity: MemoryIdentity,
      entries: readonly MemoryEntry<T>[],
    ): Promise<void> {
      open('write entries');
      // The port requires an empty batch to be a no-op — callers rely on it to
      // skip a round-trip on a turn that produced nothing.
      if (entries.length === 0) return;
      const ns = identityNamespace(identity);

      // ONE transaction for the batch. The port says atomicity is not
      // guaranteed across a batch and most callers are append-idempotent — but
      // a HALF-INDEXED corpus is a specific kind of bad: retrieval keeps
      // working and quietly cannot see the documents that did not land, which
      // reads as "the model does not know that" rather than as a failure. A
      // file can offer all-or-nothing cheaply, so it does.
      db.exec('BEGIN');
      try {
        for (const entry of entries) writeEntry(ns, entry);
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* The original failure is the one worth reporting. */
        }
        warm.delete(ns);
        throw err;
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async putIfVersion<T = unknown>(
      identity: MemoryIdentity,
      entry: MemoryEntry<T>,
      expectedVersion: number,
    ): Promise<PutIfVersionResult> {
      open('write an entry');
      const ns = identityNamespace(identity);
      // Read and write inside one transaction, so the check and the write
      // cannot be separated by another writer — which is the entire point of a
      // compare-and-set.
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = stmt.selectVersion.get(ns, entry.id) as { version?: number } | undefined;
        const current = row?.version;
        if (current === undefined) {
          if (expectedVersion !== 0) {
            db.exec('COMMIT');
            return { applied: false };
          }
        } else if (current !== expectedVersion) {
          db.exec('COMMIT');
          return { applied: false, currentVersion: current };
        }
        writeEntry(ns, entry);
        db.exec('COMMIT');
        return { applied: true };
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* The original failure is the one worth reporting. */
        }
        warm.delete(ns);
        throw err;
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async list<T = unknown>(
      identity: MemoryIdentity,
      listOptions?: ListOptions,
    ): Promise<ListResult<T>> {
      open('list entries');
      const ns = identityNamespace(identity);
      const limit = Math.max(1, Math.floor(listOptions?.limit ?? 100));
      const after = listOptions?.cursor ?? '';
      const rows = stmt.list.all(ns, after, limit + 1) as RawRow[];

      const tierFilter = listOptions?.tiers ? new Set(listOptions.tiers) : undefined;
      const page: MemoryEntry<T>[] = [];
      let cursor: string | undefined;
      for (const row of rows) {
        if (page.length === limit) {
          // The extra row only ever exists to prove there IS a next page.
          cursor = page[page.length - 1]?.id;
          break;
        }
        if (isExpired(row.ttl)) continue;
        if (tierFilter && (row.tier === null || !tierFilter.has(row.tier as never))) continue;
        page.push(rowToEntry<T>(row));
      }
      return { entries: page, ...(cursor !== undefined && { cursor }) };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async delete(identity: MemoryIdentity, id: string): Promise<void> {
      open('delete an entry');
      const ns = identityNamespace(identity);
      stmt.remove.run(ns, id);
      warm.delete(ns);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async seen(identity: MemoryIdentity, signature: string): Promise<boolean> {
      open('check a signature');
      return stmt.seen.get(identityNamespace(identity), signature) !== undefined;
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async recordSignature(identity: MemoryIdentity, signature: string): Promise<void> {
      open('record a signature');
      stmt.addSignature.run(identityNamespace(identity), signature);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async feedback(identity: MemoryIdentity, id: string, usefulness: number): Promise<void> {
      open('record feedback');
      // Non-finite values poison the aggregate; the port says adapters must
      // reject them, and clamp the rest.
      if (!Number.isFinite(usefulness)) return;
      const clamped = Math.max(-1, Math.min(1, usefulness));
      stmt.addFeedback.run(identityNamespace(identity), id, clamped);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async getFeedback(
      identity: MemoryIdentity,
      id: string,
    ): Promise<{ average: number; count: number } | null> {
      open('read feedback');
      const row = stmt.readFeedback.get(identityNamespace(identity), id) as
        | { total?: number; count?: number }
        | undefined;
      const count = row?.count ?? 0;
      if (count === 0) return null;
      return { average: (row?.total ?? 0) / count, count };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async forget(identity: MemoryIdentity): Promise<void> {
      open('forget a namespace');
      const ns = identityNamespace(identity);
      db.exec('BEGIN');
      try {
        stmt.forgetVectors.run(ns);
        stmt.forgetSignatures.run(ns);
        stmt.forgetFeedback.run(ns);
        stmt.forgetMeta.run(`fp:${ns}`);
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* The original failure is the one worth reporting. */
        }
        throw err;
      }
      warm.delete(ns);
      fingerprints.delete(ns);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async search<T = unknown>(
      identity: MemoryIdentity,
      query: readonly number[],
      searchOptions?: SearchOptions,
    ): Promise<readonly ScoredEntry<T>[]> {
      open('search');
      const ns = identityNamespace(identity);
      const k = Math.max(1, Math.floor(searchOptions?.k ?? 10));

      // Refused BEFORE the scan, on both halves of the fingerprint. A swapped
      // embedder must not score against the old vectors — the numbers come back
      // in the same range as real ones and no threshold separates them.
      reconcileFingerprint(
        ns,
        {
          ...(searchOptions?.embedderId !== undefined && { id: searchOptions.embedderId }),
          dims: query.length,
        },
        'search',
      );

      const warmed = hydrate(ns);
      if (warmed.ids.length === 0 || warmed.dims === 0) return [];
      if (warmed.dims !== query.length) return [];

      // Normalise the query once; the matrix rows already are. Cosine is then
      // one dot product per row and nothing else.
      let qNorm = 0;
      for (const v of query) qNorm += v * v;
      qNorm = Math.sqrt(qNorm);
      if (qNorm === 0) return [];
      const q = new Float32Array(query.length);
      for (let i = 0; i < query.length; i++) q[i] = (query[i] ?? 0) / qNorm;

      const now = Date.now();
      const tierFilter = searchOptions?.tiers ? new Set(searchOptions.tiers) : undefined;
      const embedderId = searchOptions?.embedderId;
      const minScore = searchOptions?.minScore;
      const { dims, matrix, ids } = warmed;

      const scored: { id: string; score: number }[] = [];
      for (let row = 0; row < ids.length; row++) {
        if (warmed.degenerate.has(row)) continue;
        const ttl = warmed.ttls[row];
        if (ttl !== undefined && ttl <= now) continue;
        if (tierFilter) {
          const tier = warmed.tiers[row];
          if (tier === undefined || !tierFilter.has(tier as never)) continue;
        }
        if (embedderId !== undefined) {
          const rowEmbedder = warmed.embedderIds[row];
          if (rowEmbedder !== undefined && rowEmbedder !== embedderId) continue;
        }
        const offset = row * dims;
        let dot = 0;
        for (let i = 0; i < dims; i++) dot += (matrix[offset + i] ?? 0) * (q[i] ?? 0);
        if (minScore !== undefined && dot < minScore) continue;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        scored.push({ id: ids[row]!, score: dot });
      }

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      // Hydrate only the winners' payloads. The matrix holds vectors, not
      // documents — a 50,000-chunk namespace has no business materialising
      // 50,000 JSON values to answer a top-3.
      const out: ScoredEntry<T>[] = [];
      for (const hit of scored.slice(0, k)) {
        const row = stmt.select.get(ns, hit.id) as RawRow | undefined;
        if (row === undefined) continue;
        out.push({ entry: rowToEntry<T>(row), score: hit.score });
      }
      return out;
    },

    close(): void {
      if (closed) return;
      closed = true;
      warm.clear();
      db.close();
    },
  };

  return store;
}

// ─── Fingerprints ────────────────────────────────────────────────────
//
// The three helpers (`fingerprintText`, `parseFingerprint`,
// `fingerprintConflict`) and the refusal moved to `lib/embedderMismatch.ts` in
// 9.3.0, when `pgVectorStore` and `s3VectorsStore` learned to make the same
// check. One rule, one implementation — a second copy is how "dimensions
// always decide, ids decide only when both sides named themselves" drifts.

// ─── Row mapping ─────────────────────────────────────────────────────

interface RawRow {
  id: string;
  value: string;
  metadata: string | null;
  embedding: Uint8Array | null;
  dims: number;
  version: number;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  access_count: number;
  ttl: number | null;
  tier: string | null;
  source: string | null;
  embedding_model: string | null;
}

function rowToEntry<T>(row: RawRow): MemoryEntry<T> {
  return {
    id: row.id,
    value: parseJson(row.value) as T,
    ...(row.metadata !== null && {
      metadata: parseJson(row.metadata) as Record<string, unknown>,
    }),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    ...(row.ttl !== null && { ttl: row.ttl }),
    ...(row.tier !== null && { tier: row.tier as 'hot' | 'warm' | 'cold' }),
    ...(row.source !== null && {
      source: parseJson(row.source) as MemoryEntry<T>['source'],
    }),
    ...(row.embedding !== null &&
      row.dims > 0 && { embedding: Array.from(readFloat32(row.embedding, row.dims)) }),
    ...(row.embedding_model !== null && { embeddingModel: row.embedding_model }),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A value this store could not read back. It was written as JSON by this
    // store, so reaching here means the file was edited by something else.
    return null;
  }
}

function isExpired(ttl: number | null): boolean {
  return ttl !== null && ttl <= Date.now();
}

/** The document a chunk came from, lifted to a column so `sqlite3` can group by it. */
function readSourceUri(entry: MemoryEntry<unknown>): string | null {
  const value = entry.value as { metadata?: Record<string, unknown> } | undefined;
  const meta = (value?.metadata ?? entry.metadata) as Record<string, unknown> | undefined;
  const uri = meta?.['docUri'] ?? meta?.['source'];
  return typeof uri === 'string' && uri.length > 0 ? uri : null;
}

// ─── Vector encoding ─────────────────────────────────────────────────

function toFloat32(embedding: readonly number[] | undefined): Float32Array | undefined {
  if (!embedding || embedding.length === 0) return undefined;
  const out = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) out[i] = embedding[i] ?? 0;
  return out;
}

/** Little-endian `Float32Array` bytes — the platform's own layout, no conversion. */
function blobOf(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function readFloat32(blob: Uint8Array, dims: number): Float32Array {
  // A BLOB comes back with its own byteOffset; a Float32Array view needs a
  // 4-byte-aligned one, which is not guaranteed, so copy when it is not.
  if (blob.byteOffset % 4 === 0) {
    return new Float32Array(blob.buffer, blob.byteOffset, Math.min(dims, blob.byteLength / 4));
  }
  const copy = new Uint8Array(blob);
  return new Float32Array(copy.buffer, 0, Math.min(dims, copy.byteLength / 4));
}

// ─── Internals ───────────────────────────────────────────────────────

function loadSqlite(): SqliteVectorModuleLike {
  try {
    const mod = lazyRequire<{ DatabaseSync: SqliteVectorModuleLike }>('node:sqlite');
    if (typeof mod?.DatabaseSync !== 'function') {
      throw new Error('the module loaded but has no DatabaseSync');
    }
    return mod.DatabaseSync;
  } catch (err) {
    throw new SqliteUnavailableError(nodeVersion(), describe(err), {
      door: 'memory',
      factory: 'sqliteVectorStore()',
      alternative:
        'InMemoryStore — which keeps the index in a Map and re-embeds the whole corpus on every restart, and says so in its name',
      whyNotFallback:
        'an index that silently forgot every document on restart looks, from the outside, exactly like a corpus that was never built',
    });
  }
}

function nodeVersion(): string {
  return typeof process !== 'undefined' && typeof process.version === 'string'
    ? process.version
    : 'unknown';
}

function ensureParentDirectory(file: string): void {
  try {
    const { mkdirSync } = lazyRequire<typeof import('node:fs')>('node:fs');
    const { dirname } = lazyRequire<typeof import('node:path')>('node:path');
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    /* Reported by the open below, with the path and the real reason. */
  }
}

/**
 * Set the file up for concurrent use and report what it actually got.
 *
 * `journal_mode` runs first on purpose: it is the point at which SQLite reads
 * the file header, so "this is not a database" surfaces here, at construction,
 * rather than on the first query of the night.
 */
function applyPragmas(db: SqliteVectorDatabaseLike, busyTimeoutMs: number): string {
  const row = db.prepare('PRAGMA journal_mode = WAL').get() as
    | { journal_mode?: unknown }
    | undefined;
  // A pragma takes a literal, not a bound parameter, so the number is coerced
  // to one before it reaches the statement rather than trusted to be one.
  const waitMs = Number.isFinite(busyTimeoutMs) ? Math.max(0, Math.floor(busyTimeoutMs)) : 5000;
  db.exec(`PRAGMA busy_timeout = ${waitMs}`);
  // NORMAL, not FULL: with WAL that is durable across a process crash — which
  // is what this store promises — without a disk sync per write. A power cut
  // can still cost the most recent commits; the answer to that is a
  // fleet-grade store, not a pragma.
  db.exec('PRAGMA synchronous = NORMAL');
  return typeof row?.journal_mode === 'string' ? row.journal_mode : 'unknown';
}

function ensureSchema(db: SqliteVectorDatabaseLike, file: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${VECTORS_TABLE} (` +
      `namespace TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, metadata TEXT, ` +
      `embedding BLOB, dims INTEGER NOT NULL, embedder_fp TEXT, version INTEGER NOT NULL, ` +
      `created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ` +
      `last_accessed_at INTEGER NOT NULL, access_count INTEGER NOT NULL, ` +
      `ttl INTEGER, tier TEXT, source TEXT, source_uri TEXT, embedding_model TEXT, ` +
      `PRIMARY KEY (namespace, id)) STRICT`,
  );
  // The identity check runs HERE — after the table, before anything that
  // depends on its columns. `CREATE TABLE IF NOT EXISTS` succeeds against
  // somebody else's table of the same name, and the very next statement
  // (an index over `namespace`) would then fail on a missing column and be
  // reported as 'cannot-open' — the right refusal for the wrong reason,
  // telling the reader to check permissions on a file whose real problem is
  // that it belongs to something else.
  const columns = (
    db.prepare(`PRAGMA table_info('${VECTORS_TABLE}')`).all() as { name?: unknown }[]
  ).map((c) => String(c.name));
  const missing = VECTORS_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    throw new UnreadableIndexFileError(
      file,
      'not-our-schema',
      `it has an '${VECTORS_TABLE}' table that is not this store's ` +
        `(missing ${missing.join(', ')}; found ${columns.join(', ') || 'nothing'}).`,
    );
  }

  db.exec(`CREATE INDEX IF NOT EXISTS ${VECTORS_TABLE}_ns ON ${VECTORS_TABLE}(namespace)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${VECTORS_TABLE}_doc ON ${VECTORS_TABLE}(namespace, source_uri)`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${SIGNATURES_TABLE} (` +
      `namespace TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY (namespace, signature)) STRICT`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${FEEDBACK_TABLE} (` +
      `namespace TEXT NOT NULL, id TEXT NOT NULL, total REAL NOT NULL, count INTEGER NOT NULL, ` +
      `PRIMARY KEY (namespace, id)) STRICT`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
  );

  const stored = db
    .prepare(`SELECT value FROM ${META_TABLE} WHERE key = 'schema_version'`)
    .get() as { value?: unknown } | undefined;
  if (stored === undefined) {
    db.prepare(`INSERT INTO ${META_TABLE} (key, value) VALUES ('schema_version', ?)`).run(
      String(SCHEMA_VERSION),
    );
    return;
  }
  const found = Number(stored.value);
  if (!Number.isFinite(found) || found > SCHEMA_VERSION) {
    throw new UnreadableIndexFileError(
      file,
      'newer-schema',
      `it was written with schema version ${String(stored.value)} and this runtime ` +
        `reads version ${SCHEMA_VERSION}.`,
    );
  }
}

function prepareStatements(db: SqliteVectorDatabaseLike) {
  const ENTRY_COLUMNS =
    'id, value, metadata, embedding, dims, version, created_at, updated_at, ' +
    'last_accessed_at, access_count, ttl, tier, source, embedding_model';
  return {
    upsert: db.prepare(
      `INSERT INTO ${VECTORS_TABLE} (namespace, id, value, metadata, embedding, dims, ` +
        `embedder_fp, version, created_at, updated_at, last_accessed_at, access_count, ` +
        `ttl, tier, source, source_uri, embedding_model) ` +
        `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
        `ON CONFLICT(namespace, id) DO UPDATE SET value = excluded.value, ` +
        `metadata = excluded.metadata, embedding = excluded.embedding, dims = excluded.dims, ` +
        `embedder_fp = excluded.embedder_fp, version = excluded.version, ` +
        `created_at = excluded.created_at, updated_at = excluded.updated_at, ` +
        `last_accessed_at = excluded.last_accessed_at, access_count = excluded.access_count, ` +
        `ttl = excluded.ttl, tier = excluded.tier, source = excluded.source, ` +
        `source_uri = excluded.source_uri, embedding_model = excluded.embedding_model`,
    ),
    select: db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM ${VECTORS_TABLE} WHERE namespace = ? AND id = ?`,
    ),
    selectVersion: db.prepare(
      `SELECT version FROM ${VECTORS_TABLE} WHERE namespace = ? AND id = ?`,
    ),
    list: db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM ${VECTORS_TABLE} WHERE namespace = ? AND id > ? ` +
        `ORDER BY id LIMIT ?`,
    ),
    vectorsOf: db.prepare(
      `SELECT id, embedding, dims, ttl, tier, embedding_model FROM ${VECTORS_TABLE} ` +
        `WHERE namespace = ? AND embedding IS NOT NULL ORDER BY id`,
    ),
    touch: db.prepare(
      `UPDATE ${VECTORS_TABLE} SET last_accessed_at = ?, access_count = access_count + 1 ` +
        `WHERE namespace = ? AND id = ?`,
    ),
    remove: db.prepare(`DELETE FROM ${VECTORS_TABLE} WHERE namespace = ? AND id = ?`),
    seen: db.prepare(`SELECT 1 FROM ${SIGNATURES_TABLE} WHERE namespace = ? AND signature = ?`),
    addSignature: db.prepare(
      `INSERT INTO ${SIGNATURES_TABLE} (namespace, signature) VALUES (?, ?) ` +
        `ON CONFLICT(namespace, signature) DO NOTHING`,
    ),
    addFeedback: db.prepare(
      `INSERT INTO ${FEEDBACK_TABLE} (namespace, id, total, count) VALUES (?, ?, ?, 1) ` +
        `ON CONFLICT(namespace, id) DO UPDATE SET total = total + excluded.total, ` +
        `count = count + 1`,
    ),
    readFeedback: db.prepare(
      `SELECT total, count FROM ${FEEDBACK_TABLE} WHERE namespace = ? AND id = ?`,
    ),
    forgetVectors: db.prepare(`DELETE FROM ${VECTORS_TABLE} WHERE namespace = ?`),
    forgetSignatures: db.prepare(`DELETE FROM ${SIGNATURES_TABLE} WHERE namespace = ?`),
    forgetFeedback: db.prepare(`DELETE FROM ${FEEDBACK_TABLE} WHERE namespace = ?`),
    forgetMeta: db.prepare(`DELETE FROM ${META_TABLE} WHERE key = ?`),
    readFp: db.prepare(`SELECT value FROM ${META_TABLE} WHERE key = ?`),
    writeFp: db.prepare(
      `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?) ` +
        `ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),
  };
}

/** One sentence about a thrown thing, for a message that has to stay readable. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

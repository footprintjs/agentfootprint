/**
 * artifacts/sqliteArtifacts — the claim-check store in one SQLite file.
 *
 * The durable pairing for `sqliteSessions`: point both at files beside each
 * other and the artifacts a conversation minted live exactly as long as the
 * conversation that can speak their refs — retention coupled by
 * construction, not by checkup. It follows `hosting/sqliteSessions` law for
 * law: `node:sqlite` loaded lazily at construction and refused by name where
 * absent (no install, no native build, and no version-floor tax on consumers
 * who never construct one); WAL requested and the journal mode REPORTED as
 * read back rather than assumed; STRICT tables; a file that exists but is not
 * ours refused by name (`not-our-schema` / `newer-schema` / `cannot-open`) —
 * an unreadable store and an empty one are different facts, and only one of
 * them is safe to answer with a fresh start; `':memory:'` refused, because
 * `inMemoryArtifacts` says that in its name.
 *
 * The columns repeat what the meta knows (kind, bytes, expiry, creation) so
 * an incident can ask "what is filling this store?" from the `sqlite3`
 * command line without a JSON parser and without this library.
 *
 * One process, one machine, one writer at a time — the same ceiling
 * sqliteSessions states, inherited rather than restated at length.
 */

import { lazyRequire } from '../lib/lazyRequire.js';
import { SqliteUnavailableError } from '../lib/sqliteUnavailable.js';
import { identityNamespace } from '../memory/identity/index.js';
import { prepareArtifact } from './minting.js';
import { isArtifactRef } from './naming.js';
import {
  computeArtifactDigest,
  decodeArtifactData,
  type EncodedPayload,
  encodeArtifactData,
} from './payload.js';
import {
  assertRetention,
  planRetention,
  type ArtifactRetention,
  type RetainedRow,
} from './retention.js';
import {
  ArtifactIntegrityError,
  InvalidArtifactError,
  type ArtifactListOptions,
  type ArtifactListResult,
  type ArtifactMeta,
  type ArtifactOrigin,
  type ArtifactPutResult,
  type ArtifactRecord,
  type ArtifactRef,
  type ArtifactStore,
} from './types.js';

// ─── The little bit of `node:sqlite` this adapter uses ───────────────
// Declared locally, the way every adapter here declares the slice of its
// backend it calls, so nothing takes a hard import on a module that does not
// exist on every supported Node.

/** One prepared statement, as this adapter calls it. */
export interface SqliteArtifactsStatementLike {
  run(...params: readonly unknown[]): unknown;
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown[];
}

/** One open database, as this adapter calls it. */
export interface SqliteArtifactsDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteArtifactsStatementLike;
  close(): void;
}

/** The shape of `node:sqlite`'s DatabaseSync this adapter needs. */
export interface SqliteArtifactsModuleLike {
  new (path: string): SqliteArtifactsDatabaseLike;
}

// ─── Options, refusals, the store ────────────────────────────────────

/** Options for {@link sqliteArtifacts}. */
export interface SqliteArtifactsOptions {
  /** The database file. Created if missing, parent directory included.
   *  `':memory:'` is refused — use `inMemoryArtifacts()`, it says so in its name. */
  readonly file: string;
  /** Retention dials — optional here: disk is a budget the operator owns.
   *  Budget evictions are least-recently-ACCESSED first (reads refresh recency). */
  readonly retention?: ArtifactRetention;
  /** How long a write waits for another writer's lock before failing loudly.
   *  Default 5000 ms. */
  readonly busyTimeoutMs?: number;
  /** @internal Test seam only — the `node:sqlite` module, injected. Not public
   *  API and not a place to plug in another SQLite driver. */
  readonly _sqlite?: SqliteArtifactsModuleLike;
  /** @internal Test seam — the clock. Defaults to `Date.now`. */
  readonly _now?: () => number;
}

/** The store, plus the three things a real file store owes beyond the port. */
export interface SqliteArtifacts extends ArtifactStore {
  /** The journal mode the file ACTUALLY has, read back from SQLite. */
  readonly journalMode: string;
  /** Close the file. Idempotent; using the store afterwards refuses by name. */
  close(): void;
}

/**
 * Raised when the file exists but this runtime cannot use it as an artifact
 * store — never answered with an empty store. Same law, same three cases as
 * `UnreadableSessionFileError`, per store.
 */
export class UnreadableArtifactStoreError extends Error {
  readonly code = 'ERR_UNREADABLE_ARTIFACT_STORE' as const;
  readonly file: string;
  readonly problem: 'cannot-open' | 'not-our-schema' | 'newer-schema';

  constructor(file: string, problem: UnreadableArtifactStoreError['problem'], detail: string) {
    super(
      `[artifacts] the artifact store at '${file}' cannot be used: ${detail} ` +
        `An unreadable store and an empty one are different facts, and only one of them is ` +
        `safe to answer with a fresh start. ` +
        (problem === 'newer-schema'
          ? `Roll agentfootprint forward, or point this store at its own file.`
          : problem === 'not-our-schema'
          ? `Give the store a file of its own rather than sharing one with tables of the ` +
            `same name.`
          : `Check the path and its permissions, or move the file aside to start a new one.`),
    );
    this.name = 'UnreadableArtifactStoreError';
    this.file = file;
    this.problem = problem;
  }
}

/** Bumped only for a change an older reader could not survive. */
const SCHEMA_VERSION = 1;
const ARTIFACTS_TABLE = 'af_artifacts';
const META_TABLE = 'af_artifacts_meta';
const ARTIFACT_COLUMNS = [
  'scope_ns',
  'ref',
  'kind',
  'media_type',
  'bytes',
  'label',
  'digest',
  'expires_at',
  'origin',
  'parent_refs',
  'created_at',
  'last_accessed_at',
  'payload_shape',
  'payload',
] as const;

interface ArtifactRow {
  readonly ref: string;
  readonly kind: string;
  readonly media_type: string;
  readonly bytes: number;
  readonly label: string | null;
  readonly digest: string | null;
  readonly expires_at: number | null;
  readonly origin: string | null;
  readonly parent_refs: string | null;
  readonly created_at: number;
  readonly last_accessed_at: number;
  readonly payload_shape: EncodedPayload['shape'];
  readonly payload: string;
}

/**
 * An artifact store in one SQLite file — durable across restarts, crash-safe
 * under WAL, and the natural neighbour of `sqliteSessions({ file })`.
 *
 * @throws SqliteUnavailableError when the running Node has no `node:sqlite`.
 * @throws UnreadableArtifactStoreError when the file exists but cannot be used.
 *
 * @example
 *   const agent = Agent.create({
 *     provider,
 *     artifacts: sqliteArtifacts({ file: './data/artifacts.db' }),
 *   });
 */
export function sqliteArtifacts(options: SqliteArtifactsOptions): SqliteArtifacts {
  const { file, retention, busyTimeoutMs = 5000 } = options;

  if (file === ':memory:' || typeof file !== 'string' || file.trim() === '') {
    throw new TypeError(
      `[artifacts] sqliteArtifacts({ file: '${String(file)}' }) is not a durable store. ` +
        `':memory:' looks like a file and keeps nothing across a restart, which is the one ` +
        `thing this adapter exists to do. Use inMemoryArtifacts() when an in-process store ` +
        `is what you want — it says so in its name — or give this one a real path.`,
    );
  }
  assertRetention('sqliteArtifacts', retention);
  const now = options._now ?? Date.now;

  const DatabaseSync = options._sqlite ?? loadSqlite();
  ensureParentDirectory(file);

  let db: SqliteArtifactsDatabaseLike;
  try {
    db = new DatabaseSync(file);
  } catch (err) {
    throw new UnreadableArtifactStoreError(file, 'cannot-open', `${describe(err)}.`);
  }

  let journalMode: string;
  try {
    journalMode = applyPragmas(db, busyTimeoutMs);
    ensureSchema(db, file);
  } catch (err) {
    db.close();
    if (err instanceof UnreadableArtifactStoreError) throw err;
    throw new UnreadableArtifactStoreError(file, 'cannot-open', `${describe(err)}.`);
  }

  const insert = db.prepare(
    `INSERT INTO ${ARTIFACTS_TABLE} (${ARTIFACT_COLUMNS.join(', ')}) ` +
      `VALUES (${ARTIFACT_COLUMNS.map(() => '?').join(', ')})`,
  );
  const selectOne = db.prepare(
    `SELECT ${ARTIFACT_COLUMNS.slice(1).join(', ')} FROM ${ARTIFACTS_TABLE} ` +
      `WHERE scope_ns = ? AND ref = ?`,
  );
  const selectScope = db.prepare(
    `SELECT ref, kind, bytes, expires_at, last_accessed_at FROM ${ARTIFACTS_TABLE} ` +
      `WHERE scope_ns = ?`,
  );
  const selectPage = db.prepare(
    `SELECT ${ARTIFACT_COLUMNS.slice(1).join(', ')} FROM ${ARTIFACTS_TABLE} ` +
      `WHERE scope_ns = ? ORDER BY created_at DESC, ref ASC LIMIT ? OFFSET ?`,
  );
  const touch = db.prepare(
    `UPDATE ${ARTIFACTS_TABLE} SET last_accessed_at = ? WHERE scope_ns = ? AND ref = ?`,
  );
  const remove = db.prepare(`DELETE FROM ${ARTIFACTS_TABLE} WHERE scope_ns = ? AND ref = ?`);

  let closed = false;
  const open = (verb: string): void => {
    if (closed) {
      throw new Error(
        `[artifacts] the sqliteArtifacts store at '${file}' is closed, so it cannot ${verb}. ` +
          `close() is final by design — reopening the file behind you would hide a ` +
          `shutdown-ordering bug rather than surface it. Build a new store if you need one.`,
      );
    }
  };

  const rowFor = (ns: string, ref: ArtifactRef): ArtifactRow | undefined =>
    selectOne.get(ns, ref) as ArtifactRow | undefined;

  /** Resolve a live row; sweep it when the calendar says it is gone. */
  const liveRow = (ns: string, ref: ArtifactRef): ArtifactRow | undefined => {
    if (!isArtifactRef(ref)) return undefined;
    const row = rowFor(ns, ref);
    if (row === undefined) return undefined;
    if (row.expires_at !== null && row.expires_at <= now()) {
      remove.run(ns, ref);
      return undefined;
    }
    return row;
  };

  const metaOf = (row: ArtifactRow): ArtifactMeta => ({
    ref: row.ref,
    kind: row.kind,
    mediaType: row.media_type,
    bytes: row.bytes,
    createdAt: row.created_at,
    ...(row.label !== null && { label: row.label }),
    ...(row.digest !== null && { digest: row.digest }),
    ...(row.expires_at !== null && { expiresAt: row.expires_at }),
    ...(row.origin !== null && { origin: JSON.parse(row.origin) as ArtifactOrigin }),
    ...(row.parent_refs !== null && {
      parentRefs: JSON.parse(row.parent_refs) as ArtifactRef[],
    }),
  });

  // Port methods are `async` so every refusal arrives as a rejection — the
  // sqliteSessions law about not needing two error handlers.
  return {
    journalMode,

    async put(scope, input): Promise<ArtifactPutResult> {
      open('store an artifact');
      const ns = identityNamespace(scope);
      const at = now();
      const { meta } = await prepareArtifact(
        input,
        (parent) => liveRow(ns, parent) !== undefined,
        retention,
        at,
      );
      const held = selectScope.all(ns) as {
        ref: string;
        kind: string;
        bytes: number;
        expires_at: number | null;
        last_accessed_at: number;
      }[];
      const rows: RetainedRow[] = held.map((r) => ({
        ref: r.ref,
        kind: r.kind,
        bytes: r.bytes,
        ...(r.expires_at !== null && { expiresAt: r.expires_at }),
        lastAccessedAt: r.last_accessed_at,
      }));
      const plan = planRetention(rows, meta.bytes, retention, at);
      if (plan.refusal !== undefined) throw new InvalidArtifactError(plan.refusal);
      for (const swept of plan.swept) remove.run(ns, swept.ref);
      const payload = encodeArtifactData(input.data);
      insert.run(
        ns,
        meta.ref,
        meta.kind,
        meta.mediaType,
        meta.bytes,
        meta.label ?? null,
        meta.digest ?? null,
        meta.expiresAt ?? null,
        meta.origin !== undefined ? JSON.stringify(meta.origin) : null,
        meta.parentRefs !== undefined ? JSON.stringify(meta.parentRefs) : null,
        meta.createdAt,
        at,
        payload.shape,
        payload.value,
      );
      return { meta, swept: plan.swept };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async head(scope, ref): Promise<ArtifactMeta | null> {
      open('describe an artifact');
      const ns = identityNamespace(scope);
      const row = liveRow(ns, ref);
      if (row === undefined) return null;
      touch.run(now(), ns, ref);
      return metaOf(row);
    },

    async get(scope, ref): Promise<ArtifactRecord | null> {
      open('read an artifact');
      const ns = identityNamespace(scope);
      const row = liveRow(ns, ref);
      if (row === undefined) return null;
      touch.run(now(), ns, ref);
      const data = decodeArtifactData({ shape: row.payload_shape, value: row.payload });
      if (row.digest !== null) {
        const actual = await computeArtifactDigest(data);
        if (actual !== row.digest) throw new ArtifactIntegrityError(row.ref, row.digest, actual);
      }
      return { meta: metaOf(row), data };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async delete(scope, ref): Promise<void> {
      open('delete an artifact');
      if (!isArtifactRef(ref)) return;
      remove.run(identityNamespace(scope), ref);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async list(scope, listOptions?: ArtifactListOptions): Promise<ArtifactListResult> {
      open('list artifacts');
      const ns = identityNamespace(scope);
      const at = now();
      const offset = decodeCursor(listOptions?.cursor);
      const limit = Math.max(1, Math.floor(listOptions?.limit ?? 50));
      // Ask for one extra row: "is there another page?" answered by the data.
      // Expired rows are FILTERED here, not deleted — deleting mid-walk would
      // shift every later offset and silently skip rows; the actual sweep
      // happens where single rows are touched (put / head / get).
      const rows = selectPage.all(ns, limit + 1, offset) as ArtifactRow[];
      const artifacts: ArtifactMeta[] = [];
      let consumed = 0;
      for (const row of rows) {
        consumed++;
        if (row.expires_at !== null && row.expires_at <= at) continue;
        artifacts.push(metaOf(row));
        if (artifacts.length === limit) break;
      }
      // More pages when rows were fetched but not walked (early break), or the
      // over-fetch proved the table extends past this window. A final page that
      // turns out empty is a valid cursor outcome, not an error.
      const more = consumed < rows.length || rows.length === limit + 1;
      return {
        artifacts,
        ...(more && { cursor: String(offset + consumed) }),
      };
    },

    close(): void {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

// ─── Internals (the sqliteSessions liturgy, per store) ───────────────

function loadSqlite(): SqliteArtifactsModuleLike {
  try {
    const mod = lazyRequire<{ DatabaseSync: SqliteArtifactsModuleLike }>('node:sqlite');
    if (typeof mod?.DatabaseSync !== 'function') {
      throw new Error('the module loaded but has no DatabaseSync');
    }
    return mod.DatabaseSync;
  } catch (err) {
    throw new SqliteUnavailableError(nodeVersion(), describe(err));
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

function applyPragmas(db: SqliteArtifactsDatabaseLike, busyTimeoutMs: number): string {
  const row = db.prepare('PRAGMA journal_mode = WAL').get() as
    | { journal_mode?: unknown }
    | undefined;
  const waitMs = Number.isFinite(busyTimeoutMs) ? Math.max(0, Math.floor(busyTimeoutMs)) : 5000;
  db.exec(`PRAGMA busy_timeout = ${waitMs}`);
  db.exec('PRAGMA synchronous = NORMAL');
  return typeof row?.journal_mode === 'string' ? row.journal_mode : 'unknown';
}

function ensureSchema(db: SqliteArtifactsDatabaseLike, file: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${ARTIFACTS_TABLE} (` +
      `scope_ns TEXT NOT NULL, ref TEXT NOT NULL, kind TEXT NOT NULL, ` +
      `media_type TEXT NOT NULL, bytes INTEGER NOT NULL, label TEXT, digest TEXT, ` +
      `expires_at INTEGER, origin TEXT, parent_refs TEXT, created_at INTEGER NOT NULL, ` +
      `last_accessed_at INTEGER NOT NULL, payload_shape TEXT NOT NULL, payload TEXT NOT NULL, ` +
      `PRIMARY KEY (scope_ns, ref)) STRICT`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
  );

  const columns = (
    db.prepare(`PRAGMA table_info('${ARTIFACTS_TABLE}')`).all() as { name?: unknown }[]
  ).map((c) => String(c.name));
  const missing = ARTIFACT_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    throw new UnreadableArtifactStoreError(
      file,
      'not-our-schema',
      `it has an '${ARTIFACTS_TABLE}' table that is not this store's ` +
        `(missing ${missing.join(', ')}; found ${columns.join(', ') || 'nothing'}).`,
    );
  }

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
    throw new UnreadableArtifactStoreError(
      file,
      'newer-schema',
      `it was written with schema version ${String(stored.value)} and this runtime reads ` +
        `version ${SCHEMA_VERSION}.`,
    );
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

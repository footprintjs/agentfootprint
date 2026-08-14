/**
 * hosting/sqliteSessions — conversations in a file, so a restart is not an
 * amnesia event.
 *
 * `memorySessions()` keeps conversations in a `Map` and says what that costs in
 * its own docstring: restart the process and every conversation is gone. Until
 * now the next step up was "bring a Redis", and the step between those two —
 * *one machine, one file, nothing to install* — was a store every consumer had
 * to write for themselves. This is that store.
 *
 * A paused run was in the same position from the other direction. `agent.run()`
 * hands back a checkpoint that is documented as JSON you can keep anywhere, and
 * "anywhere" was the whole of the offer: the library named a shape and left the
 * keeping to you. Both halves land in the same table here, because
 * {@link CheckpointEnvelope} was already a union of the two and a session store
 * has no business caring which one it is holding.
 *
 * ── What this is, said plainly ──────────────────────────────────────────────
 * **One process on one machine, writing one file.** That is the whole claim,
 * and it is worth stating as a ceiling rather than leaving it to be discovered:
 *
 *   • It survives a restart, a crash, a deploy — anything that ends the process
 *     and leaves the disk alone.
 *   • It is NOT a distributed store. Two machines do not share a session by
 *     both opening this file over a network filesystem, and nothing here tries
 *     to make that work.
 *   • WAL lets readers and one writer run at once, and **one writer at a time
 *     is the ceiling** — a second writer waits for the lock up to
 *     `busyTimeoutMs` and then fails loudly rather than queueing forever.
 *     Several processes on one box is fine at that scale; a fleet is not what
 *     this is.
 *
 * When you outgrow it you swap the one argument to `standingAgent`, which is
 * the entire point of the port.
 *
 * ── Zero dependencies, and the version floor that buys ──────────────────────
 * SQLite is *inside Node* — `node:sqlite`, no install, no native build, no
 * peer dependency. The price is a version floor this package does not otherwise
 * have: the module ships with Node 22.5 and newer. Rather than raise `engines`
 * for one optional adapter and break every consumer on Node 20, the module is
 * loaded when you actually construct a store, and its absence is refused by
 * name with the version you are on and what to do about it — see
 * {@link SqliteUnavailableError}. There is deliberately **no fallback to
 * memory**: a store that silently forgot everything on restart is
 * indistinguishable, from the outside, from a brand-new user.
 *
 * ── The two laws it inherits rather than re-implements ──────────────────────
 * `checkEnvelope` is called on the way out AND on the way in, so an envelope
 * whose `format` this runtime does not know is refused by name, and a stored
 * session that is PRESENT but unreadable is refused by name too. Only a session
 * that was never written hydrates as `undefined`. Validating on the way in as
 * well is the cheap half of that promise: a row this store could not read back
 * never gets written in the first place.
 */

import { checkEnvelope, envelopeOwner, envelopeTranscript } from './envelope.js';
import { UnreadableEnvelopeError } from './errors.js';
import { resolveSessionOwner } from './sessionOwnership.js';
import { lazyRequire } from '../lib/lazyRequire.js';
import { SqliteUnavailableError } from '../lib/sqliteUnavailable.js';
import type {
  CheckpointEnvelope,
  SessionLifecycle,
  SessionListOptions,
  SessionListPage,
} from './types.js';

// ─── The little bit of `node:sqlite` this adapter uses ───────────────

/** One prepared statement, as this adapter calls it. */
export interface SqliteStatementLike {
  run(...params: readonly unknown[]): unknown;
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown[];
}

/** One open database, as this adapter calls it. */
export interface SqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

/**
 * The shape of `node:sqlite` this adapter needs — declared locally, the same
 * way every other adapter here declares the slice of its backend it uses, so
 * nothing takes a hard import on a module that does not exist on every
 * supported Node.
 */
export interface SqliteModuleLike {
  new (path: string): SqliteDatabaseLike;
}

// ─── Options and the store ───────────────────────────────────────────

/** Options for {@link sqliteSessions}. */
export interface SqliteSessionsOptions {
  /**
   * The database file. Created if it does not exist, along with its parent
   * directory — "no infrastructure" would be a thin promise if you still had to
   * `mkdir` first.
   *
   * `':memory:'` is refused: it looks like a file, keeps nothing across a
   * restart, and a store that quietly forgets is the exact failure this adapter
   * exists to remove. Use `memorySessions()` when that is what you want — it
   * says so in its name.
   */
  readonly file: string;
  /**
   * How long a write waits for another writer's lock before failing, in
   * milliseconds. Default 5000.
   *
   * It fails rather than waits forever on purpose: a request hung on a lock
   * looks exactly like a slow model, and the two need different fixes.
   */
  readonly busyTimeoutMs?: number;
  /**
   * @internal Test seam only — the `node:sqlite` module, injected. Lets the
   * suite exercise the refusal path on a Node that HAS the module, and the
   * failure paths without corrupting a real file. Not public API, not
   * supported, and not a place to plug in another SQLite driver.
   */
  readonly _sqlite?: SqliteModuleLike;
}

/**
 * A session store in a file.
 *
 * It is a {@link SessionLifecycle} plus the three things a real store owns
 * beyond the port — closing, forgetting, and telling you what the file actually
 * got — because the port deliberately asks for only two methods and leaves the
 * rest to whoever implements it.
 */
export interface SqliteSessions extends SessionLifecycle {
  /**
   * The journalling mode the file **actually has**, read back from SQLite
   * rather than assumed from what was asked for.
   *
   * It is normally `'wal'`. It is something else when the file lives somewhere
   * WAL cannot work — a network filesystem is the usual reason — and that is a
   * fact worth being able to read: the store still works, with one writer *or*
   * one reader at a time instead of both. A silent downgrade is the kind of
   * thing that is only ever discovered under load.
   */
  readonly journalMode: string;
  /** Forget one session. No-op if there is nothing stored for it. */
  forget(sessionId: string): Promise<void>;
  /**
   * Close the file. Idempotent — a shutdown hook and an explicit close can
   * coexist. Reading or writing afterwards refuses by name rather than
   * reopening behind your back.
   */
  close(): void;
}

// ─── The refusals ────────────────────────────────────────────────────

/**
 * Raised when `node:sqlite` is not available in the running Node.
 *
 * The class moved to `lib/sqliteUnavailable.ts` in 8.9.0 so the SQLite vector
 * store raises the SAME error for the same missing module — a consumer
 * catching it should not have to know which of our stores was being built.
 * Constructed with no third argument it produces exactly the message it always
 * did, and it is re-exported here under its own name, so nothing that imports
 * it from this module changes.
 */
export { SqliteUnavailableError } from '../lib/sqliteUnavailable.js';

/**
 * Raised when the file exists but this runtime cannot use it as a session
 * store.
 *
 * The same law {@link UnreadableEnvelopeError} states for one stored value,
 * one level up: **an unreadable store and an empty one are different facts, and
 * only one of them is safe to answer with a fresh start.** A store that opened
 * a corrupt file as an empty database would hand every returning user a blank
 * slate and log nothing.
 *
 * `problem` is the fact to branch on — the three cases need different actions:
 *
 *  - `'cannot-open'` — not a SQLite database, or not readable (permissions, a
 *    directory, a truncated file).
 *  - `'not-our-schema'` — a database whose `agent_sessions` table is somebody
 *    else's table of that name. Point the store at its own file.
 *  - `'newer-schema'` — written by a newer agentfootprint than this one. Same
 *    answer the envelope `format` field gives: refuse, never half-read.
 */
export class UnreadableSessionFileError extends Error {
  readonly code = 'ERR_UNREADABLE_SESSION_FILE' as const;
  /** The file that was refused. */
  readonly file: string;
  /** Which of the three cases this is. */
  readonly problem: 'cannot-open' | 'not-our-schema' | 'newer-schema';

  constructor(file: string, problem: UnreadableSessionFileError['problem'], detail: string) {
    super(
      `[hosting] the session store at '${file}' cannot be used: ${detail} ` +
        `An unreadable store and an empty one are different facts, and only one of them ` +
        `is safe to answer with a fresh start — so this refuses rather than quietly ` +
        `beginning every conversation again on top of a file that already exists. ` +
        (problem === 'newer-schema'
          ? `A store written by a newer agentfootprint needs a runtime that knows that ` +
            `schema; roll forward, or point this one at its own file.`
          : problem === 'not-our-schema'
          ? `Give the store a file of its own rather than sharing one with tables of ` +
            `the same name.`
          : `Check the path and its permissions, or move the file aside to start a ` + `new one.`),
    );
    this.name = 'UnreadableSessionFileError';
    this.file = file;
    this.problem = problem;
  }
}

// ─── The schema ──────────────────────────────────────────────────────

/**
 * What this runtime writes. Bumped only for a change an older reader could not
 * survive — and an older reader meeting a newer number refuses by name rather
 * than reading what it half-understands, which is the same rule the envelope's
 * `format` field follows.
 */
const SCHEMA_VERSION = 1;

const SESSIONS_TABLE = 'agent_sessions';
const META_TABLE = 'agent_store_meta';

/**
 * `format` and `saved_at` are COLUMNS as well as fields inside the JSON, and
 * that redundancy is deliberate: it makes the file answer "which sessions are
 * waiting on a person, and since when?" from the `sqlite3` command line during
 * an incident, without a JSON parser and without this library. A store you
 * cannot inspect with the tools already on the box is a store you debug by
 * guessing.
 */
const SESSIONS_COLUMNS = ['session_id', 'format', 'saved_at', 'envelope'] as const;

/**
 * The owner index (9.26.0) — two columns ADDED to the same table, and the
 * schema version deliberately NOT bumped.
 *
 * Bumping is for "an older reader could not survive this", and an older reader
 * survives these perfectly: it names its four columns explicitly in both its
 * `INSERT` and its `SELECT`, so two extra nullable columns are invisible to it.
 * Refusing a 9.25 file for missing them would be the opposite mistake — the
 * identity check above stays the ORIGINAL four, and a file that predates this
 * release is opened, migrated with one `ALTER TABLE` per column, and used.
 *
 * What such a file does NOT have is owners for its EXISTING rows: nothing was
 * recorded when they were written, and deriving them would mean parsing every
 * stored envelope on open. Those sessions appear in nobody's list until their
 * next turn re-persists them. Stated rather than papered over, because a
 * sidebar that silently omits last week's conversations is a bug report and a
 * documented migration boundary is not.
 */
const OWNER_COLUMNS: readonly { name: string; ddl: string }[] = [
  { name: 'owner', ddl: 'owner TEXT' },
  { name: 'message_count', ddl: 'message_count INTEGER' },
];

// ─── The store ───────────────────────────────────────────────────────

/**
 * A session store in one SQLite file — the battery-included place to keep a
 * conversation, or a run that stopped to ask a person something, so that a
 * restart does not lose it.
 *
 * @throws SqliteUnavailableError when the running Node has no `node:sqlite`.
 * @throws UnreadableSessionFileError when the file exists but cannot be used —
 *   never answered with an empty store.
 *
 * @example  A standing agent whose conversations survive a restart
 *   import { standingAgent, nodeHost, sqliteSessions } from 'agentfootprint/hosting';
 *
 *   const handle = await standingAgent({
 *     agent,
 *     sessions: sqliteSessions({ file: './sessions.db' }),
 *     host: nodeHost({ port: 8080 }),
 *   });
 *
 * @example  Keeping a paused run yourself, without the composer
 *   const sessions = sqliteSessions({ file: './sessions.db' });
 *   const out = await agent.run({ message });
 *   if (isPaused(out)) {
 *     await sessions.persist(sessionId, toPausedEnvelope({
 *       checkpoint: out.checkpoint,
 *       conversation: agent.checkpoint()!,
 *       pending: { pauseData: out.pauseData },
 *     }));
 *   }
 *   // …a deploy later, in a new process:
 *   const paused = readPausedRun(await sessions.hydrate(sessionId));
 *   const answer = await agent.resume(paused.checkpoint, decision);
 */
export function sqliteSessions(options: SqliteSessionsOptions): SqliteSessions {
  const { file, busyTimeoutMs = 5000 } = options;

  if (file === ':memory:' || file.trim() === '') {
    throw new TypeError(
      `[hosting] sqliteSessions({ file: '${file}' }) is not a durable store. ` +
        `':memory:' looks like a file and keeps nothing across a restart, which is the ` +
        `one thing this adapter exists to do. Use memorySessions() when an in-process ` +
        `store is what you want — it says so in its name — or give this one a real path.`,
    );
  }

  const DatabaseSync = options._sqlite ?? loadSqlite();
  ensureParentDirectory(file);

  let db: SqliteDatabaseLike;
  try {
    db = new DatabaseSync(file);
  } catch (err) {
    throw new UnreadableSessionFileError(file, 'cannot-open', `${describe(err)}.`);
  }

  let journalMode: string;
  try {
    journalMode = applyPragmas(db, busyTimeoutMs);
    ensureSchema(db, file);
  } catch (err) {
    db.close();
    if (err instanceof UnreadableSessionFileError) throw err;
    throw new UnreadableSessionFileError(file, 'cannot-open', `${describe(err)}.`);
  }

  const insert = db.prepare(
    `INSERT INTO ${SESSIONS_TABLE} (session_id, format, saved_at, envelope, owner, message_count) ` +
      `VALUES (?, ?, ?, ?, ?, ?) ` +
      `ON CONFLICT(session_id) DO UPDATE SET format = excluded.format, ` +
      `saved_at = excluded.saved_at, envelope = excluded.envelope, ` +
      // The owner is bound, already decided — NOT `COALESCE(sessions.owner,
      // excluded.owner)`, which is what this was until 9.36.1.
      //
      // COALESCE kept the right owner and could not refuse, so a turn signed
      // by somebody else quietly won the `envelope` column beside an `owner`
      // column that still named the first writer: the index said one person
      // and the stored conversation said another. SQL that can only pick a
      // column cannot express "and if they disagree, write nothing" — so the
      // decision moved out of the statement and into `resolveSessionOwner`,
      // one transaction up, where a refusal can stop the whole row.
      `owner = excluded.owner, ` +
      `message_count = excluded.message_count`,
  );
  const select = db.prepare(`SELECT envelope FROM ${SESSIONS_TABLE} WHERE session_id = ?`);
  const remove = db.prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE session_id = ?`);
  const selectOwner = db.prepare(`SELECT owner FROM ${SESSIONS_TABLE} WHERE session_id = ?`);
  // Keyset pagination, not OFFSET: a cursor that counted rows would skip a
  // conversation whenever an older one is written to between two pages, and a
  // sidebar that quietly loses a row is worse than one that pages slowly.
  const listOwned = db.prepare(
    `SELECT session_id, format, saved_at, message_count FROM ${SESSIONS_TABLE} ` +
      `WHERE owner = ? AND (saved_at < ? OR (saved_at = ? AND session_id > ?)) ` +
      `ORDER BY saved_at DESC, session_id ASC LIMIT ?`,
  );

  let closed = false;
  const open = (verb: string): void => {
    if (closed) {
      throw new Error(
        `[hosting] the sqliteSessions store at '${file}' is closed, so it cannot ${verb}. ` +
          `close() is final by design — reopening the file behind you would hide a ` +
          `shutdown-ordering bug rather than surface it. Build a new store if you need ` +
          `one after closing this.`,
      );
    }
  };

  // The three port methods are `async` so that every refusal in them arrives
  // as a REJECTION. A method that returns a promise on the happy path and
  // throws synchronously on the sad one is a method whose callers need two
  // error handlers, and the one they forget is the one that fires at 3am.
  return {
    journalMode,

    // eslint-disable-next-line @typescript-eslint/require-await
    async hydrate(sessionId: string): Promise<CheckpointEnvelope | undefined> {
      open('hydrate a session');
      const row = select.get(sessionId) as { envelope?: unknown } | undefined;
      if (row === undefined) return undefined;

      const stored = row.envelope;
      if (typeof stored !== 'string') {
        // A row exists and its payload is not even text. Present, unreadable —
        // and specifically NOT `undefined`.
        throw new UnreadableEnvelopeError(stored, sessionId);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stored);
      } catch {
        // Bytes written by something that was not this store. Same fact, same
        // refusal: a conversation EXISTS here and this runtime cannot see it.
        throw new UnreadableEnvelopeError(stored, sessionId);
      }
      // Validate HERE as well as in the composer, so the refusal points at the
      // store that produced the bytes rather than at whoever read them next.
      return checkEnvelope(parsed, sessionId);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async persist(sessionId: string, envelope: CheckpointEnvelope): Promise<void> {
      open('persist a session');
      // Checked on the way IN as well as out: a row this store could not read
      // back is a row it has no business writing.
      const checked = checkEnvelope(envelope, sessionId);
      // The owner index (9.26.0): DERIVED from the conversation's own identity,
      // never supplied by the caller — the port takes no owner argument and
      // gains none, because a store where owning a session is a matter of
      // asking is not an index, it is a formality.
      const incoming = envelopeOwner(checked);
      // BEGIN IMMEDIATE, not BEGIN: it takes the write lock up front, so the
      // read below and the write after it cannot have another writer's turn
      // between them. A deferred transaction would take the lock only at the
      // INSERT — which is exactly the window where two containers persisting
      // the same fresh session both read "nobody owns this" and both proceed.
      // The lock waits `busy_timeout` and then fails loudly, which is the same
      // bargain the rest of this store makes.
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = selectOwner.get(sessionId) as { owner?: unknown } | undefined;
        const owner = resolveSessionOwner(
          sessionId,
          typeof existing?.owner === 'string' ? existing.owner : undefined,
          incoming,
        );
        insert.run(
          sessionId,
          checked.format,
          checked.savedAt,
          JSON.stringify(checked),
          owner ?? null,
          envelopeTranscript(checked).length,
        );
        db.exec('COMMIT');
      } catch (err) {
        // The envelope must not land when the owner was refused — the payload
        // is the half that carries somebody's conversation, and a row that
        // kept the old owner beside a new conversation is the whole defect.
        // ROLLBACK is best-effort: if the transaction is already gone the
        // original refusal is the one worth raising, not this one.
        try {
          db.exec('ROLLBACK');
        } catch {
          /* Already rolled back or never opened; the error below says why. */
        }
        throw err;
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async listByUser(userId: string, options?: SessionListOptions): Promise<SessionListPage> {
      open('list a user’s sessions');
      const limit = Math.max(1, Math.floor(options?.limit ?? DEFAULT_PAGE));
      const after = parseCursor(options?.cursor);
      const rows = listOwned.all(
        userId,
        after.savedAt,
        after.savedAt,
        after.sessionId,
        // One extra row, so "is there another page?" is a fact rather than a
        // guess from a full page.
        limit + 1,
      ) as {
        session_id?: unknown;
        format?: unknown;
        saved_at?: unknown;
        message_count?: unknown;
      }[];
      const page = rows.slice(0, limit).map((row) => ({
        sessionId: String(row.session_id),
        savedAt: Number(row.saved_at),
        format: String(row.format),
        // A row written before this release has no count. `0` is the honest
        // answer for "this store does not know" here only because the
        // transcript op reads the envelope itself and will say the truth —
        // the count is a listing hint, never the authority.
        messageCount: typeof row.message_count === 'number' ? row.message_count : 0,
      }));
      const last = page[page.length - 1];
      return {
        sessions: page,
        ...(rows.length > limit &&
          last !== undefined && { cursor: `${last.savedAt}:${last.sessionId}` }),
      };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async ownerOf(sessionId: string): Promise<string | undefined> {
      open('read a session’s owner');
      const row = selectOwner.get(sessionId) as { owner?: unknown } | undefined;
      // `undefined` for "no such session" AND for "a session nobody signed
      // for" — the deliberate ambiguity the composer's one not-found rests on.
      return typeof row?.owner === 'string' && row.owner.length > 0 ? row.owner : undefined;
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async forget(sessionId: string): Promise<void> {
      open('forget a session');
      remove.run(sessionId);
    },

    close(): void {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

// ─── Internals ───────────────────────────────────────────────────────

/**
 * Load `node:sqlite`, or refuse by name.
 *
 * `lazyRequire` keeps the specifier away from bundler static analysis, so
 * importing `agentfootprint/hosting` costs nothing for the consumers — the vast
 * majority — who never construct one of these.
 */
function loadSqlite(): SqliteModuleLike {
  try {
    const mod = lazyRequire<{ DatabaseSync: SqliteModuleLike }>('node:sqlite');
    if (typeof mod?.DatabaseSync !== 'function') {
      throw new Error('the module loaded but has no DatabaseSync');
    }
    return mod.DatabaseSync;
  } catch (err) {
    throw new SqliteUnavailableError(nodeVersion(), describe(err));
  }
}

/** The version string, without assuming `process` exists. */
function nodeVersion(): string {
  return typeof process !== 'undefined' && typeof process.version === 'string'
    ? process.version
    : 'unknown';
}

/**
 * Create the file's directory if it is missing — "no infrastructure" should not
 * mean "except for one `mkdir`". A failure here is left to the open call, which
 * reports it with the path in the same words as every other open failure.
 */
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
 * `journal_mode` is the first statement executed on purpose: it is the point at
 * which SQLite reads the file header, so "this is not a database" surfaces here,
 * at construction, where the caller can still do something about it — rather
 * than on the first request of the night.
 */
function applyPragmas(db: SqliteDatabaseLike, busyTimeoutMs: number): string {
  const row = db.prepare('PRAGMA journal_mode = WAL').get() as
    | { journal_mode?: unknown }
    | undefined;
  // A pragma takes a literal, not a bound parameter, so the number is coerced
  // to one before it reaches the statement rather than trusted to be one.
  const waitMs = Number.isFinite(busyTimeoutMs) ? Math.max(0, Math.floor(busyTimeoutMs)) : 5000;
  db.exec(`PRAGMA busy_timeout = ${waitMs}`);
  // NORMAL, not FULL: with WAL that is durable across a process crash — which
  // is what this store promises — and it does not pay a disk sync per turn.
  // A power cut can still cost the most recent commits; a fleet-grade store is
  // the answer to that, not a pragma.
  db.exec('PRAGMA synchronous = NORMAL');
  return typeof row?.journal_mode === 'string' ? row.journal_mode : 'unknown';
}

/** Create the two tables if they are missing, and refuse a file that is not ours. */
function ensureSchema(db: SqliteDatabaseLike, file: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (` +
      `session_id TEXT PRIMARY KEY, format TEXT NOT NULL, ` +
      `saved_at INTEGER NOT NULL, envelope TEXT NOT NULL, ` +
      `owner TEXT, message_count INTEGER) STRICT`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
  );

  // `CREATE TABLE IF NOT EXISTS` succeeds against somebody else's table of the
  // same name, and the failure would otherwise arrive as a confusing constraint
  // error on the first write.
  const columns = (
    db.prepare(`PRAGMA table_info('${SESSIONS_TABLE}')`).all() as {
      name?: unknown;
    }[]
  ).map((c) => String(c.name));
  const missing = SESSIONS_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    throw new UnreadableSessionFileError(
      file,
      'not-our-schema',
      `it has a '${SESSIONS_TABLE}' table that is not this store's ` +
        `(missing ${missing.join(', ')}; found ${columns.join(', ') || 'nothing'}).`,
    );
  }

  // The additive migration — see OWNER_COLUMNS for why this is not a version
  // bump. Idempotent by construction (each column is added only when absent),
  // so opening the same file twice is one migration, and opening a file this
  // release already created does nothing at all.
  for (const column of OWNER_COLUMNS) {
    if (columns.includes(column.name)) continue;
    db.exec(`ALTER TABLE ${SESSIONS_TABLE} ADD COLUMN ${column.ddl}`);
  }
  // Owner-scoped listings read `WHERE owner = ? ORDER BY saved_at DESC`; the
  // index is what keeps a person's sidebar from scanning every conversation
  // the process ever stored.
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${SESSIONS_TABLE}_owner ` +
      `ON ${SESSIONS_TABLE} (owner, saved_at DESC)`,
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
    throw new UnreadableSessionFileError(
      file,
      'newer-schema',
      `it was written with schema version ${String(stored.value)} and this runtime ` +
        `reads version ${SCHEMA_VERSION}.`,
    );
  }
}

/** One sentence about a thrown thing, for a message that has to stay readable. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** How many rows one `listByUser` page carries when the caller names no limit. */
const DEFAULT_PAGE = 50;

/**
 * Read a listing cursor — `<savedAt>:<sessionId>`, the last row of the previous
 * page.
 *
 * A cursor this store did not mint (a truncation, a hand-edit, a client that
 * kept one across a schema change) restarts at the top rather than throwing:
 * the worst case is a caller seeing page one twice, and refusing a listing
 * because a pagination token went stale would break a sidebar over something
 * that costs nothing to recover from.
 */
function parseCursor(cursor: string | undefined): { savedAt: number; sessionId: string } {
  const TOP = { savedAt: Number.MAX_SAFE_INTEGER, sessionId: '' };
  if (cursor === undefined) return TOP;
  const at = cursor.indexOf(':');
  if (at <= 0) return TOP;
  const savedAt = Number.parseInt(cursor.slice(0, at), 10);
  if (!Number.isFinite(savedAt)) return TOP;
  return { savedAt, sessionId: cursor.slice(at + 1) };
}

/**
 * firestoreSessions — conversations in Firestore, so a fleet shares them and
 * nobody runs a database.
 *
 * The ladder this rung sits on is already in the package. `memorySessions()`
 * loses everything on restart and says so. `sqliteSessions()` survives a restart
 * on ONE machine and says so. `agentEngineSessions()` is a fleet store, but only
 * for people who already own a Vertex reasoning engine. Firestore is the row for
 * everyone else on this column: a serverless document database with no instance
 * to size, no connection pool to tune, and a free tier — the plainest "many
 * containers, one conversation" answer Google has.
 *
 * ── The shape, said plainly ─────────────────────────────────────────────────
 * One collection. One document per session. Six fields:
 *
 *   sessionId · format · savedAt · envelope · owner · messageCount
 *
 * That is the SQLite table, moved. It is deliberately the same shape, because
 * the two stores implement the same port under the same laws, and a reader who
 * has understood one should not have to learn a second model to audit the other.
 *
 * The envelope rides as a JSON **string**, not as a nested map, and that is a
 * decision rather than laziness. A `CheckpointEnvelope` carries arbitrary
 * conversation JSON: keys chosen by a model's tool call, values that may be
 * `undefined`, arrays inside arrays. Firestore refuses all three — a field name
 * may not contain a dot, a tilde, a star, a slash, a bracket or a backtick;
 * `undefined` throws unless the client was
 * built with `ignoreUndefinedProperties`, and a directly nested array is not a
 * representable value. Serialising once at the edge makes every one of those a
 * non-event, at the cost of not being able to query INSIDE a conversation —
 * which no caller of this port has ever asked to do.
 *
 * ── Why the document id is a hash ───────────────────────────────────────────
 * A `sessionId` in this library is OPAQUE. It may be a UUID, an upstream
 * gateway's correlation id, a path-shaped tenant key, or a unicode string a
 * person typed. Firestore document names have rules: no `/`, not `.` or `..`,
 * not matching `__.*__`, and at most 1500 bytes. A session id that broke any of
 * them would fail at the wire on the one turn it mattered — or worse, two ids
 * that differ only past a truncation point would silently become ONE
 * conversation.
 *
 * So the document name is `sha256(domain + NUL + sessionId)` in hex — 64
 * characters, always legal, injective for every input anybody will ever have.
 * The raw id is stored in the `sessionId` FIELD, so a listing can hand it back
 * and a console reader can still see whose document they are looking at.
 *
 * **This is not encryption, and it is important not to read it as any.** The
 * conversation itself is stored in the clear; the hash is an addressing scheme,
 * not a confidentiality control. Anyone who can read the collection can read
 * every conversation in it, and the `sessionId` field beside the hash spells out
 * the id the hash was made from. Two things it DOES cost an operator, stated
 * because they are discovered at the worst moment otherwise:
 *
 *   • you cannot look a session up in the Firestore console by typing its raw
 *     id — you have to query `sessionId == '…'`, or hash it yourself;
 *   • a document name carries no information a human can sort or scan by.
 *
 * Encryption at rest is Google's (always on, and configurable with CMEK).
 * Access control is IAM's. Neither is this adapter's, and neither is implied by
 * the hash.
 *
 * ── The composite index, and the error you get without it ───────────────────
 * `listByUser` runs one server-side query — an equality on `owner`, ordered by
 * `savedAt` descending, paged with a real Firestore cursor. Firestore's
 * automatic single-field indexes do NOT serve that shape: an equality filter on
 * one field ordered by another needs a COMPOSITE index, and until it exists the
 * query fails with gRPC status 9, `FAILED_PRECONDITION`.
 *
 * The index, exactly:
 *
 *   collection group : <your collection>   (default: agentfootprint_sessions)
 *   fields           : owner    Ascending
 *                      savedAt  Descending
 *                      __name__ Descending
 *
 * `__name__` is Firestore's document-name field. It is the tiebreaker this
 * adapter orders by explicitly (see {@link FirestoreSessions.listByUser}), and
 * an index's trailing `__name__` takes the direction of the last ordered field —
 * so a console-generated index for `owner ASC, savedAt DESC` is the right one.
 *
 *   gcloud firestore indexes composite create \
 *     --collection-group=agentfootprint_sessions \
 *     --field-config=field-path=owner,order=ascending \
 *     --field-config=field-path=savedAt,order=descending \
 *     --database='(default)'
 *
 * `--database` is spelled out rather than left to gcloud's default, and it must
 * match the `database` this store was built with. gcloud assumes `(default)` when
 * the flag is absent, so an operator on a NAMED database who follows a command
 * without it creates the index somewhere else and gets the identical failure
 * back, with nothing to suggest why.
 *
 * When the index is missing this adapter raises {@link FirestoreIndexMissingError},
 * which prints that same line with your collection and database already filled
 * in, and names those fields rather than restating the service's message — see
 * {@link firestoreFailure} for why no Google text is ever echoed here.
 *
 * ── The ceiling, since a store should name its own ──────────────────────────
 * A Firestore document is capped at 1 MiB. A conversation whose stored envelope
 * approaches that is refused BY NAME before the write
 * ({@link EnvelopeTooLargeError}) rather than being sent and rejected as an
 * opaque `INVALID_ARGUMENT`. Nothing is ever truncated: half a conversation
 * stored as if it were whole is the failure this whole file exists to avoid.
 * Compaction (the builder's `.compaction({ … })`, or `.window()`) is the
 * answer, and the refusal says so. Named from the builder deliberately: there
 * is no `agent.compact()` to call, and a doc comment ships into the emitted
 * `.d.ts`, so a method named here that does not exist is a method somebody
 * types on hover.
 *
 * ── The laws it inherits rather than re-implements ──────────────────────────
 * `checkEnvelope` runs on the way OUT and on the way IN, so an envelope whose
 * `format` this runtime does not know is refused by name, and a session that is
 * PRESENT but unreadable is refused by name too. Only a session that was never
 * written hydrates as `undefined`. A conversation that exists and cannot be read
 * must never be answered with a fresh start — from the outside that is
 * indistinguishable from a brand-new user.
 *
 * Ownership is DERIVED from the stored envelope and established ONCE. See
 * `persist` below: SQLite gets that from `COALESCE(sessions.owner,
 * excluded.owner)`, Firestore has no such thing, and a `set({ merge: true })`
 * would let the last writer win — which is exactly the bug, not a workaround
 * for it. So the write is a transaction.
 *
 * ── How much of this is verified ────────────────────────────────────────────
 * **Contract-shaped and tested. NOT field-validated.** Nothing here has been run
 * against a live Firestore by this repository.
 *
 * The pin is the `firestoreSessions` row of `GOOGLE_SURFACE_PINS` in
 * `test/adapters/google/googlePin.ts`, asserted by
 * `test/adapters/google/google-surface-pin.test.ts`. Its 18 members were
 * hand-verified against a real `@google-cloud/firestore` 9.0.0 install in a
 * scratch project OUTSIDE this repository: seventeen read off
 * `types/firestore.d.ts` before a line of this file was written, and
 * `DocumentSnapshot.id` verified afterwards, when a review found the row had
 * pinned `DocumentReference.id` — real, but a member this adapter never reads —
 * in place of the one the cursor actually reads.
 *
 * That package is deliberately NOT installed here. It depends on
 * `@opentelemetry/api`, so installing it hoists that package to the repository
 * root and disarms `test/observability-providers/otel.test.ts`, which proves
 * `otelObservability()` refuses BY NAME when `@opentelemetry/api` is absent.
 * The consequence has to be said plainly: **the reality assertion — "every
 * pinned member really exists on the real package" — SKIPS in this repository.**
 * It runs in full for anyone who installs `@google-cloud/firestore` locally.
 *
 * So what is machine-checked in CI is the SHAPE pin, not the reality pin: this
 * adapter dispatches exactly the members the row names and no others, every run,
 * everywhere. That the row spells those members the way Google does is held by a
 * hand check against a real install, not by a test that runs here.
 *
 * The DESIGN is informed by an independent field trial of a different Firestore
 * session adapter, which ran against a real Firestore and passed eight ownership
 * and history checks — and whose own report named the defect this adapter does
 * not reproduce: that adapter read every document for one owner, sorted them in
 * the client, and applied an offset cursor. That works until one person has a
 * lot of conversations, and then it costs a full read of all of them per page.
 * What the trial proves is that the ownership and history SEMANTICS survive a
 * real service; it proves nothing about this file's query, cursor, transaction
 * or index, because that adapter had none of them.
 */

import { createHash } from 'node:crypto';

import { checkEnvelope, envelopeOwner, envelopeTranscript } from '../../hosting/envelope.js';
import { SessionOwnershipConflictError, UnreadableEnvelopeError } from '../../hosting/errors.js';
import { resolveSessionOwner } from '../../hosting/sessionOwnership.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import type {
  CheckpointEnvelope,
  SessionLifecycle,
  SessionListOptions,
  SessionListPage,
} from '../../hosting/types.js';

const ADAPTER = 'firestoreSessions';

// ─── The slice of `@google-cloud/firestore` this adapter uses ────────
//
// Declared locally, the way every adapter here declares the part of its backend
// it touches, so nothing takes a hard import on an optional peer dependency.
// Each shape below is the real one, read off the installed `types/firestore.d.ts`
// (9.0.0) — the line references are there so a reader can check rather than
// trust, and so a test double that returns the wrong SHAPE is visibly wrong
// rather than merely convenient.

/** One document as it came back. `firestore.d.ts` line 1605. */
export interface FirestoreDocumentSnapshotLike {
  /** A PROPERTY, not a method — `readonly exists: boolean`. */
  readonly exists: boolean;
  readonly id: string;
  /** `undefined` when the document does not exist. */
  data(): Record<string, unknown> | undefined;
}

/** The answer to a query. `firestore.d.ts` line 2163. */
export interface FirestoreQuerySnapshotLike {
  /**
   * An ARRAY, already materialised. Not an async iterable, not a stream — the
   * SDK has `Query.stream()` for that and this adapter does not use it. A
   * double that hands back an async iterable here would be testing a client
   * nobody ships.
   */
  readonly docs: readonly FirestoreDocumentSnapshotLike[];
}

/** The query builder. Every method is SYNCHRONOUS and returns a NEW query
 *  (the SDK documents the immutability explicitly); only `get` is async.
 *  `firestore.d.ts` line 1714. */
export interface FirestoreQueryLike {
  where(fieldPath: string, opStr: string, value: unknown): FirestoreQueryLike;
  orderBy(fieldPath: string | unknown, directionStr?: 'asc' | 'desc'): FirestoreQueryLike;
  startAfter(...fieldValues: unknown[]): FirestoreQueryLike;
  limit(limit: number): FirestoreQueryLike;
  get(): Promise<FirestoreQuerySnapshotLike>;
}

/** A handle on one document. `firestore.d.ts` line 1436. */
export interface FirestoreDocumentReferenceLike {
  readonly id: string;
  get(): Promise<FirestoreDocumentSnapshotLike>;
  /** Resolves to a `WriteResult`, which this adapter does not read. */
  delete(): Promise<unknown>;
}

/** A collection is a Query that can also mint document handles.
 *  `firestore.d.ts` line 2305. */
export interface FirestoreCollectionLike extends FirestoreQueryLike {
  doc(documentPath: string): FirestoreDocumentReferenceLike;
}

/**
 * The transaction handle. `firestore.d.ts` line 801.
 *
 * The asymmetry is the thing to get right in a double: `get` is ASYNC and
 * answers a snapshot, while `set` is SYNCHRONOUS and answers the transaction
 * itself for chaining. A double whose `set` returned a promise would let an
 * adapter that forgot to sequence its writes pass a test it should fail.
 */
export interface FirestoreTransactionLike {
  get(documentRef: FirestoreDocumentReferenceLike): Promise<FirestoreDocumentSnapshotLike>;
  set(
    documentRef: FirestoreDocumentReferenceLike,
    data: Record<string, unknown>,
  ): FirestoreTransactionLike;
}

/** One connected database. `firestore.d.ts` line 554. */
export interface FirestoreLike {
  collection(collectionPath: string): FirestoreCollectionLike;
  runTransaction<T>(
    updateFunction: (transaction: FirestoreTransactionLike) => Promise<T>,
  ): Promise<T>;
  /** Closes the client's gRPC channels. See {@link FirestoreSessions.close}. */
  terminate(): Promise<void>;
}

/**
 * The two exports this adapter needs from the package.
 *
 * `FieldPath.documentId()` is a STATIC that returns a sentinel; it is how a
 * query orders by document name, and there is no string spelling of it that the
 * client will accept in `orderBy`.
 */
export interface FirestoreConstructorLike {
  new (settings?: Record<string, unknown>): FirestoreLike;
}

/** The module's shape, as this adapter loads it. */
export interface FirestoreSdkModule {
  readonly Firestore: FirestoreConstructorLike;
  readonly FieldPath: { documentId(): unknown };
}

// ─── Options ─────────────────────────────────────────────────────────

/** Options for {@link firestoreSessions}. */
export interface FirestoreSessionsOptions {
  /**
   * The Google Cloud project. Omit and the client reads it from the ambient
   * environment the same way every Google client does (`GCLOUD_PROJECT`, or the
   * Application Default Credentials).
   */
  readonly project?: string;
  /**
   * Which Firestore database in that project. Omit for `'(default)'`.
   *
   * Worth setting deliberately: a project can hold several databases, and
   * "conversations went to the wrong one" looks exactly like "conversations
   * were lost".
   */
  readonly database?: string;
  /**
   * The collection sessions live in. Default
   * {@link DEFAULT_SESSION_COLLECTION}.
   *
   * A top-level collection name, not a path — this adapter does not nest
   * sessions under another document, because a store that required a parent
   * would be making a decision about your data model that the port never asked
   * for.
   */
  readonly collection?: string;
  /**
   * A Firestore client you already built.
   *
   * Most applications that reach for this adapter already have one, and two
   * clients in one process means two sets of gRPC channels for no benefit. When
   * you pass one, this store never terminates it — see
   * {@link FirestoreSessions.close}.
   *
   * Passing this together with `project` or `database` is refused rather than
   * silently ignored: those settings belong to whoever CONSTRUCTED the client,
   * and accepting them here would let a caller believe they had switched
   * databases.
   *
   * It does NOT remove the need for the package to be installed:
   * `FieldPath.documentId()` is a static on the module, and there is no string
   * spelling of `__name__` the client accepts in `orderBy`. In practice that
   * costs nothing — anyone holding a client already has the package — but it is
   * stated rather than discovered, because "I passed my own client, why is it
   * still loading the module?" is a fair question to have answered here.
   */
  readonly firestore?: FirestoreLike;
  /**
   * @internal Test seam only — the `@google-cloud/firestore` module, injected.
   * Lets the suite exercise every path (including the refusals) without a
   * credential or a network. Not public API, and not a place to plug in another
   * Firestore driver.
   */
  readonly _sdk?: FirestoreSdkModule;
}

/** Where sessions live when the caller names no collection. */
export const DEFAULT_SESSION_COLLECTION = 'agentfootprint_sessions';

/** How many rows one `listByUser` page carries when the caller names no limit. */
const DEFAULT_PAGE = 50;

/**
 * Firestore's hard ceiling on one document, in bytes. Not ours — the service's.
 *
 * @see https://cloud.google.com/firestore/quotas
 */
export const FIRESTORE_MAX_DOCUMENT_BYTES = 1_048_576;

/**
 * The largest stored envelope this adapter will attempt, in bytes.
 *
 * Below the real ceiling by a margin, because the document also carries five
 * other fields, their NAMES, and the document's own path — all of which count
 * toward Firestore's total. Refusing a little early with a sentence that says
 * what to do beats sending a 1,048,570-byte envelope and getting back an
 * `INVALID_ARGUMENT` that names nothing.
 */
export const FIRESTORE_MAX_ENVELOPE_BYTES = FIRESTORE_MAX_DOCUMENT_BYTES - 8192;

/**
 * The domain string mixed into every document-name hash.
 *
 * Domain separation, so a `sessionId` and some other identifier that happened to
 * be the same string never produce the same digest anywhere else. It is version
 * -tagged: changing the hash would orphan every stored conversation, so the day
 * that has to happen the tag is what makes it a deliberate migration rather than
 * a silent one.
 */
const DOC_ID_DOMAIN = 'agentfootprint/hosting/firestoreSessions/v1';

// ─── The store ───────────────────────────────────────────────────────

/**
 * A session store in Firestore.
 *
 * A {@link SessionLifecycle} plus the three things a real store owns beyond the
 * port — forgetting, closing, and telling you where it is writing — because the
 * port deliberately asks for two methods and leaves the rest to whoever
 * implements it.
 */
export interface FirestoreSessions extends SessionLifecycle {
  /** The collection these sessions live in. Useful in an incident. */
  readonly collection: string;
  /** Forget one session. A session that was never there is not an error. */
  forget(sessionId: string): Promise<void>;
  /**
   * The document name one session id maps to — the sha-256 above.
   *
   * Exposed because the mapping is one-way and an operator in an incident needs
   * it: this is the string to paste into the Firestore console to find one
   * conversation. It is a pure function, it touches nothing, and it works on a
   * closed store.
   */
  documentIdFor(sessionId: string): string;
  /**
   * Stop using this store, and release the client's gRPC channels.
   *
   * **Async, unlike the other stores' `close()`, and that is not an
   * inconsistency for its own sake.** Terminating a Firestore client closes
   * channels; a Node process holding an open channel does not exit. A `void`
   * return here would be a promise this adapter could not keep, so the shape
   * says what actually happens and a shutdown hook can await it.
   *
   * Idempotent, and **final** — reading or writing afterwards refuses by name
   * rather than quietly reconnecting, because a store that reopened behind you
   * would hide a shutdown-ordering bug instead of surfacing it.
   *
   * A client you passed in yourself is NOT terminated: this store did not open
   * it and does not get to decide when the rest of your application stops using
   * it. Nothing is torn down on Google's side either — the documents outlive the
   * process, which is the entire reason to use a managed store.
   */
  close(): Promise<void>;
}

// ─── The refusals ────────────────────────────────────────────────────

/**
 * Raised when the query `listByUser` needs has no composite index yet.
 *
 * Its own class rather than a generic failure, because this is the ONE
 * Firestore error an operator can fix in sixty seconds — and the only way they
 * will know that is if the message says which index, on which collection, in
 * which DATABASE, in which order. See the module header for the `gcloud` line.
 *
 * The database is named and the `--database` flag is always printed, including
 * for `(default)`, where gcloud would have assumed it anyway. That is deliberate:
 * a project may hold several Firestore databases, and an operator on a
 * non-default one who follows a command with no `--database` creates the index on
 * `(default)` and gets this identical error back. A refusal that teaches the
 * wrong fix is worse than a bare failure, and one always-present flag costs
 * nothing to be right.
 *
 * The service's own message carries a one-click creation link and is
 * deliberately NOT echoed: it restates the failing query, and the failing query
 * contains a user id. See {@link firestoreFailure}.
 */
export class FirestoreIndexMissingError extends Error {
  readonly code = 'ERR_FIRESTORE_INDEX_MISSING' as const;
  /** The collection whose index is missing. */
  readonly collection: string;
  /**
   * The database it lives in, or `undefined` when this store did not build the
   * client and therefore cannot know — see the message for what to do then.
   */
  readonly database: string | undefined;

  constructor(collection: string, database?: string) {
    // A placeholder that cannot be pasted blind, rather than a guess at
    // `(default)`. Guessing here is the exact failure this parameter exists to
    // stop, one layer further in.
    //
    // SINGLE-QUOTED, always: the default database is literally spelled
    // `(default)`, and bare parentheses are a syntax error in every shell an
    // operator will paste this into. A refusal that teaches the right fix in a
    // command that will not run is still the wrong refusal.
    const flagValue = `'${database ?? '<the database your Firestore client was built for>'}'`;
    super(
      `[hosting] ${ADAPTER}: listing a user's sessions needs a composite index on ` +
        `'${collection}' ` +
        (database === undefined
          ? `that does not exist yet, and Firestore refused the query (FAILED_PRECONDITION).\n`
          : `in database '${database}' that does not exist yet, and Firestore refused the ` +
            `query (FAILED_PRECONDITION).\n`) +
        `  The index:  owner Ascending, savedAt Descending, __name__ Descending\n` +
        `  Create it:  gcloud firestore indexes composite create \\\n` +
        `                --collection-group=${collection} \\\n` +
        `                --field-config=field-path=owner,order=ascending \\\n` +
        `                --field-config=field-path=savedAt,order=descending \\\n` +
        `                --database=${flagValue}\n` +
        (database === undefined
          ? `  This store did not build the Firestore client, so it cannot name the ` +
            `database — fill that flag in from wherever the client was constructed. ` +
            `An index created on the wrong database leaves this error exactly as it is.\n`
          : ``) +
        `  An equality filter on one field ordered by another always needs one; ` +
        `Firestore's automatic single-field indexes do not serve that shape. ` +
        `Google's own error carries a console link that creates it in one click — it is ` +
        `withheld here because it restates the failing query, and the failing query ` +
        `contains a user id. Look in Cloud Logging for the original.`,
    );
    this.name = 'FirestoreIndexMissingError';
    this.collection = collection;
    this.database = database;
  }
}

/**
 * Raised when a conversation is too big to be one Firestore document.
 *
 * Refused BEFORE the write, so the failure names the conversation and the fix
 * rather than arriving as an opaque `INVALID_ARGUMENT` from the wire. Nothing is
 * truncated on the way past: a conversation half-stored as if it were whole is
 * the exact failure this file's other laws exist to prevent.
 */
export class EnvelopeTooLargeError extends Error {
  readonly code = 'ERR_ENVELOPE_TOO_LARGE' as const;
  /** The session that could not be stored. */
  readonly sessionId: string;
  /** How big its serialized envelope was. */
  readonly bytes: number;

  constructor(sessionId: string, bytes: number) {
    super(
      `[hosting] ${ADAPTER}: the conversation for session '${sessionId}' serializes to ` +
        `${bytes} bytes, and one Firestore document holds at most ` +
        `${FIRESTORE_MAX_DOCUMENT_BYTES} (this store refuses above ${FIRESTORE_MAX_ENVELOPE_BYTES}, ` +
        `leaving room for the document's other fields).\n` +
        `  Nothing was written and nothing was truncated — half a conversation stored as ` +
        `if it were whole is worse than a refusal you can see.\n` +
        `  Compact the conversation before persisting it, keep large payloads as artifacts ` +
        `rather than in the transcript, or use a store with no per-record ceiling.`,
    );
    this.name = 'EnvelopeTooLargeError';
    this.sessionId = sessionId;
    this.bytes = bytes;
  }
}

// ─── The factory ─────────────────────────────────────────────────────

/**
 * Conversations in Firestore — a fleet-shared session store with no instance to
 * run.
 *
 * **Status: contract-shaped and tested, NOT field-validated.** Every SDK member
 * it calls was read off a real install of `@google-cloud/firestore` 9.0.0 and
 * hand-verified there; the test that re-checks those names against the real
 * package SKIPS in this repository, because the package is deliberately not
 * installed here. What runs in CI is the dispatch pin. No test here pretends to
 * have reached Google. See the module header for the full account, and for what
 * a field trial of a DIFFERENT adapter did and did not establish about this
 * design.
 *
 * @throws FirestoreIndexMissingError from `listByUser` until the composite index
 *   exists — see the module header for the exact index.
 * @throws EnvelopeTooLargeError from `persist` for a conversation above
 *   {@link FIRESTORE_MAX_ENVELOPE_BYTES}. Never truncated.
 *
 * @example  A standing agent whose conversations are shared across instances
 *   import { standingAgent, nodeHost } from 'agentfootprint/hosting';
 *   import { firestoreSessions } from 'agentfootprint/hosting';
 *
 *   const sessions = firestoreSessions({ project: 'my-project' });
 *   const handle = await standingAgent({
 *     agentFactory: () => buildAgent(),
 *     host: nodeHost({ port: 8080 }),
 *     sessions,
 *   });
 *   process.on('SIGTERM', () => void handle.close().then(() => sessions.close()));
 *
 * @example  Reusing the Firestore client the application already has
 *   const sessions = firestoreSessions({ firestore: db, collection: 'chat_sessions' });
 *   // close() will NOT terminate `db` — this store did not open it.
 */
export function firestoreSessions(options: FirestoreSessionsOptions = {}): FirestoreSessions {
  const collectionName = options.collection ?? DEFAULT_SESSION_COLLECTION;
  assertCollectionName(collectionName);

  // A pre-built client and connection settings are mutually exclusive. Accepting
  // both would mean silently ignoring one of them, and the one silently ignored
  // is always the one the caller was relying on.
  if (
    options.firestore !== undefined &&
    (options.project !== undefined || options.database !== undefined)
  ) {
    throw new TypeError(
      `${ADAPTER}: 'firestore' was given together with ` +
        `${options.project !== undefined ? "'project'" : "'database'"}. Those settings belong ` +
        `to whoever constructed the client, and this store cannot apply them to a client it ` +
        `did not build — so it refuses rather than accepting a connection option it will ` +
        `ignore. Pass the pre-built client alone, or let this store build one.`,
    );
  }

  const sdk = options._sdk ?? loadFirestoreSdk();
  // Remembered, because close() must terminate only a client this store opened.
  const ownsClient = options.firestore === undefined;
  // Which database the queries run against — known exactly when this store built
  // the client (an omitted `database` IS `(default)`, and gcloud needs to be told
  // so explicitly), and `undefined` when the caller passed a client in, because
  // that setting belongs to whoever constructed it and cannot be read back off
  // the handle. The index refusal prints one or the other; it never guesses.
  const databaseName = ownsClient ? options.database ?? '(default)' : undefined;
  const db: FirestoreLike = options.firestore ?? buildClient(sdk, options);
  const documentIdSentinel = sdk.FieldPath.documentId();

  let closed = false;
  const open = (verb: string): void => {
    if (!closed) return;
    throw new Error(
      `[hosting] the ${ADAPTER} store for '${collectionName}' is closed, so it cannot ${verb}. ` +
        `close() is final by design — reconnecting behind you would hide a shutdown-ordering ` +
        `bug rather than surface it. Build a new store if you need one after closing this.`,
    );
  };

  const collection = (): FirestoreCollectionLike => db.collection(collectionName);
  const docFor = (sessionId: string): FirestoreDocumentReferenceLike =>
    collection().doc(documentIdFor(sessionId));

  /** The stored row, read back without trusting any of its types. */
  const readRow = async (
    sessionId: string,
    operation: string,
  ): Promise<Record<string, unknown> | undefined> => {
    let snapshot: FirestoreDocumentSnapshotLike;
    try {
      snapshot = await docFor(sessionId).get();
    } catch (err) {
      throw firestoreFailure(operation, collectionName, err);
    }
    // `exists` is a PROPERTY on the real snapshot, and a missing document comes
    // back as a snapshot rather than as an error — so "no conversation" is read
    // here and never inferred from a failure.
    if (!snapshot.exists) return undefined;
    return snapshot.data();
  };

  return {
    collection: collectionName,

    documentIdFor,

    async hydrate(sessionId: string): Promise<CheckpointEnvelope | undefined> {
      open('hydrate a session');
      const row = await readRow(sessionId, 'reading a session');
      if (row === undefined) return undefined;

      const stored = row['envelope'];
      if (typeof stored !== 'string') {
        // A document exists and its payload is not even text. Present,
        // unreadable — and specifically NOT `undefined`.
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
      // Validated HERE as well as in the composer, so a refusal points at the
      // store that produced the bytes rather than at whoever read them next.
      return checkEnvelope(parsed, sessionId);
    },

    async persist(sessionId: string, envelope: CheckpointEnvelope): Promise<void> {
      open('persist a session');
      // Checked on the way IN as well as out: a document this store could not
      // read back is one it has no business writing.
      const checked = checkEnvelope(envelope, sessionId);
      const json = JSON.stringify(checked);
      const bytes = Buffer.byteLength(json, 'utf8');
      if (bytes > FIRESTORE_MAX_ENVELOPE_BYTES) throw new EnvelopeTooLargeError(sessionId, bytes);

      // The owner index: DERIVED from the conversation's own identity, never
      // supplied by the caller — the port takes no owner argument and gains
      // none, because a store where owning a session is a matter of asking is
      // not an index, it is a formality.
      const owner = envelopeOwner(checked);
      const ref = docFor(sessionId);
      const row = {
        sessionId,
        format: checked.format,
        savedAt: checked.savedAt,
        envelope: json,
        messageCount: envelopeTranscript(checked).length,
      };

      // WRITE ONCE for the owner, LAST WRITE WINS for everything else — the one
      // rule every store in this package shares, and since 9.36.1 the one
      // IMPLEMENTATION they share: `resolveSessionOwner`.
      //
      // An owner is a fact about the CONVERSATION, established by the first turn
      // that signed for it: a later turn carrying a leaner identity must not
      // erase it (the session would drop out of its owner's list), and a later
      // turn carrying a DIFFERENT one must not take it (ownership would transfer
      // by writing, which undoes every check made against this index one turn
      // later).
      //
      // A DIFFERENT one is REFUSED here rather than dropped, which is the
      // 9.36.1 correction. Keeping `owner` and writing the rest of the document
      // was this adapter's behaviour until then, and a live trial found what it
      // costs: two writers signed the same fresh session, both transactions
      // committed, and the surviving document named the FIRST writer in `owner`
      // and carried the SECOND writer's whole conversation in `envelope`. The
      // first writer listed it, opened it, and read the second writer's
      // conversation. `tx.set` is not reached at all now — the refusal leaves
      // the document exactly as it was.
      //
      // Firestore has no COALESCE, and `set({ merge: true })` is NOT a stand-in:
      // merge means "keep fields I did not mention", so mentioning `owner` at
      // all lets the last writer win, and NOT mentioning it means a conversation
      // that gained an identity on turn two never records one. Both are the bug.
      // The rule needs to READ the stored owner and then decide, and read-then-
      // decide-then-write is only safe inside a transaction — Firestore retries
      // the whole function when a concurrent write touched the document, so two
      // containers persisting the same turn cannot interleave into a lost owner.
      //
      // A full `set` (no merge) is deliberate for the rest: it REPLACES the
      // document, so a field written by an older version of this store does not
      // linger as a ghost beside the fields that replaced it.
      try {
        await db.runTransaction(async (tx) => {
          // Every read in a Firestore transaction must precede every write. This
          // one read is all there is, so that ordering is structural here rather
          // than something to remember.
          const snapshot = await tx.get(ref);
          const existing = snapshot.exists ? snapshot.data() : undefined;
          const existingOwner = existing?.['owner'];
          // Throws SessionOwnershipConflictError on a different signer, out of
          // the transaction function and therefore out of `runTransaction` —
          // which is exactly the behaviour wanted: an aborted transaction
          // writes nothing at all.
          const keptOwner = resolveSessionOwner(
            sessionId,
            typeof existingOwner === 'string' ? existingOwner : undefined,
            owner,
          );
          // `null`, never `undefined`: an absent owner has to be a STORED fact,
          // because the default client throws on `undefined` and because a field
          // that is simply missing cannot be told apart from a field this store
          // failed to write.
          tx.set(ref, { ...row, owner: keptOwner ?? null });
        });
      } catch (err) {
        // OUTSIDE the wrapping on purpose — the same reason `awaitOperation`'s
        // refusal is left alone in the sibling adapter. This refusal is already
        // sanitized, already names the session and already says what to do;
        // re-describing it as a Firestore failure would replace a precise
        // diagnosis with "the backend said no" and imply the backend was at
        // fault, when the backend did exactly what it was told.
        if (err instanceof SessionOwnershipConflictError) throw err;
        throw firestoreFailure('persisting a session', collectionName, err);
      }
    },

    async listByUser(userId: string, listOptions?: SessionListOptions): Promise<SessionListPage> {
      open('list a user’s sessions');
      const limit = Math.max(1, Math.floor(listOptions?.limit ?? DEFAULT_PAGE));
      const after = parseCursor(listOptions?.cursor);

      // EVERY SDK call in this method is inside this one try, builders included.
      // The query builder is synchronous and it THROWS synchronously — a cursor
      // value the client will not accept (`startAfter` with a document name it
      // refuses) rejects from here, not from `get()`. Building outside the try
      // would let exactly one SDK error escape unsanitised, and it would be the
      // one a caller can trigger with a pagination token.
      let snapshot: FirestoreQuerySnapshotLike;
      try {
        // Server-side, indexed, and cursored — the three properties that make
        // this a listing rather than a scan. The alternative (read every document
        // for one owner, sort in the client, skip N) is correct exactly until
        // somebody has a lot of conversations, and then it reads all of them to
        // show ten.
        //
        // `__name__` is ordered explicitly rather than left to Firestore's
        // implicit tiebreak, for the same reason SQLite's listing orders by
        // `session_id` after `saved_at`: two conversations saved in the same
        // millisecond need a total order, or a cursor between them can skip one
        // or repeat one. It is the DOCUMENT NAME — the hash — so the tiebreak is
        // arbitrary but stable, which is all a tiebreak has to be.
        let query: FirestoreQueryLike = collection()
          .where('owner', '==', userId)
          .orderBy('savedAt', 'desc')
          .orderBy(documentIdSentinel, 'desc');
        if (after !== undefined) {
          // A real Firestore cursor: the values of the ordered fields for the
          // last row of the previous page. The SDK converts a bare document-name
          // string into a full document reference for a `__name__` ordering —
          // verified against the installed client, not assumed.
          query = query.startAfter(after.savedAt, after.docId);
        }
        // One extra row, so "is there another page?" is a fact rather than a
        // guess from a full page.
        query = query.limit(limit + 1);
        snapshot = await query.get();
      } catch (err) {
        if (isFailedPrecondition(err)) {
          throw new FirestoreIndexMissingError(collectionName, databaseName);
        }
        throw firestoreFailure('listing a user’s sessions', collectionName, err);
      }

      const docs = snapshot.docs.slice(0, limit);
      const sessions = docs.map((doc) => {
        const row = doc.data() ?? {};
        return {
          // The RAW id out of the field, never the document name — the name is a
          // hash and a caller has to be able to feed a listed id back to
          // `hydrate`. A row written by something that is not this store may not
          // carry one; an empty string is the honest answer for "this row does
          // not say", and it is not silently swapped for the hash, which would
          // hand a caller an id that opens nothing.
          sessionId: typeof row['sessionId'] === 'string' ? row['sessionId'] : '',
          savedAt: typeof row['savedAt'] === 'number' ? row['savedAt'] : 0,
          format: typeof row['format'] === 'string' ? row['format'] : 'unknown',
          // A listing hint, never the authority — the transcript op reads the
          // envelope itself and says the truth.
          messageCount: typeof row['messageCount'] === 'number' ? row['messageCount'] : 0,
        };
      });

      // The cursor is minted from the last document's RAW stored `savedAt`, not
      // from the summary above, and the difference is the whole point of doing it
      // in two lines instead of one.
      //
      // The two read the same field for different jobs. The SUMMARY is a display
      // hint that must never throw, so a row this store did not write reads back
      // as `0` and a sidebar still renders. The CURSOR is an ORDERING KEY, and it
      // has to be the value the server actually sorted by — `startAfter(0, …)` on
      // a descending listing positions past the end, so a summary-minted cursor
      // would hand back an empty second page and silently truncate somebody's
      // conversation list. The `?? 0` that makes the summary safe is precisely
      // what makes it wrong here.
      //
      // When that raw value is not a number, no `savedAt:docId` token can address
      // the position at all, and NO cursor is the honest answer: a caller that
      // gets none stops, where a caller handed `0:…` is told there is more and
      // then shown nothing. Both end the listing; only one of them lies about why.
      const last = docs[docs.length - 1];
      const lastSavedAt = last?.data()?.['savedAt'];
      return {
        sessions,
        ...(snapshot.docs.length > limit &&
          last !== undefined &&
          typeof lastSavedAt === 'number' && {
            cursor: `${lastSavedAt}:${last.id}`,
          }),
      };
    },

    async ownerOf(sessionId: string): Promise<string | undefined> {
      open('read a session’s owner');
      const row = await readRow(sessionId, 'reading a session’s owner');
      const owner = row?.['owner'];
      // `undefined` for "no such session" AND for "a session nobody signed for"
      // — the deliberate ambiguity the composer's one not-found rests on. A store
      // that answered those differently would hand a caller an oracle for which
      // session ids are real.
      return typeof owner === 'string' && owner.length > 0 ? owner : undefined;
    },

    async forget(sessionId: string): Promise<void> {
      open('forget a session');
      try {
        // Deleting a document that is not there succeeds in Firestore, which is
        // the outcome this method asked for — so there is no not-found to catch.
        await docFor(sessionId).delete();
      } catch (err) {
        throw firestoreFailure('forgetting a session', collectionName, err);
      }
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (!ownsClient) return;
      try {
        await db.terminate();
      } catch {
        // The store is closed either way. A failure to hand back gRPC channels
        // is not something a caller shutting down can act on, and a throw here
        // would turn an orderly shutdown into a crash over a released resource.
      }
    },
  };
}

// ─── Internals ───────────────────────────────────────────────────────

/**
 * The document name for one session id — `sha256(domain ‖ NUL ‖ id)` in hex.
 *
 * A module-level pure function rather than a closure, so the same mapping is
 * available to the store, to a test, and to an operator who needs it in a REPL.
 * The NUL separator is what stops `domain + "a" + "bc"` and `domain + "ab" + "c"`
 * from being the same input; a session id may legally contain anything else.
 *
 * See the module header for why this is an ADDRESSING scheme and not, in any
 * sense, encryption.
 */
export function documentIdFor(sessionId: string): string {
  return createHash('sha256').update(`${DOC_ID_DOMAIN}\u0000${sessionId}`, 'utf8').digest('hex');
}

/**
 * Load the peer dep, or refuse by name with the install line.
 *
 * `lazyRequire` keeps the specifier away from bundler static analysis, so
 * importing `agentfootprint/hosting` costs nothing for the consumers — the vast
 * majority — who never construct one of these.
 */
function loadFirestoreSdk(): FirestoreSdkModule {
  let mod: FirestoreSdkModule;
  try {
    mod = lazyRequire<FirestoreSdkModule>('@google-cloud/firestore');
  } catch {
    throw new Error(
      `[hosting] ${ADAPTER} requires the \`@google-cloud/firestore\` package.\n` +
        `  Install:  npm install @google-cloud/firestore\n` +
        `  It is an OPTIONAL peer dependency, loaded only when you construct this store — ` +
        `memorySessions() and sqliteSessions() need nothing installed.`,
    );
  }
  if (typeof mod.Firestore !== 'function' || typeof mod.FieldPath?.documentId !== 'function') {
    throw new Error(
      `[hosting] ${ADAPTER}: \`@google-cloud/firestore\` is installed but does not export ` +
        `both \`Firestore\` and \`FieldPath.documentId\`. This adapter is built against the ` +
        `9.x client — update the package, or pass \`firestore\` with a pre-built client.`,
    );
  }
  return mod;
}

/**
 * Build the client.
 *
 * Only the settings this adapter has an opinion about are forwarded, and each is
 * omitted rather than passed as `undefined`: the client treats an explicit
 * `undefined` and an absent key the same way today, and relying on that is how a
 * connection ends up configured by an SDK upgrade.
 */
function buildClient(sdk: FirestoreSdkModule, options: FirestoreSessionsOptions): FirestoreLike {
  return new sdk.Firestore({
    ...(options.project !== undefined && { projectId: options.project }),
    ...(options.database !== undefined && { databaseId: options.database }),
  });
}

/**
 * Refuse a collection name Firestore could not address.
 *
 * A `/` would make this a PATH — `db.collection('a/b')` is a document, and the
 * client throws a message about "an odd number of components" that says nothing
 * about the option the caller actually set. Catching it here names the option.
 */
function assertCollectionName(name: string): void {
  const illegal =
    name.trim() === '' ||
    name.includes('/') ||
    name === '.' ||
    name === '..' ||
    /^__.*__$/.test(name);
  if (!illegal) return;
  throw new TypeError(
    `${ADAPTER}: 'collection' must be a single Firestore collection name, and ` +
      `${JSON.stringify(name)} is not one. It may not be empty, contain '/', be '.' or '..', ` +
      `or match '__…__' (Firestore reserves that spelling). Pass a plain name like ` +
      `'${DEFAULT_SESSION_COLLECTION}'.`,
  );
}

/**
 * The shape of every document name this store mints — {@link documentIdFor} is a
 * sha-256 in hex, so 64 lowercase hex characters, always.
 *
 * Both halves of a cursor are checked against what this store PRODUCES, not
 * against what Firestore would accept, and the difference matters: a document
 * name from another store may be perfectly legal for Firestore and still be a
 * position in a listing this one never took.
 */
const MINTED_DOCUMENT_NAME = /^[0-9a-f]{64}$/;

/**
 * Read a listing cursor — `<savedAt>:<documentName>`, the last row of the
 * previous page.
 *
 * A cursor this store did not mint (a truncation, a hand-edit, a client that
 * kept one across a release, a token minted by `sqliteSessions` whose ids may
 * legitimately be path-shaped) restarts at the top rather than throwing: the
 * worst case is a caller seeing page one twice, and refusing a listing because a
 * pagination token went stale would break a sidebar over something that costs
 * nothing to recover from.
 *
 * That tolerance is why BOTH halves are shape-checked here rather than only the
 * `savedAt`. A cursor is caller-supplied input, and an unrecognised document-name
 * half handed to `startAfter` makes the client throw SYNCHRONOUSLY — a
 * slash-containing name is rejected outright as "not a plain document ID" — so
 * the docstring's promise ("restarts at the top") would be broken by the one
 * input class it was written for. Checking the shape here keeps the promise, and
 * a foreign-looking cursor is FORGIVEN rather than refused for the same reason a
 * stale one is: page one twice is a cost nobody notices, and a refused listing is
 * an empty sidebar.
 */
function parseCursor(cursor: string | undefined): { savedAt: number; docId: string } | undefined {
  if (cursor === undefined) return undefined;
  const at = cursor.indexOf(':');
  if (at <= 0) return undefined;
  // parseFLOAT, not parseInt: the cursor has to round-trip whatever number the
  // server ordered by, and `parseInt` would silently truncate a non-integer
  // `savedAt` into a position one row early.
  const savedAt = Number.parseFloat(cursor.slice(0, at));
  const docId = cursor.slice(at + 1);
  if (!Number.isFinite(savedAt) || !MINTED_DOCUMENT_NAME.test(docId)) return undefined;
  return { savedAt, docId };
}

/**
 * gRPC status codes, by the numbers the client actually reports.
 *
 * **A Firestore error's `code` is a gRPC status, not an HTTP status**, and that
 * is precisely why this file does not reuse the Vertex column's `httpStatusOf` /
 * `googleSdkFailure`: those read `code` as HTTP, so a Firestore `NOT_FOUND`
 * would arrive as "HTTP 5" and a missing index as "HTTP 9". Two Google adapters,
 * two genuinely different error vocabularies — sharing the sanitizer would have
 * been a smaller file and a wrong one.
 *
 * @see https://grpc.github.io/grpc/core/md_doc_statuscodes.html
 */
const GRPC_STATUS: Readonly<Record<number, string>> = {
  0: 'OK',
  1: 'CANCELLED',
  2: 'UNKNOWN',
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED',
  9: 'FAILED_PRECONDITION',
  10: 'ABORTED',
  11: 'OUT_OF_RANGE',
  12: 'UNIMPLEMENTED',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
  15: 'DATA_LOSS',
  16: 'UNAUTHENTICATED',
};

/**
 * The gRPC status of a failed call, as a NAME, wherever the client put it.
 *
 * Two spellings are accepted because two layers report it differently: the gax
 * layer sets a numeric `code`, and some wrappers carry the name as a string. A
 * classifier that read only one of them would quietly stop classifying the day
 * the client is upgraded.
 */
export function grpcStatusOf(err: unknown): string | undefined {
  const e = err as { code?: unknown; status?: unknown } | null | undefined;
  if (e === null || typeof e !== 'object') return undefined;
  for (const candidate of [e.code, e.status]) {
    if (typeof candidate === 'number' && GRPC_STATUS[candidate] !== undefined) {
      return GRPC_STATUS[candidate];
    }
    if (typeof candidate === 'string' && Object.values(GRPC_STATUS).includes(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Is this the service saying "that query has no index"? */
export function isFailedPrecondition(err: unknown): boolean {
  return grpcStatusOf(err) === 'FAILED_PRECONDITION';
}

/**
 * Re-raise a failed Firestore call **without its text** — the same law the AWS
 * and Vertex columns follow, re-aimed at a gRPC error.
 *
 * What comes through is the part that is both safe and actionable: which
 * operation failed, which collection it was on, and the gRPC status name. What
 * does not is the SDK's message, because a Firestore error restates the failing
 * request — a document path, a filter value, a field — and those carry a user id
 * and a whole conversation's state. An error thrown from an adapter reaches the
 * model as a tool result AND rides the event stream to every sink attached to
 * the agent.
 *
 * No credential is ever named. **The original is deliberately not attached as
 * `cause`** — a cause travels with the error into every serializer that walks
 * own properties, which would undo all of this in one `JSON.stringify`.
 */
export function firestoreFailure(operation: string, collection: string, err: unknown): Error {
  const status = grpcStatusOf(err);
  const failure = new Error(
    `[hosting] ${ADAPTER}: ${operation} in collection '${collection}' failed` +
      (status === undefined ? '' : ` (${status})`) +
      `.\n  The SDK's own message is withheld: a Firestore error restates the failing ` +
      `request, and these requests carry a user id and a whole conversation's state. ` +
      `Check Cloud Logging for the full error.`,
  );
  failure.name = 'FirestoreApiError';
  return failure;
}

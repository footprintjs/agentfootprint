import type { SessionExpiryPolicy, SessionLifecycle } from '../../../hosting/types.js';
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
   * How long after its last turn a conversation should expire, in
   * milliseconds. Omit and nothing expires (9.42.0).
   *
   * Setting it makes every write stamp {@link EXPIRES_AT_FIELD} —
   * `savedAt + expireAfterMs`, as a timestamp — which is the field a **native
   * Firestore TTL policy** reads. The policy itself is yours to enable, once,
   * with the command {@link FirestoreSessions.retention} hands you; this store
   * writes what it reads and never deletes a document on a clock of its own.
   * Both halves are needed and neither is silent about the other: with no
   * policy the field is inert data, and with no `expireAfterMs` the policy has
   * nothing to act on.
   *
   * **The clock is the conversation's own `savedAt`, not this process's.** So
   * the expiry is IDLE time: every turn pushes it out, and a conversation dies
   * `expireAfterMs` after somebody last spoke, which is what a session
   * retention rule almost always means. It also makes the stamp a pure
   * function of the envelope — the same conversation stamps the same instant
   * on any machine, whatever its clock says.
   *
   * **It does not reach backwards.** Documents written before this was
   * configured carry no expiry field, and a TTL policy ignores a document
   * whose field is missing — so old conversations expire only once they are
   * written again. See the module header for what to do about the ones that
   * never will be.
   *
   * Named `expireAfterMs` rather than `ttlMs` deliberately, even though the
   * artifact stores in this package spell their dial the second way: theirs is
   * stamped once at mint and measured from creation, and this one is measured
   * from the LAST turn and moves on every write. One word for two clocks would
   * be the cheaper name and the more expensive mistake.
   */
  readonly expireAfterMs?: number;
  /**
   * @internal Test seam only — the `@google-cloud/firestore` module, injected.
   * Lets the suite exercise every path (including the refusals) without a
   * credential or a network. Not public API, and not a place to plug in another
   * Firestore driver.
   */
  readonly _sdk?: FirestoreSdkModule;
}

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
   * How conversations here stop existing: **the backend does it**, on a native
   * TTL policy an operator enables once, against {@link EXPIRES_AT_FIELD}
   * (9.42.0).
   *
   * Narrowed from the port's optional member to a required one, and to the one
   * arm this store can be: a caller holding a `FirestoreSessions` needs no
   * feature check and no branch, and gets a compile error rather than a
   * runtime surprise if they reach for a sweep that does not exist here.
   *
   * `active` says whether this store was built with `expireAfterMs` and is
   * therefore stamping anything; `enableWith` is the exact command, with this
   * store's collection and database already filled in.
   */
  retention(): SessionExpiryPolicy;
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

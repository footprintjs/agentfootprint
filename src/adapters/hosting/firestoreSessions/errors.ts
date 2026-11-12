import {
  ADAPTER,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  FIRESTORE_MAX_ENVELOPE_BYTES,
} from './constants.js';
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

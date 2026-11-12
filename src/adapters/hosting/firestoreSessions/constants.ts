export const ADAPTER = 'firestoreSessions';

/** Where sessions live when the caller names no collection. */
export const DEFAULT_SESSION_COLLECTION = 'agentfootprint_sessions';

/**
 * The document field a native TTL policy is configured against (9.42.0).
 *
 * A SECOND field beside `savedAt`, never a change to it — see the module
 * header for why converting the ordering key would have re-sorted every
 * conversation already in the collection.
 *
 * Exported because an operator has to type this name into the console or the
 * `gcloud` line, and a field name that lives only inside a string literal is a
 * field name somebody will mistype at 2am.
 */
export const EXPIRES_AT_FIELD = 'expiresAt';

/** How many rows one `listByUser` page carries when the caller names no limit. */
export const DEFAULT_PAGE = 50;

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
export const DOC_ID_DOMAIN = 'agentfootprint/hosting/firestoreSessions/v1';

/**
 * The shape of every document name this store mints — {@link documentIdFor} is a
 * sha-256 in hex, so 64 lowercase hex characters, always.
 *
 * Both halves of a cursor are checked against what this store PRODUCES, not
 * against what Firestore would accept, and the difference matters: a document
 * name from another store may be perfectly legal for Firestore and still be a
 * position in a listing this one never took.
 */
export const MINTED_DOCUMENT_NAME = /^[0-9a-f]{64}$/;

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
export const GRPC_STATUS: Readonly<Record<number, string>> = {
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

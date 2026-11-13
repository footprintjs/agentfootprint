import { createHash } from 'node:crypto';
import {
  DOC_ID_DOMAIN,
  DEFAULT_SESSION_COLLECTION,
  ADAPTER,
  MINTED_DOCUMENT_NAME,
} from './constants.js';
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
 * Refuse a collection name Firestore could not address.
 *
 * A `/` would make this a PATH — `db.collection('a/b')` is a document, and the
 * client throws a message about "an odd number of components" that says nothing
 * about the option the caller actually set. Catching it here names the option.
 */
export function assertCollectionName(name: string): void {
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
export function parseCursor(
  cursor: string | undefined,
): { savedAt: number; docId: string } | undefined {
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

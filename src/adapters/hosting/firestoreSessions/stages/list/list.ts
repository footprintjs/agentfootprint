import type { TypedScope } from 'footprintjs';
import type { Facts, ListCall } from '../../call.js';
import { capture, publish } from '../../run.js';
import { DEFAULT_PAGE } from '../../constants.js';
import { parseCursor } from '../../address.js';
import { FirestoreIndexMissingError } from '../../errors.js';
import { isFailedPrecondition, firestoreFailure } from '../../failure.js';
import type { FirestoreQueryLike, FirestoreQuerySnapshotLike } from '../../types.js';

export async function query(call: ListCall): Promise<void> {
  const { userId, listOptions, ports } = call;
  const { open, collection, documentIdSentinel, collectionName, databaseName } = ports;

  open('list a user’s sessions');
  const limit = Math.max(1, Math.floor(listOptions?.limit ?? DEFAULT_PAGE));
  call.limit = limit;
  const after = parseCursor(listOptions?.cursor);
  call.cursorRecognized = after !== undefined;

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

  call.snapshot = snapshot;
}

export async function listStage(scope: TypedScope<Facts>): Promise<void> {
  const call = scope.$getArgs<{ call: () => ListCall }>().call();
  await capture(call, () => query(call));
  publish(scope, call);
  if (call.cursorRecognized !== undefined) scope.cursorRecognized = call.cursorRecognized;
}

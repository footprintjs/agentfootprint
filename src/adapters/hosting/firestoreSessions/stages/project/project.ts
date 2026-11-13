import type { TypedScope } from 'footprintjs';
import type { Facts, ListCall } from '../../call.js';
import { publish } from '../../run.js';
import { listedFormatOfRow } from '../../../../../hosting/answeredPause.js';
import type { SessionListPage } from '../../../../../hosting/types.js';
import type { FirestoreQuerySnapshotLike } from '../../types.js';

export function project(snapshot: FirestoreQuerySnapshotLike, limit: number): SessionListPage {
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
      // What the session IS now: a document written before the field
      // held the listed format says 'flowchart-v1' for any pause, and is
      // read again from the envelope the query already returned.
      format: listedFormatOfRow(
        typeof row['format'] === 'string' ? row['format'] : 'unknown',
        row['envelope'],
      ),
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
}

export function projectStage(scope: TypedScope<Facts>): void {
  const call = scope.$getArgs<{ call: () => ListCall }>().call();
  try {
    call.value = project(call.snapshot as FirestoreQuerySnapshotLike, call.limit as number);
  } catch (error) {
    call.failed = true;
    call.error = error;
  }
  publish(scope, call);
}

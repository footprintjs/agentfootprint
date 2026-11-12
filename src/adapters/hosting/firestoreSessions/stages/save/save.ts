import type { TypedScope } from 'footprintjs';
import type { Facts, SaveCall } from '../../call.js';
import { capture, publish, finish } from '../../run.js';
import { decide } from 'footprintjs';
import type { DecisionResult } from 'footprintjs';
import {
  checkEnvelope,
  envelopeOwner,
  envelopeTranscript,
} from '../../../../../hosting/envelope.js';
import { listedFormatOf } from '../../../../../hosting/answeredPause.js';
import { SessionOwnershipConflictError } from '../../../../../hosting/errors.js';
import { EnvelopeTooLargeError } from '../../errors.js';
import { EXPIRES_AT_FIELD, FIRESTORE_MAX_ENVELOPE_BYTES } from '../../constants.js';
import { firestoreFailure } from '../../failure.js';
import { SAVE_SIZE_RULES } from '../../rules.js';

export async function save(
  call: SaveCall,
  chooseSize: (bytes: number) => DecisionResult,
): Promise<void> {
  const { sessionId, envelope, ports } = call;
  const { open, docFor, db, expiresAtFor, collectionName } = ports;

  open('persist a session');
  // Checked on the way IN as well as out: a document this store could not
  // read back is one it has no business writing.
  const checked = checkEnvelope(envelope, sessionId);
  const json = JSON.stringify(checked);
  const bytes = Buffer.byteLength(json, 'utf8');
  call.bytes = bytes;
  call.sizeDecision = chooseSize(bytes);
  call.reason = call.sizeDecision.branch === 'refuse' ? 'envelope-too-large' : undefined;
  const refuse = (): void => {
    throw new EnvelopeTooLargeError(sessionId, bytes);
  };
  ({ refuse, complete: (): undefined => undefined })[
    call.sizeDecision.branch as 'refuse' | 'complete'
  ]();

  // The owner index: DERIVED from the conversation's own identity, never
  // supplied by the caller — the port takes no owner argument and gains
  // none, because a store where owning a session is a matter of asking is
  // not an index, it is a formality.
  const owner = envelopeOwner(checked);
  const ref = docFor(sessionId);
  const row = {
    sessionId,
    // The LISTED format (`listedFormatOf`), what `listByUser` reports: a
    // pause whose decision a resume already used reads as a conversation
    // here, though `envelope` still holds the paused run.
    format: listedFormatOf(checked),
    savedAt: checked.savedAt,
    envelope: json,
    messageCount: envelopeTranscript(checked).length,
    // The TTL field (9.42.0) — a SECOND field, never a change to
    // `savedAt`. See the module header: `savedAt` is the ordering key of
    // the composite index and the first half of every cursor this store
    // has ever minted, and Firestore sorts values by TYPE before value, so
    // making it a timestamp would have put every document written from now
    // on into a different sort bucket from every document already stored.
    //
    // A `Date`, which the client converts to a Timestamp on write — and a
    // TTL policy acts only on a Timestamp. Writing one this way rather
    // than through `Timestamp.fromMillis` is deliberate: it adds no member
    // to the SDK surface this adapter dispatches (so the pin row is
    // unchanged and no new name had to be hand-verified against a real
    // install), and it works identically for a caller who passed their own
    // client.
    //
    // `null` when nothing was configured, never `undefined`: the default
    // client throws on `undefined`, and a TTL policy ignores a field that
    // is null or missing — so an unconfigured store writes an inert field
    // rather than an absent one, exactly as `owner` does one line down and
    // for the same reason.
    [EXPIRES_AT_FIELD]: expiresAtFor(checked.savedAt),
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
    await db.runTransaction((tx) => ports.writeOwner(tx, ref, row, owner));
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
}

export async function saveStage(scope: TypedScope<Facts>): Promise<void> {
  const call = scope.$getArgs<{ call: () => SaveCall }>().call();
  await capture(call, () =>
    save(call, (bytes) => {
      scope.bytes = bytes;
      scope.envelopeLimit = FIRESTORE_MAX_ENVELOPE_BYTES;
      return decide(scope, SAVE_SIZE_RULES, {
        branch: 'complete',
        label: 'Envelope fits the existing ceiling',
      });
    }),
  );
  publish(scope, call);
}

export function chooseSave(scope: TypedScope<Facts>) {
  const call = scope.$getArgs<{ call: () => SaveCall }>().call();
  return call.failed && call.sizeDecision?.branch !== 'refuse'
    ? finish(scope)
    : call.sizeDecision ?? finish(scope);
}

import { ownData, readOwnList } from '../../lib/boundedJson.js';
import type { LateNoteDisposition } from '../../provider-contract/lateRecordNote.js';
import { readAfterCall, type EpochLocation } from '../epochs.js';

const dispositions = new Set<LateNoteDisposition>([
  'submitted',
  'omitted',
  'not-dispatched',
  'unavailable',
]);

/** Restore only the disposition of this call's accepted leaf. Its private proof is not served. */
export function lateRecordNoteAt(location: EpochLocation) {
  const entry = location.log[location.callIdx];
  if (
    !entry?.trace?.some((trace) => trace.path === 'lateRecordNoteReceipt' && trace.verb === 'set')
  )
    return undefined;
  try {
    const saved = readOwnList(readAfterCall(location, 'lateRecordNoteReceipt'), 1);
    if (saved?.unread !== 0 || saved.entries.length !== 1) return undefined;
    const outer = ownData(saved.entries[0], ['attempts', 'accepted']);
    const value = outer.accepted;
    if (value === undefined) return Object.freeze({ disposition: 'unavailable' as const });
    const accepted = ownData(value, ['ordinal', 'disposition']);
    const ordinal = accepted.ordinal;
    const disposition = accepted.disposition as LateNoteDisposition;
    if (
      typeof ordinal !== 'number' ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 1 ||
      ordinal > 64 ||
      !dispositions.has(disposition)
    )
      return Object.freeze({ disposition: 'unavailable' as const });
    const attempts = readOwnList(outer.attempts, 64);
    const named = attempts?.entries
      .map((entry) => ownData(entry, ['ordinal', 'disposition']))
      .filter((entry) => entry.ordinal === ordinal);
    if (attempts?.unread !== 0 || named?.length !== 1 || named[0]?.disposition !== disposition)
      return Object.freeze({ disposition: 'unavailable' as const });
    return Object.freeze({
      disposition,
      pointer: Object.freeze({ callRuntimeStageId: location.callRuntimeStageId, ordinal }),
    });
  } catch {
    return Object.freeze({ disposition: 'unavailable' as const });
  }
}

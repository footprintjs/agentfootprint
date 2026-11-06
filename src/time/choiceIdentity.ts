/**
 * One resolved meaning in a time question, independent of the candidate's
 * position or parser provenance. This is a consistency key, not authority:
 * an answer still has to match the candidates of its current bound request.
 *
 * A zone and its literal abbreviation remain distinct even when their UTC
 * windows agree. Elapsed and absolute windows, their anchors and their grain
 * remain distinct. Duplicate parse/date-order provenance does not create
 * another meaning. No raw quote or zone-token spelling is a key.
 * Role: L0 leaf. Pattern: one closed JSON tuple, using the existing parsers.
 * Emits: N/A.
 */

import { AXIS_UNITS, durationMs } from './duration.js';
import { compareInstants, instantOf } from './instant.js';
import { offsetOfToken, type TimeCandidate } from './resolveRecord.js';

/**
 * An injective JSON tuple over the resolved window interpretation, exact
 * instants, selected zone and offset interpretation. Call only with an
 * admitted candidate; this function does not admit a checkpoint or decode
 * an answer into a reading.
 */
export function timeChoiceIdentity(candidate: TimeCandidate): string {
  const from = instantOf(candidate.range.from, 'strict');
  const to = instantOf(candidate.range.to, 'strict');
  if (from === undefined || to === undefined || compareInstants(from, to) >= 0) {
    throw new TypeError('timeChoiceIdentity: a strict, ordered time range is required.');
  }

  const elapsed =
    candidate.window.kind === 'lookback'
      ? durationMs(candidate.window.duration, AXIS_UNITS)
      : undefined;
  const window =
    candidate.window.kind === 'lookback'
      ? [
          'lookback',
          elapsed === undefined
            ? ['unmeasured', candidate.window.duration]
            : ['milliseconds', elapsed],
        ]
      : ['range'];

  const literal =
    candidate.reading.abbreviation === 'literal' ||
    candidate.notes.some((note) => note.kind === 'zone-read' && note.as === 'abbreviation-literal');
  const offsets = candidate.notes.flatMap((note) => {
    if (note.kind !== 'offset-said') return [];
    const offset = offsetOfToken(note.offset);
    // The existing note admission permits any string. Preserve an unreadable
    // spelling rather than treating it as a different, known numeric offset.
    return [
      JSON.stringify(offset === undefined ? ['unread', note.offset] : ['minutes', offset.minutes]),
    ];
  });

  return JSON.stringify([
    'time-choice-v1',
    window,
    candidate.anchor,
    candidate.grain,
    [from.ms, from.nanos],
    [to.ms, to.nanos],
    candidate.zone,
    literal ? 'literal' : 'regional',
    [...new Set(offsets)].sort(),
  ]);
}

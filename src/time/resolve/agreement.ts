import { compareInstants, instantOf } from '../instant.js';
import type { TimeCandidate } from '../resolveRecord.js';
import type { Built } from './types.js';

/** Complete canonical boundaries, including sub-millisecond precision. */
export function windowKey(candidate: Pick<TimeCandidate, 'range'>): string {
  const from = instantOf(candidate.range.from, 'strict');
  const to = instantOf(candidate.range.to, 'strict');
  if (from === undefined || to === undefined || compareInstants(from, to) >= 0) {
    throw new TypeError('Invalid resolved interval.');
  }
  return JSON.stringify([from.ms, from.nanos, to.ms, to.nanos]);
}

/** An equal fixed-offset alternative changes no endpoint; retain the declared region. */
export function withoutAgreeingLiterals(built: readonly Built[]): Built[] {
  const key = (b: Built): string => {
    const reading = b.candidate.reading;
    return JSON.stringify([
      windowKey(b.candidate),
      reading.dateOrder,
      reading.year,
      reading.meridiem,
      reading.endMeridiem,
    ]);
  };
  const regional = new Set(
    built.filter((b) => b.candidate.reading.abbreviation === 'zone').map(key),
  );
  return built.filter(
    (b) => b.candidate.reading.abbreviation !== 'literal' || !regional.has(key(b)),
  );
}

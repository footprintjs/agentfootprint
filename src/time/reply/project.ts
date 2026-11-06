/** L0 leaf: project a strict range without changing the existing enum's meaning. */
import { parseRange, spellRange, type TimeRange } from '../range.js';
import { holdReply, type TimeReplyDecision, type TimeReplyInput } from './types.js';

function offeredOf(input: TimeReplyInput) {
  if (input.offered !== undefined) return input.offered;
  const { candidates = [], choice } = input.row;
  const indexes =
    choice?.by === 'open'
      ? choice.remaining
      : choice?.by === 'only' || choice?.by === 'policy'
      ? [choice.candidate]
      : [];
  return indexes.flatMap((index) => {
    const candidate = candidates[index];
    return candidate === undefined ? [] : [{ range: candidate.range, zone: candidate.zone }];
  });
}

export function projectRange(input: TimeReplyInput, value: string): TimeReplyDecision {
  const range = parseRange(value);
  if (range === undefined) return holdReply('invalid-range');
  const offered = offeredOf(input).find((item) => spellRange(item.range) === value);
  return {
    kind: 'range',
    range,
    ...(offered?.zone !== undefined && { zone: offered.zone }),
    how: offered === undefined ? 'edited' : 'confirmed',
    rule: offered === undefined ? 'range-edited' : 'range-confirmed',
  };
}

export function projectInterval(range: TimeRange): TimeReplyDecision {
  // A person's full interval in the correction box is their edit, even if
  // it happens to equal an offered range. It asserts no inferred IANA zone.
  return { kind: 'range', range, how: 'edited', rule: 'interval-corrected' };
}

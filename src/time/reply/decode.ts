/** L0 leaf: exactly one populated reply channel, before any interpretation. */
import { holdReply, type DecodedReply, type TimeReplyInput } from './types.js';

const MAX_REPLY_CHARACTERS = 4096;

export function decodeReply(input: Pick<TimeReplyInput, 'range' | 'correction'>): DecodedReply {
  const range = input.range !== undefined;
  const correction = input.correction !== undefined;
  if (range && correction) return holdReply('both-filled');
  if (!range && !correction) return holdReply('neither-filled');
  const value = range ? input.range : input.correction;
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MAX_REPLY_CHARACTERS
  ) {
    return holdReply(range ? 'invalid-range' : 'invalid-correction');
  }
  // A range is judged exactly as supplied; only free correction text is trimmed.
  return { kind: range ? 'range' : 'text', value: range ? value : value.trim() };
}

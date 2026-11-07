/** L0 leaf: exactly one populated reply channel, before any interpretation. */
import { holdReply, type DecodedReply, type TimeReplyInput } from './types.js';

const MAX_REPLY_CHARACTERS = 4096;
// Index: range bit (2) + correction bit (1). No channel is inferred from its contents.
const CHANNELS = [
  { kind: 'hold', rule: 'neither-filled' },
  { kind: 'text' },
  { kind: 'range' },
  { kind: 'hold', rule: 'both-filled' },
] as const;

function populated(kind: 'range' | 'text', value: unknown): DecodedReply {
  const valid =
    typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_REPLY_CHARACTERS;
  return valid
    ? { kind, value: kind === 'range' ? value : value.trim() }
    : holdReply(kind === 'range' ? 'invalid-range' : 'invalid-correction');
}

export function decodeReply(input: Pick<TimeReplyInput, 'range' | 'correction'>): DecodedReply {
  const index = Number(input.range !== undefined) * 2 + Number(input.correction !== undefined);
  const channel = CHANNELS[index];
  // A range is judged exactly as supplied; only free correction text is trimmed.
  return channel.kind === 'hold'
    ? holdReply(channel.rule)
    : populated(channel.kind, channel.kind === 'range' ? input.range : input.correction);
}

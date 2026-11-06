/** L0 leaf: compose the pure reply units; no pause, executor, record write or effect. */
import { classifyReply } from './classify.js';
import { decodeReply } from './decode.js';
import { projectInterval, projectRange } from './project.js';
import { resolveReply } from './resolve.js';
import type { TimeReplyDecision, TimeReplyInput } from './types.js';

export function timeReplyOf(input: TimeReplyInput): TimeReplyDecision {
  const reply = decodeReply(input);
  if (reply.kind === 'hold') return reply;
  if (reply.kind === 'range') return projectRange(input, reply.value);
  const text = classifyReply(reply.value);
  if (text.kind === 'hold') return text;
  if (text.kind === 'interval') return projectInterval(text.range);
  return resolveReply(input, text);
}

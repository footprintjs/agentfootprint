/** L0 leaf: compose the pure reply units; no pause, executor, record write or effect. */
import { classifyReply } from './classify.js';
import { decodeReply } from './decode.js';
import { projectInterval, projectRange } from './project.js';
import { resolveReply } from './resolve.js';
import type { ClassifiedText, DecodedReply, TimeReplyDecision, TimeReplyInput } from './types.js';

type Rules<T extends { readonly kind: string }> = {
  readonly [K in T['kind']]: (value: Extract<T, { readonly kind: K }>) => TimeReplyDecision;
};
/** The discriminator selects exactly one rule in an exhaustive data table. */
function apply<T extends { readonly kind: string }>(value: T, rules: Rules<T>): TimeReplyDecision {
  const rule = rules[value.kind as T['kind']] as (item: T) => TimeReplyDecision;
  return rule(value);
}

function classified(input: TimeReplyInput, value: string): TimeReplyDecision {
  const rules: Rules<ClassifiedText> = {
    hold: (reply) => reply,
    interval: (reply) => projectInterval(reply.range),
    zone: (reply) => resolveReply(input, reply),
    words: (reply) => resolveReply(input, reply),
  };
  return apply(classifyReply(value), rules);
}

export function timeReplyOf(input: TimeReplyInput): TimeReplyDecision {
  const rules: Rules<DecodedReply> = {
    hold: (reply) => reply,
    range: (reply) => projectRange(input, reply.value),
    text: (reply) => classified(input, reply.value),
  };
  return apply(decodeReply(input), rules);
}

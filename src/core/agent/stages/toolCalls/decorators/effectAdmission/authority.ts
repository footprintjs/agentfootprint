import {
  readCallOccurrenceKey,
  type CallOccurrenceKey,
} from '../../../../../../lib/callOccurrence.js';
import { nativeIsProxy } from '../../../../../../lib/nativeProxyCheck.js';
import {
  readToolResultEnvelope,
  type ProposedEffect,
  type ReadToolResultEnvelope,
} from '../../../../../../semantics/toolEffects.js';
import { utf8Length } from '../../../../../../lib/utf8.js';

export const MAX_EFFECT_SELECTION = 64;
const MAX_OBSERVED_PROPOSALS = 256;
const MAX_PROPOSAL_BYTES = 64 * 1024;

export interface EffectAuthority {
  readonly envelope: ReadToolResultEnvelope;
  readonly original: () => boolean;
  readonly bytes: number;
  readonly occurrence: string;
}

function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || nativeIsProxy?.(value) !== false)
    return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field && 'value' in field ? field.value : undefined;
}

function matches(value: unknown, effect: ProposedEffect): boolean {
  if (ownValue(value, 'kind') !== effect.kind) return false;
  if (effect.kind === 'propose-transition')
    return (
      ownValue(value, 'targetSkillId') === effect.targetSkillId &&
      ownValue(value, 'reason') === effect.reason
    );
  return (
    ownValue(value, 'instructionId') === effect.instructionId &&
    ownValue(value, 'deliveryLease') === effect.deliveryLease
  );
}

function observedList(raw: unknown, effects: readonly ProposedEffect[]): boolean {
  const list = ownValue(raw, 'effects');
  if (
    list === null ||
    typeof list !== 'object' ||
    nativeIsProxy?.(list) !== false ||
    !Array.isArray(list)
  )
    return false;
  if (ownValue(list, 'length') !== effects.length) return false;
  return effects.every((effect, ordinal) => matches(ownValue(list, String(ordinal)), effect));
}

/** Capture only the bounded proposal fields. The delivery reader still owns envelope recognition. */
export function captureReturnedEffectAuthority(
  raw: unknown,
  callOccurrenceKey: CallOccurrenceKey,
): EffectAuthority | undefined {
  const list = ownValue(raw, 'effects');
  if (
    typeof list !== 'object' ||
    list === null ||
    nativeIsProxy?.(list) !== false ||
    !Array.isArray(list) ||
    list.length === 0 ||
    list.length > MAX_OBSERVED_PROPOSALS
  )
    return undefined;
  const occurrence = readCallOccurrenceKey({ callOccurrenceKey });
  if (typeof occurrence !== 'string') return undefined;
  const content = Object.getOwnPropertyDescriptor(raw, 'content');
  const status = Object.getOwnPropertyDescriptor(raw, 'status');
  if (!content || !('value' in content) || (status && !('value' in status))) return undefined;

  let remaining = MAX_PROPOSAL_BYTES;
  const charge = (value: unknown): value is string => {
    // Code-unit length is a lower bound on the UTF-8 size. Reject before
    // scanning a field that already cannot fit the remaining budget.
    if (typeof value !== 'string' || value.length > remaining) return false;
    remaining -= utf8Length(value);
    return remaining >= 0;
  };
  const statusWord: unknown = status?.value;
  if (statusWord !== undefined && !charge(statusWord)) return undefined;

  const fields: ProposedEffect[] = [];
  for (let ordinal = 0; ordinal < list.length; ordinal++) {
    const item = ownValue(list, String(ordinal));
    const kind = ownValue(item, 'kind');
    if (kind === 'propose-transition') {
      const targetSkillId = ownValue(item, 'targetSkillId');
      const reason = ownValue(item, 'reason');
      if (!charge(targetSkillId) || !charge(reason)) return undefined;
      fields.push({ kind, targetSkillId, reason });
    } else if (kind === 'require-instruction') {
      const instructionId = ownValue(item, 'instructionId');
      const deliveryLease = ownValue(item, 'deliveryLease');
      if (
        !charge(instructionId) ||
        (deliveryLease !== 'next-call' && deliveryLease !== 'until-skill-exit') ||
        !charge(deliveryLease)
      )
        return undefined;
      fields.push({ kind, instructionId, deliveryLease });
    } else return undefined;
  }

  // The general reader only sees this owned projection. It cannot enumerate
  // raw fields or normalize strings outside the already charged budget.
  const normalized = readToolResultEnvelope({
    content: undefined,
    effects: fields,
    status: statusWord,
  });
  if (!normalized || normalized.malformed.length > 0) return undefined;
  const effects = Object.freeze(normalized.effects.map((effect) => Object.freeze(effect)));
  return {
    envelope: Object.freeze({ content: undefined, effects, malformed: Object.freeze([]) }),
    original: () => observedList(raw, effects),
    occurrence,
    bytes: MAX_PROPOSAL_BYTES - remaining,
  };
}

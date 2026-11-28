import {
  readCallOccurrenceKey,
  type CallOccurrenceKey,
} from '../../../../../../lib/callOccurrence.js';
import { nativeIsProxy } from '../../../../../../lib/nativeProxyCheck.js';
import type {
  ProposedEffect,
  ReadToolResultEnvelope,
} from '../../../../../../semantics/toolEffects.js';
import { ownedToolEffectContentBytes } from '../../../../../../semantics/sealedToolEffectContent.js';

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

/** Capture independent values at native return, before result middleware. */
export function captureEffectAuthority(
  raw: unknown,
  envelope: ReadToolResultEnvelope,
  callOccurrenceKey: CallOccurrenceKey,
): EffectAuthority | undefined {
  if (envelope.malformed.length > 0 || envelope.effects.length > MAX_OBSERVED_PROPOSALS)
    return undefined;
  if (!observedList(raw, envelope.effects)) return undefined;
  const occurrence = readCallOccurrenceKey({ callOccurrenceKey });
  if (typeof occurrence !== 'string') return undefined;
  let bytes = 0;
  for (const effect of envelope.effects) {
    const fields =
      effect.kind === 'propose-transition'
        ? [effect.targetSkillId, effect.reason]
        : [effect.instructionId, effect.deliveryLease];
    for (const field of fields) {
      const measured = ownedToolEffectContentBytes(field);
      if (measured === undefined || (bytes += measured) > MAX_PROPOSAL_BYTES) return undefined;
    }
  }
  const effects = Object.freeze(envelope.effects.map((effect) => Object.freeze({ ...effect })));
  return {
    // Content has its own settlement witness. Never keep an alias to it here.
    envelope: Object.freeze({ content: undefined, effects, malformed: Object.freeze([]) }),
    original: () => observedList(raw, effects),
    occurrence,
    bytes,
  };
}

import { nativeIsProxy } from '../../../../../../lib/nativeProxyCheck.js';
import {
  readCallOccurrenceKey,
  type CallOccurrenceKey,
} from '../../../../../../lib/callOccurrence.js';
import { awaitUnder } from '../../../../../../lib/abort.js';
import { ownedToolEffectContentBytes } from '../../../../../../semantics/sealedToolEffectContent.js';
import type { ReadToolResultEnvelope } from '../../../../../../semantics/toolEffects.js';
import type { ToolMiddleware } from '../../../../middleware/types.js';
import { MAX_EFFECT_SELECTION, type EffectAuthority } from './authority.js';

const MAX_OBSERVATIONS = 16;
const SETTLEMENT_PROOF_BYTES = 256 * 1024;

/** Undefined preserves the native no-hook path. Null suppresses typed effects. */
export type EffectAdmission =
  | (ReadToolResultEnvelope & { readonly originalOrdinals: readonly number[] })
  | null
  | undefined;

export function settledEffects(
  original: ReadToolResultEnvelope | undefined,
  admission: EffectAdmission,
): ReadToolResultEnvelope | undefined {
  if (original === undefined || admission === null) return undefined;
  return admission ?? original;
}

/** Invocation-local evidence. Equality is restricted to immutable owned values. */
export function observeEffectContent(
  authority: EffectAuthority | undefined,
  callOccurrenceKey: CallOccurrenceKey | undefined,
  initial: unknown,
) {
  let remaining = SETTLEMENT_PROOF_BYTES;
  let observations = 0;
  const inspect = (value: unknown, cost: number): boolean => {
    if (++observations > MAX_OBSERVATIONS) return false;
    const bytes = ownedToolEffectContentBytes(value);
    if (bytes === undefined) return false;
    remaining -= bytes + cost;
    return remaining >= 0;
  };
  const occurrence =
    callOccurrenceKey === undefined ? undefined : readCallOccurrenceKey({ callOccurrenceKey });
  const entry = authority && occurrence === authority.occurrence ? authority : undefined;
  const unchangedAt = (value: unknown): boolean =>
    entry !== undefined &&
    Object.is(initial, value) &&
    inspect(value, entry.bytes) &&
    entry.original();
  let unchanged = unchangedAt(initial);
  return {
    observe(value: unknown, replaced: boolean) {
      if (unchanged) unchanged = !replaced && unchangedAt(value);
    },
    async settle(
      value: unknown,
      chain: readonly ToolMiddleware[],
      signal: AbortSignal | undefined,
    ): Promise<EffectAdmission> {
      if (!entry || signal?.aborted || !inspect(value, entry.bytes)) return null;
      if (unchanged && Object.is(initial, value) && entry.original())
        return {
          ...entry.envelope,
          originalOrdinals: Object.freeze(entry.envelope.effects.map((_, ordinal) => ordinal)),
        };
      if (entry.envelope.effects.length > MAX_EFFECT_SELECTION) return null;
      const policies = chain.filter((entry) => typeof entry.admitToolResultEffects === 'function');
      const [policy] = policies;
      const authorize = policy?.admitToolResultEffects;
      if (policies.length !== 1 || !policy || !authorize) return null;
      const proposals = Object.freeze(
        entry.envelope.effects.map((effect) => Object.freeze({ effect })),
      );
      try {
        const selection = await awaitUnder(signal, () =>
          authorize.call(policy, {
            content: value,
            proposals,
          }),
        );
        if (
          signal?.aborted ||
          selection === null ||
          typeof selection !== 'object' ||
          nativeIsProxy?.(selection) !== false ||
          !Array.isArray(selection) ||
          selection.length > MAX_EFFECT_SELECTION
        )
          return null;
        const allowed = new Set<unknown>(proposals);
        const chosen = new Set<unknown>();
        for (let index = 0; index < selection.length; index++) {
          const entry = Object.getOwnPropertyDescriptor(selection, String(index));
          if (!entry || !('value' in entry) || !allowed.has(entry.value) || chosen.has(entry.value))
            return null;
          chosen.add(entry.value);
        }
        const effects = proposals
          .filter((proposal) => chosen.has(proposal))
          .map(({ effect }) => effect);
        const originalOrdinals: number[] = [];
        proposals.forEach((proposal, ordinal) => {
          if (chosen.has(proposal)) originalOrdinals.push(ordinal);
        });
        return { ...entry.envelope, effects, originalOrdinals };
      } catch {
        return null;
      }
    },
  };
}

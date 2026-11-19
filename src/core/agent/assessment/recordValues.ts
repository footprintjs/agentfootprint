/** Pure record guards shared by the existing assessment folds. */
import type { LLMMessage } from '../../../provider-contract/types.js';
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Read the recorded dispatch verdict without inferring one from the result. */
export function recordedCallOutcome(
  message: Readonly<Record<string, unknown>>,
): LLMMessage['outcome'] {
  const outcome = message.outcome;
  return outcome === 'refused' || outcome === 'failed' ? outcome : undefined;
}

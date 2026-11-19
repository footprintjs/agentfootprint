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

/** A committed in-progress status speaks only when there is no recorded failure or refusal. */
export function unfinishedCallStatus(
  message: Readonly<Record<string, unknown>>,
): 'partial' | 'pending' | undefined {
  if (message.outcome !== undefined) return undefined;
  const status = message.reportedStatus;
  return status === 'partial' || status === 'pending' ? status : undefined;
}

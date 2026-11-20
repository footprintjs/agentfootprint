/** Pure record guards shared by the existing assessment folds. */
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import type { historyCallResolver } from '../recordedCalls.js';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export function callIndexOf(
  row: Readonly<Record<string, unknown>>,
  resolve: ReturnType<typeof historyCallResolver>,
): number | undefined {
  const resolved = resolve(str(row.toolCallId), str(row.toolName), readCallOccurrenceKey(row));
  return resolved.kind === 'matched' ? resolved.call.index : undefined;
}

/** A committed in-progress status speaks only when there is no recorded failure or refusal. */
export function unfinishedCallStatus(
  message: Readonly<Record<string, unknown>>,
): 'partial' | 'pending' | undefined {
  if (message.outcome !== undefined) return undefined;
  const status = message.reportedStatus;
  return status === 'partial' || status === 'pending' ? status : undefined;
}

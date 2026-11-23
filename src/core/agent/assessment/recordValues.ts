/** Pure record guards shared by the existing assessment folds. */
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { uniqueHistoryProposal, type historyCallResolver } from '../recordedCalls.js';

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

export interface CallPlaces {
  readonly history: readonly unknown[];
  readonly resolve: ReturnType<typeof historyCallResolver>;
  readonly begins: number;
}

export function callPlacement(ref: unknown, { history, resolve, begins }: CallPlaces) {
  if (!isRecord(ref)) return undefined;
  const id = str(ref.toolCallId);
  const occurrenceKey = readCallOccurrenceKey(ref);
  const resolved = resolve(id, str(ref.toolName), occurrenceKey);
  if (resolved.kind === 'matched') return resolved.call.index < begins ? 'earlier' : 'current';
  if (resolved.kind === 'missing' && id !== undefined && occurrenceKey === undefined) {
    const proposal = uniqueHistoryProposal(history, id);
    if (proposal !== undefined && proposal.index < begins) return 'earlier';
  }
  return undefined;
}

/** A committed in-progress status speaks only when there is no recorded failure or refusal. */
export function unfinishedCallStatus(
  message: Readonly<Record<string, unknown>>,
): 'partial' | 'pending' | undefined {
  if (message.outcome !== undefined) return undefined;
  const status = message.reportedStatus;
  return status === 'partial' || status === 'pending' ? status : undefined;
}

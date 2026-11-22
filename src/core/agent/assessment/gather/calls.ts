import { readCallOccurrenceKey } from '../../../../lib/callOccurrence.js';
import { historyCallResolver, uniqueHistoryProposal } from '../../recordedCalls.js';
import { isRecord, str } from '../recordValues.js';

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

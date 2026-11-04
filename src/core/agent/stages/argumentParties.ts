import type { FlowchartCheckpoint } from 'footprintjs';
import { readServedParties } from './servedParties.js';
import { isArgumentAskPause } from '../arguments/askMarker.js';
import { ownCall } from './batchParties.js';

function own(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field !== undefined && 'value' in field ? field.value : undefined;
}
/** One versioned ownership proof for every tool pause, admitted before origin/approval. */
export function requireArgumentPartyCheckpoint(checkpoint: FlowchartCheckpoint): void {
  const path = checkpoint.subflowPath;
  if (!Array.isArray(path) || path.some((segment) => typeof segment !== 'string'))
    throw new Error('Invalid checkpoint: subflowPath must be an array of strings.');
  const last = path.at(-1);
  const leaf = last === undefined ? checkpoint.sharedState : own(checkpoint.subflowStates, last);
  const askPause = isArgumentAskPause(checkpoint.pauseData);
  const pausedId = own(leaf, 'pausedToolCallId'),
    pausedName = own(leaf, 'pausedToolName');
  if (
    !askPause &&
    typeof pausedName !== 'string' &&
    !(typeof pausedId === 'string' && pausedId.length > 0)
  )
    return;
  try {
    const carrier = readServedParties(leaf as Record<string, unknown>);
    const calls = own(leaf, 'llmLatestToolCalls');
    if (carrier.argumentAsk !== askPause) throw new Error('Invalid pause kind');
    if (askPause) {
      if (!Array.isArray(calls) || calls.length > 1024) throw new Error('Invalid ask batch');
      const ids = new Set<string>();
      for (const value of calls) {
        const call = ownCall(value);
        if (
          call === undefined ||
          typeof call.id !== 'string' ||
          call.id.length === 0 ||
          call.name.length === 0 ||
          ids.has(call.id)
        )
          throw new Error('Invalid ask call');
        ids.add(call.id);
      }
      if (own(own(leaf, 'argumentAsk'), 'waiting') === undefined) throw new Error('Missing ask');
    }
  } catch {
    throw new TypeError(
      'Cannot resume this pause: the saved tool ownership carrier is missing or unreadable. Close this question and start a new run.',
    );
  }
}

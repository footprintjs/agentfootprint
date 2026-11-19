import {
  readCallOccurrenceKey,
  type CallOccurrenceKey,
} from '../../../../../lib/callOccurrence.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';

/** The serial dispatcher commits the current proposal batch and its landed
 * prefix before it pauses. Their keys identify the first outstanding slot. */
export function pausedOccurrenceKey(
  history: readonly LLMMessage[],
  toolCallId: string,
  toolName: string,
): CallOccurrenceKey | undefined {
  let at = history.length - 1;
  while (at >= 0 && history[at]?.role !== 'assistant') at--;
  const proposals = history[at]?.toolCalls;
  if (proposals === undefined) return undefined;

  const results = history.slice(at + 1).filter((message) => message.role === 'tool');
  const paused = proposals[results.length];
  if (paused?.id !== toolCallId || paused.name !== toolName) return undefined;
  if (
    !results.every((result, slot) => {
      const proposal = proposals[slot];
      const key = readCallOccurrenceKey(result);
      return (
        proposal !== undefined && typeof key === 'string' && readCallOccurrenceKey(proposal) === key
      );
    })
  )
    return undefined;
  return typeof readCallOccurrenceKey(paused) === 'string' ? paused.callOccurrenceKey : undefined;
}

import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { ProposedCall } from '../batch/paused.js';

/** The serial dispatcher commits the current proposal batch and its landed
 * prefix before it pauses. Their keys identify the first outstanding slot.
 * A keyless batch uses the historical resolver; damaged keyed data fails closed. */
export function keyedPausedProposal(
  history: readonly LLMMessage[],
  toolCallId: string,
  toolName: string,
): ProposedCall | null | undefined {
  let at = history.length - 1;
  while (at >= 0 && history[at]?.role !== 'assistant') at--;
  const proposals = history[at]?.toolCalls;
  const results = history.slice(at + 1).filter((message) => message.role === 'tool');
  const keyed = (row: object) => readCallOccurrenceKey(row) !== undefined;
  if (!proposals?.some(keyed) && !results.some(keyed)) return undefined;
  if (proposals === undefined) return null;
  const paused = proposals[results.length];
  if (paused?.id !== toolCallId || paused.name !== toolName) return null;
  const pausedKey = readCallOccurrenceKey(paused);
  if (typeof pausedKey !== 'string') return null;
  const batch = pausedKey.slice(0, pausedKey.lastIndexOf('.') + 1);
  if (!proposals.every((proposal, slot) => readCallOccurrenceKey(proposal) === `${batch}${slot}`))
    return null;
  if (
    !results.every((result, slot) => {
      const proposal = proposals[slot];
      return (
        proposal !== undefined &&
        result.toolCallId === proposal.id &&
        readCallOccurrenceKey(result) === `${batch}${slot}`
      );
    })
  )
    return null;
  return paused;
}

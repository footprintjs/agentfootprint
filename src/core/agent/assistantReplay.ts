/** Durable metadata for a provider-authored assistant turn, copied at its writer. */
import type { LLMMessage } from '../../adapters/types.js';
import type { AgentState } from './types.js';

/**
 * The adapter owns the evidence; core only carries it alongside the text it
 * actually delivered. Presence is checked without a tracked read, so a run on
 * a provider with no replay evidence gains no phantom context source. Thinking
 * joins this carrier only when the provider supplied replay evidence; legacy
 * message writers retain their existing thinking behaviour otherwise.
 */
export function assistantReplayFields(
  state: Pick<Partial<AgentState>, 'llmLatestReplay' | 'thinkingBlocks'>,
): Pick<LLMMessage, 'replay' | 'thinkingBlocks'> {
  if (!('llmLatestReplay' in state)) return {};
  // Footprint's grouped mapper replaces top-level arrays, but deep-merges
  // object members. The tuple carries one indivisible provider proof, so an
  // earlier layout or binding can never be merged into the next response.
  const replay = state.llmLatestReplay?.[0];
  if (replay === undefined) return {};
  const blocks = state.thinkingBlocks;
  return {
    replay,
    ...(blocks !== undefined && blocks.length > 0 && { thinkingBlocks: [...blocks] }),
  };
}

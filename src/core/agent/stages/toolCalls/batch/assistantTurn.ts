/** Fold — the same provider-authored assistant call turn for dispatch and native refusal. */
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { DispatchCall } from '../contracts/batchCall.js';
import { assistantReplayFields } from '../../../assistantReplay.js';

export function assistantToolTurn(
  scope: TypedScope<AgentState>,
  toolCalls: readonly DispatchCall[],
): LLMMessage | undefined {
  if (!scope.llmLatestContent && toolCalls.length === 0) return undefined;
  const thinkingBlocks = scope.thinkingBlocks as readonly unknown[] | undefined;
  return {
    role: 'assistant',
    content: scope.llmLatestContent ?? '',
    ...(toolCalls.length > 0 && { toolCalls }),
    ...(thinkingBlocks !== undefined &&
      thinkingBlocks.length > 0 && {
        thinkingBlocks: [...thinkingBlocks] as never,
      }),
    ...assistantReplayFields(scope),
  };
}

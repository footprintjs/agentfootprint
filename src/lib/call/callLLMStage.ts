/**
 * CallLLM stage — sends messages + tools to the LLM provider.
 *
 * Reads from scope:
 *   - messages (set by Messages slot or prior stages)
 *   - toolDescriptions (set by Tools slot)
 *
 * Writes to scope:
 *   - adapterResult (discriminated union: 'final' | 'tools' | 'error')
 *   - adapterRawResponse (raw LLM response for recorders)
 *   - llmCall (narrative summary of the LLM call)
 *
 * Emits AgentStreamEvents:
 *   - llm_start { iteration }
 *   - llm_end { iteration, toolCallCount, content, model, latencyMs }
 */

import type { TypedScope } from 'footprintjs';
import type { AgentLoopState } from '../../scope/types';
import type { LLMProvider, LLMCallOptions, ResponseFormat } from '../../types';
import type { AgentStreamEventHandler } from '../../streaming';
import { normalizeAdapterResponse } from './helpers';

export interface CallLLMStageOptions {
  onStreamEvent?: AgentStreamEventHandler;
  responseFormat?: ResponseFormat;
}

/**
 * Create the CallLLM stage function.
 */
export function createCallLLMStage(
  provider: LLMProvider,
  optionsOrHandler?: CallLLMStageOptions | AgentStreamEventHandler,
) {
  if (!provider) {
    throw new Error('createCallLLMStage: provider is required');
  }

  // Backward compat: accept bare handler or options object
  const stageOpts: CallLLMStageOptions = typeof optionsOrHandler === 'function'
    ? { onStreamEvent: optionsOrHandler }
    : optionsOrHandler ?? {};

  const { onStreamEvent, responseFormat } = stageOpts;

  return async (scope: TypedScope<AgentLoopState>) => {
    const messages = scope.messages ?? [];
    const tools = scope.toolDescriptions ?? [];
    const signal = scope.$getEnv()?.signal;
    const iteration = (scope.loopCount ?? 0) + 1;
    const startMs = Date.now();

    onStreamEvent?.({ type: 'llm_start', iteration });

    const options: LLMCallOptions = {
      ...(tools.length > 0 ? { tools } : {}),
      ...(signal ? { signal } : {}),
      ...(responseFormat ? { responseFormat } : {}),
    };
    const response = await provider.chat(messages, Object.keys(options).length > 0 ? options : undefined);

    // Write raw response for recorders to observe
    scope.adapterRawResponse = response;

    // Normalize to AdapterResult
    scope.adapterResult = normalizeAdapterResponse(response);

    // Write summary for narrative visibility
    const model = response.model ?? 'unknown';
    const usage = response.usage;
    const usageSummary = usage
      ? `${usage.inputTokens ?? '?'}in / ${usage.outputTokens ?? '?'}out`
      : 'no usage data';
    scope.llmCall = `${model} (${usageSummary})`;

    onStreamEvent?.({
      type: 'llm_end',
      iteration,
      toolCallCount: response.toolCalls?.length ?? 0,
      content: response.content,
      model: response.model,
      latencyMs: Date.now() - startMs,
    });
  };
}

/**
 * Streaming CallLLM stage — bridges LLMProvider.chatStream() with footprintjs StreamCallback
 * and emits AgentStreamEvents for consumer visibility.
 *
 * Events emitted:
 *   - llm_start { iteration } — before the LLM call
 *   - token { content } — each text chunk from the LLM
 *   - thinking { content } — extended thinking blocks (Anthropic)
 *   - llm_end { iteration, toolCallCount, content, model, latencyMs } — after LLM completes
 */

import type { TypedScope } from 'footprintjs';
import type { AgentLoopState } from '../../scope/types';
import type { LLMProvider, LLMResponse, ToolCall } from '../../types';
import type { AgentStreamEventHandler } from '../../streaming';
import { normalizeAdapterResponse } from './helpers';

/**
 * Create a streaming-capable CallLLM stage function.
 *
 * @param provider — LLM provider with chat() and optional chatStream()
 * @param onStreamEvent — optional event handler for AgentStreamEvents
 */
export function createStreamingCallLLMStage(
  provider: LLMProvider,
  onStreamEvent?: AgentStreamEventHandler,
) {
  return async (
    scope: TypedScope<AgentLoopState>,
    _breakFn: () => void,
    streamCallback?: (token: string) => void,
  ) => {
    const messages = scope.messages ?? [];
    const tools = scope.toolDescriptions ?? [];
    const signal = scope.$getEnv?.()?.signal;
    const options = tools.length > 0 || signal
      ? { ...(tools.length > 0 && { tools }), signal }
      : undefined;
    const iteration = (scope.loopCount ?? 0) + 1;
    const startMs = Date.now();

    onStreamEvent?.({ type: 'llm_start', iteration });

    // If streaming is available and callback is injected, use chatStream
    if (streamCallback && provider.chatStream) {
      const contentParts: string[] = [];
      const toolCalls: ToolCall[] = [];
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      for await (const chunk of provider.chatStream(messages, options)) {
        switch (chunk.type) {
          case 'token':
            if (chunk.content) {
              contentParts.push(chunk.content);
              streamCallback(chunk.content);
              // Token events are forwarded to consumer via footprintjs streamHandlers.onToken
              // in AgentRunner — don't emit here to avoid double delivery.
            }
            break;
          case 'tool_call':
            if (chunk.toolCall) {
              toolCalls.push(chunk.toolCall);
            }
            break;
          case 'usage':
            if (chunk.usage) {
              usage = chunk.usage;
            }
            break;
          case 'done':
            break;
        }
      }

      const content = contentParts.join('');
      const response: LLMResponse = {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
        model: 'model' in provider ? (provider.model as string) : undefined,
      };

      scope.adapterRawResponse = response;
      scope.adapterResult = normalizeAdapterResponse(response);

      onStreamEvent?.({
        type: 'llm_end',
        iteration,
        toolCallCount: toolCalls.length,
        content,
        model: response.model,
        latencyMs: Date.now() - startMs,
      });
      return;
    }

    // Fallback: non-streaming chat()
    const response = await provider.chat(messages, options);
    scope.adapterRawResponse = response;
    scope.adapterResult = normalizeAdapterResponse(response);

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

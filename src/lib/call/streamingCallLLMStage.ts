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
import type { LLMProvider, LLMResponse, LLMCallOptions, ResponseFormat, ToolCall } from '../../types';
import type { AgentStreamEventHandler } from '../../streaming';
import { normalizeAdapterResponse } from './helpers';

export interface StreamingCallLLMStageOptions {
  onStreamEvent?: AgentStreamEventHandler;
  responseFormat?: ResponseFormat;
}

/**
 * Create a streaming-capable CallLLM stage function.
 */
export function createStreamingCallLLMStage(
  provider: LLMProvider,
  optionsOrHandler?: StreamingCallLLMStageOptions | AgentStreamEventHandler,
) {
  // Backward compat: accept bare handler or options object
  const stageOpts: StreamingCallLLMStageOptions = typeof optionsOrHandler === 'function'
    ? { onStreamEvent: optionsOrHandler }
    : optionsOrHandler ?? {};

  const { onStreamEvent, responseFormat } = stageOpts;

  return async (
    scope: TypedScope<AgentLoopState>,
    _breakFn: () => void,
    streamCallback?: (token: string) => void,
  ) => {
    const messages = scope.messages ?? [];
    const tools = scope.toolDescriptions ?? [];
    const signal = scope.$getEnv?.()?.signal;
    const options: LLMCallOptions = {
      ...(tools.length > 0 ? { tools } : {}),
      ...(signal ? { signal } : {}),
      ...(responseFormat ? { responseFormat } : {}),
    };
    const iteration = (scope.loopCount ?? 0) + 1;
    const startMs = Date.now();

    onStreamEvent?.({ type: 'llm_start', iteration });

    // If streaming is available and callback is injected, use chatStream
    if (streamCallback && provider.chatStream) {
      const contentParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: ToolCall[] = [];
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      for await (const chunk of provider.chatStream(messages, Object.keys(options).length > 0 ? options : undefined)) {
        switch (chunk.type) {
          case 'thinking':
            if (chunk.content) {
              thinkingParts.push(chunk.content);
              // Emit as AgentStreamEvent.thinking (not as token)
              onStreamEvent?.({ type: 'thinking', content: chunk.content });
            }
            break;
          case 'token':
            if (chunk.content) {
              contentParts.push(chunk.content);
              streamCallback(chunk.content);
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
      const thinking = thinkingParts.length > 0 ? thinkingParts.join('') : undefined;
      const response: LLMResponse = {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
        model: 'model' in provider ? (provider.model as string) : undefined,
        thinking,
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

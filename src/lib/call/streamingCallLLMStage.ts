/**
 * Streaming CallLLM stage — bridges LLMProvider.chatStream() with footprintjs StreamCallback.
 *
 * When the provider supports chatStream(), tokens are emitted incrementally
 * via the footprintjs StreamCallback (3rd parameter to stage functions).
 * The full response is accumulated and written to scope as adapterResult.
 *
 * Falls back to non-streaming chat() if chatStream is not available or
 * if no StreamCallback is injected (non-streaming stage context).
 *
 * Use with `addStreamingFunction` on the flowchart builder:
 *   builder.addStreamingFunction('CallLLM', createStreamingCallLLMStage(provider), 'call-llm')
 */

import type { TypedScope } from 'footprintjs';
import type { LLMProvider, LLMToolDescription, LLMResponse, ToolCall } from '../../types';
import { normalizeAdapterResponse } from './helpers';

/**
 * Create a streaming-capable CallLLM stage function.
 *
 * The stage function signature matches footprintjs's StageFunction:
 *   (scope, breakFn, streamCallback?) => Promise<void>
 *
 * When streamCallback is provided (streaming stage), uses chatStream().
 * When not provided (regular stage fallback), uses chat().
 *
 * @example
 * ```typescript
 * // In buildAgentLoop — streaming mode
 * builder.addStreamingFunction(
 *   'CallLLM',
 *   createStreamingCallLLMStage(provider),
 *   'call-llm',
 *   'llm-stream',
 *   'Send messages + tools to LLM (streaming)',
 * );
 *
 * // Consumer receives tokens via StreamHandlers on executor:
 * executor.run({
 *   streamHandlers: {
 *     onToken: (streamId, token) => process.stdout.write(token),
 *     onStart: (streamId) => console.log('Streaming started...'),
 *     onEnd: (streamId) => console.log('\\nDone.'),
 *   },
 * });
 * ```
 */
export function createStreamingCallLLMStage(provider: LLMProvider) {
  return async (
    scope: TypedScope<any>,
    _breakFn: () => void,
    streamCallback?: (token: string) => void,
  ) => {
    const messages = scope.messages ?? [];
    const tools =
      (scope.$getValue('toolDescriptions') as LLMToolDescription[] | undefined) ?? [];
    const options = tools.length > 0 ? { tools } : undefined;

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

      // Build LLMResponse from accumulated stream — O(n) join instead of O(n²) concat
      const content = contentParts.join('');
      const response: LLMResponse = {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
        model: (provider as any).model,
      };

      scope.adapterRawResponse = response;
      scope.adapterResult = normalizeAdapterResponse(response);
      return;
    }

    // Fallback: non-streaming chat()
    const response = await provider.chat(messages, options);
    scope.adapterRawResponse = response;
    scope.adapterResult = normalizeAdapterResponse(response);
  };
}

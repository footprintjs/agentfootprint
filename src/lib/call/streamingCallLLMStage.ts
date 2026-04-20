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
import type {
  LLMProvider,
  LLMResponse,
  LLMCallOptions,
  ResponseFormat,
  ToolCall,
} from '../../types';
import { STREAM_EMIT_PREFIX } from '../../streaming';
import { normalizeAdapterResponse } from './helpers';

export interface StreamingCallLLMStageOptions {
  responseFormat?: ResponseFormat;
}

/**
 * Create a streaming-capable CallLLM stage function. Stream lifecycle
 * events (`llm_start`, `token`, `thinking`, `llm_end`) flow through
 * the emit channel — see `StreamEventRecorder` for the plumbing.
 */
export function createStreamingCallLLMStage(
  provider: LLMProvider,
  options?: StreamingCallLLMStageOptions,
) {
  const responseFormat = options?.responseFormat;

  return async (
    scope: TypedScope<AgentLoopState>,
    _breakFn: () => void,
    streamCallback?: (token: string) => void,
  ) => {
    const messages = scope.messages ?? [];
    const tools = scope.toolDescriptions ?? [];
    const signal = scope.$getEnv?.()?.signal;
    const callOpts: LLMCallOptions = {
      ...(tools.length > 0 ? { tools } : {}),
      ...(signal ? { signal } : {}),
      ...(responseFormat ? { responseFormat } : {}),
    };
    const iteration = (scope.loopCount ?? 0) + 1;
    const startMs = Date.now();

    scope.$emit(`${STREAM_EMIT_PREFIX}llm_start`, { type: 'llm_start', iteration });

    // ── Emit: request-side ─────────────────────────────────────────────
    // Mirror of callLLMStage.ts — surface the EXACT shape being sent so
    // attached EmitRecorders (including CombinedNarrativeRecorder) render
    // it inline under the CallLLM stage. Critical for debugging stuck
    // patterns like "LLM returns empty args every turn".
    scope.$emit('agentfootprint.llm.request', {
      iteration,
      messageCount: messages.length,
      messageRoles: messages.map((m) => m.role),
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      toolsWithRequired: tools.map((t) => ({
        name: t.name,
        description: t.description,
        required: (t.inputSchema as { required?: string[] } | undefined)?.required ?? [],
      })),
      hasResponseFormat: !!responseFormat,
    });

    // If streaming is available and callback is injected, use chatStream
    if (streamCallback && provider.chatStream) {
      const contentParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: ToolCall[] = [];
      let usage: { inputTokens: number; outputTokens: number } | undefined;

      for await (const chunk of provider.chatStream(
        messages,
        Object.keys(callOpts).length > 0 ? callOpts : undefined,
      )) {
        switch (chunk.type) {
          case 'thinking':
            if (chunk.content) {
              thinkingParts.push(chunk.content);
              scope.$emit(`${STREAM_EMIT_PREFIX}thinking`, {
                type: 'thinking',
                content: chunk.content,
              });
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
      const latencyMs = Date.now() - startMs;

      scope.$emit('agentfootprint.llm.response', {
        iteration,
        model: response.model,
        stopReason: (response as { finishReason?: string }).finishReason,
        usage: response.usage,
        content: response.content,
        toolCalls: (response.toolCalls ?? []).map((tc) => ({
          name: tc.name,
          arguments: tc.arguments,
        })),
        latencyMs,
      });

      scope.$emit(`${STREAM_EMIT_PREFIX}llm_end`, {
        type: 'llm_end',
        iteration,
        toolCallCount: toolCalls.length,
        content,
        model: response.model,
        latencyMs,
        usage: response.usage,
        stopReason: (response as { finishReason?: string }).finishReason,
      });
      return;
    }

    // Fallback: non-streaming chat()
    const response = await provider.chat(messages, callOpts);
    scope.adapterRawResponse = response;
    scope.adapterResult = normalizeAdapterResponse(response);
    const latencyMs = Date.now() - startMs;

    scope.$emit('agentfootprint.llm.response', {
      iteration,
      model: response.model,
      stopReason: (response as { finishReason?: string }).finishReason,
      usage: response.usage,
      content: response.content,
      toolCalls: (response.toolCalls ?? []).map((tc) => ({
        name: tc.name,
        arguments: tc.arguments,
      })),
      latencyMs,
    });

    scope.$emit(`${STREAM_EMIT_PREFIX}llm_end`, {
      type: 'llm_end',
      iteration,
      toolCallCount: response.toolCalls?.length ?? 0,
      content: response.content,
      model: response.model,
      latencyMs,
      usage: response.usage,
      stopReason: (response as { finishReason?: string }).finishReason,
    });
  };
}

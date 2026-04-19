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
 * Emits on the footprintjs emit channel:
 *   - `agentfootprint.llm.request` — outgoing LLM shape (messages/tools/etc.)
 *   - `agentfootprint.llm.response` — raw adapter response
 *   - `agentfootprint.stream.llm_start`  (full AgentStreamEvent as payload)
 *   - `agentfootprint.stream.llm_end`    (full AgentStreamEvent as payload)
 *
 * Stream events route via emit so there's zero closure capture of
 * per-run callbacks. `AgentRunner` attaches a `StreamEventRecorder`
 * that translates these emits to the caller's `{ onEvent }` callback.
 */

import type { TypedScope } from 'footprintjs';
import type { AgentLoopState } from '../../scope/types';
import type { LLMProvider, LLMCallOptions, ResponseFormat } from '../../types';
import { STREAM_EMIT_PREFIX } from '../../streaming';
import { normalizeAdapterResponse } from './helpers';

export interface CallLLMStageOptions {
  responseFormat?: ResponseFormat;
}

/**
 * Create the CallLLM stage function.
 */
export function createCallLLMStage(provider: LLMProvider, options?: CallLLMStageOptions) {
  if (!provider) {
    throw new Error('createCallLLMStage: provider is required');
  }
  const responseFormat = options?.responseFormat;

  return async (scope: TypedScope<AgentLoopState>) => {
    const messages = scope.messages ?? [];
    const tools = scope.toolDescriptions ?? [];
    const signal = scope.$getEnv()?.signal;
    const iteration = (scope.loopCount ?? 0) + 1;
    const startMs = Date.now();

    scope.$emit(`${STREAM_EMIT_PREFIX}llm_start`, { type: 'llm_start', iteration });

    // ── Emit: request-side ─────────────────────────────────────────────
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

    const callOpts: LLMCallOptions = {
      ...(tools.length > 0 ? { tools } : {}),
      ...(signal ? { signal } : {}),
      ...(responseFormat ? { responseFormat } : {}),
    };
    const response = await provider.chat(
      messages,
      Object.keys(callOpts).length > 0 ? callOpts : undefined,
    );

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

    const latencyMs = Date.now() - startMs;

    // ── Emit: response-side ─────────────────────────────────────────────
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
    });
  };
}

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
  const stageOpts: CallLLMStageOptions =
    typeof optionsOrHandler === 'function'
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

    // ── Emit: request-side ─────────────────────────────────────────────
    //
    // Surface the EXACT shape the adapter is about to send. Any attached
    // EmitRecorder (including CombinedNarrativeRecorder) will render this
    // inline in the narrative under the CallLLM stage.
    //
    // This is diagnostic data (not business state) — using $emit avoids
    // polluting scope with duplicate per-iteration writes, while still
    // giving consumers real-time visibility into what was sent. The
    // library's existing adapterRawResponse scope write covers the
    // response side for the scope-data narrative path.
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

    const options: LLMCallOptions = {
      ...(tools.length > 0 ? { tools } : {}),
      ...(signal ? { signal } : {}),
      ...(responseFormat ? { responseFormat } : {}),
    };
    const response = await provider.chat(
      messages,
      Object.keys(options).length > 0 ? options : undefined,
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

    // ── Emit: response-side ─────────────────────────────────────────────
    //
    // Surface the full LLM response — model, usage, stop_reason, tool-call
    // signatures (name + args). The (name, args) view is the critical one
    // for debugging stuck patterns like "LLM returns empty args every turn".
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
      latencyMs: Date.now() - startMs,
    });

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

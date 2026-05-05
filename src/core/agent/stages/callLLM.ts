/**
 * callLLM — the LLM-invocation stage of the agent's chart.
 *
 * Reads the assembled prompt + messages from scope (populated by the
 * upstream slot subflows: SystemPrompt, Messages, Tools, CacheDecision,
 * CacheGate). Calls `provider.stream()` if available (token streaming
 * with per-chunk events) else falls back to `provider.complete()`.
 * Writes the response to scope (`llmLatestContent`, `llmLatestToolCalls`,
 * cumulative tokens) for the downstream Route decider to read.
 *
 * Emits `agentfootprint.stream.llm_start` + `llm_end` brackets for
 * observability adapters and per-chunk `stream.token` events during
 * streaming. Emits `cost.tick` via `emitCostTick` when a `pricingTable`
 * is configured.
 *
 * Factory signature so the chart-build-time provider/model/etc. deps
 * are explicit. The `toolSchemas` value is late-bound via a getter
 * because tool schema composition completes after the seed factory is
 * built but before the chart actually runs.
 */

import type { TypedScope } from 'footprintjs';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
  PricingTable,
} from '../../../adapters/types.js';
import type { CacheMarker, CacheStrategy } from '../../../cache/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';
import { emitCostTick } from '../../cost.js';
import type { ReliabilityConfig } from '../../../reliability/types.js';
import { executeWithReliability } from './reliabilityExecution.js';
import type { AgentState } from '../types.js';

export interface CallLLMStageDeps {
  /** The LLM provider to invoke. */
  readonly provider: LLMProvider;
  /** Model identifier passed to provider.complete/stream. */
  readonly model: string;
  /** Optional sampling temperature. */
  readonly temperature?: number;
  /** Optional max output tokens. */
  readonly maxTokens?: number;
  /** Optional pricing adapter for cost tracking. */
  readonly pricingTable?: PricingTable;
  /** Optional cumulative USD cap per run. */
  readonly costBudget?: number;
  /** Hard ReAct iteration cap (used to compute iterationsRemaining for
   *  the cache strategy's prepareRequest hook). */
  readonly maxIterations: number;
  /** Cache strategy (provider-aware; v2.6+). Pass-through if no markers. */
  readonly cacheStrategy: CacheStrategy;
  /** Static tool schemas, late-bound (see seed.ts for the same
   *  pattern — toolSchemas is computed AFTER stage factories are
   *  built). The getter resolves the eventual value at run time. */
  readonly toolSchemas: readonly LLMToolSchema[];
  /** Optional rules-based reliability config (v2.11.5+). When set,
   *  the call is wrapped in a retry/fallback/fail-fast loop driven
   *  by `config.preCheck` and `config.postDecide` rules. Streaming
   *  is preserved; mid-stream failures use first-chunk arbitration —
   *  see `reliabilityExecution.ts` and the streaming + reliability
   *  design memo. */
  readonly reliability?: ReliabilityConfig;
}

/**
 * Build the callLLM stage function. Captures the LLM provider + model
 * config + cache strategy via the deps object; everything per-iteration
 * comes from scope.
 */
export function buildCallLLMStage(
  deps: CallLLMStageDeps,
): (scope: TypedScope<AgentState>) => Promise<void> {
  return async (scope) => {
    const systemPromptInjections =
      (scope.systemPromptInjections as readonly InjectionRecord[]) ?? [];
    // `scope.messagesInjections` is read by ContextRecorder for
    // observability; the LLM-wire path now reads scope.history directly.
    const iteration = scope.iteration;

    const systemPrompt = systemPromptInjections
      .map((r) => r.rawContent ?? '')
      .filter((s) => s.length > 0)
      .join('\n\n');

    // Read the LLM message stream from `scope.history` directly. The
    // `messagesInjections` projection is for observability — it
    // flattens InjectionRecords for event reporting and doesn't carry
    // the full LLM-protocol shape (assistant `toolCalls[]`, etc.). For
    // Anthropic's API contract we need the original LLMMessage with
    // `toolCalls` intact so tool_use → tool_result correlation survives.
    const messages = (scope.history as readonly LLMMessage[] | undefined) ?? [];

    typedEmit(scope, 'agentfootprint.stream.llm_start', {
      iteration,
      provider: deps.provider.name,
      model: deps.model,
      systemPromptChars: systemPrompt.length,
      messagesCount: messages.length,
      toolsCount: deps.toolSchemas.length,
      ...(deps.temperature !== undefined && { temperature: deps.temperature }),
    });

    const startMs = Date.now();
    // Use dynamic schemas — registry tools + injection-supplied tools
    // (Skills' `inject.tools` when their Injection is active). Falls
    // back to the static schemas at startup before the tools slot has
    // run for the first time.
    const activeToolSchemas =
      (scope.dynamicToolSchemas as readonly LLMToolSchema[] | undefined) ?? deps.toolSchemas;
    const baseRequest = {
      ...(systemPrompt.length > 0 && { systemPrompt }),
      messages,
      ...(activeToolSchemas.length > 0 && { tools: activeToolSchemas }),
      model: deps.model,
      ...(deps.temperature !== undefined && { temperature: deps.temperature }),
      ...(deps.maxTokens !== undefined && { maxTokens: deps.maxTokens }),
    };
    // v2.6+ — call cache strategy to attach provider-specific cache
    // hints. CacheGate has already routed (apply-markers / no-markers)
    // and populated scope.cacheMarkers accordingly. Strategy.prepareRequest
    // is a pass-through for empty markers.
    const cacheMarkers = (scope.cacheMarkers as readonly CacheMarker[] | undefined) ?? [];
    const cachePrepared = await deps.cacheStrategy.prepareRequest(baseRequest, cacheMarkers, {
      iteration,
      iterationsRemaining: Math.max(0, deps.maxIterations - iteration),
      recentHitRate: scope.recentHitRate,
      cachingDisabled: scope.cachingDisabled ?? false,
    });
    const llmRequest = cachePrepared.request;

    // Streaming-first: when the provider implements `stream()` we
    // consume chunk-by-chunk so consumers see tokens as they arrive
    // instead of waiting for the full LLM call to finish. Each
    // non-terminal chunk fires `agentfootprint.stream.token`. The
    // terminal chunk SHOULD carry the authoritative `LLMResponse`;
    // when it doesn't (older providers, partial implementations) we
    // fall back to `complete()` for the authoritative payload —
    // keeping the ReAct loop deterministic.
    //
    // `singleProviderCall` is the per-attempt call function. Used
    // directly when reliability is OFF; passed into `executeWithReliability`
    // when reliability is configured (the helper invokes it once per
    // retry-loop iteration).
    const singleProviderCall = async (
      req: LLMRequest,
      hooks: { onFirstChunk?: () => void },
    ): Promise<LLMResponse> => {
      let resp: LLMResponse | undefined;
      let firstChunkFired = false;
      if (deps.provider.stream) {
        for await (const chunk of deps.provider.stream(req)) {
          if (chunk.done) {
            if (chunk.response) resp = chunk.response;
            break;
          }
          if (chunk.content.length > 0) {
            if (!firstChunkFired) {
              firstChunkFired = true;
              hooks.onFirstChunk?.();
            }
            typedEmit(scope, 'agentfootprint.stream.token', {
              iteration,
              tokenIndex: chunk.tokenIndex,
              content: chunk.content,
            });
          }
        }
      }
      if (!resp) {
        // No `stream()` OR stream finished without a response payload.
        resp = await deps.provider.complete(req);
      }
      return resp;
    };

    let response: LLMResponse | undefined;
    if (deps.reliability) {
      response = await executeWithReliability(
        scope,
        llmRequest,
        deps.reliability,
        deps.provider,
        deps.provider.name,
        deps.model,
        singleProviderCall,
      );
      // `executeWithReliability` returns `undefined` when it took the
      // fail-fast path. It already wrote scope state and called
      // `$break(reason)` — `Agent.run()` translates the propagated
      // break into a `ReliabilityFailFastError` at the API boundary.
      // Skip the post-call state writes; there is no response to commit.
      if (response === undefined) return;
    } else {
      response = await singleProviderCall(llmRequest, {});
    }
    const durationMs = Date.now() - startMs;

    scope.totalInputTokens = scope.totalInputTokens + response.usage.input;
    scope.totalOutputTokens = scope.totalOutputTokens + response.usage.output;
    scope.llmLatestContent = response.content;
    scope.llmLatestToolCalls = response.toolCalls;

    typedEmit(scope, 'agentfootprint.stream.llm_end', {
      iteration,
      content: response.content,
      toolCallCount: response.toolCalls.length,
      usage: response.usage,
      stopReason: response.stopReason,
      durationMs,
    });

    emitCostTick(scope, deps.pricingTable, deps.costBudget, deps.model, response.usage);
  };
}

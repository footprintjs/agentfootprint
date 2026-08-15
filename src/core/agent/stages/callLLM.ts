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
import { resilienceHooks } from '../../../recorders/core/resilienceHooks.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';
import { emitCostTick, type ResolvedCostBudget } from '../../cost.js';
import type { ReliabilityConfig } from '../../../reliability/types.js';
import { applyOutputSchema, type OutputSchemaParser } from '../../outputSchema.js';
import { readSchemaToolAnswer } from '../outputEnforcement.js';
import {
  executeWithReliability,
  ValidationFailure,
  type OutputSchemaValidator,
} from './reliabilityExecution.js';
import type { AgentState } from '../types.js';

/**
 * Drop the fields that exist for the library and never for the model.
 *
 * Today that is exactly one: `injectedBy`, the delivery marker (7.21).
 * Messages without it pass through by reference, so an agent that delivers
 * nothing allocates nothing — and the array's length and order are untouched
 * either way, which is what keeps `CacheMarker{field:'messages'}` honest.
 */
function stripFrameworkFields(messages: readonly LLMMessage[]): readonly LLMMessage[] {
  if (!messages.some((m) => m.injectedBy !== undefined)) return messages;
  return messages.map((m) => {
    if (m.injectedBy === undefined) return m;
    const { injectedBy: _marker, ...wire } = m;
    void _marker;
    return wire;
  });
}

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
  readonly costBudget?: ResolvedCostBudget;
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
  /** Optional output-schema parser (v2.13+). When set AND `reliability`
   *  is also set, the loop validates the LLM response against this
   *  parser on terminal turns (no toolCalls). Failures classify as
   *  `errorKind: 'schema-fail'` so PostDecide rules can route to
   *  retry-with-feedback (Instructor pattern). When `reliability` is
   *  NOT set, validation only happens at `agent.parseOutput()` boundary
   *  (existing v2.4 behavior). */
  readonly outputSchemaParser?: OutputSchemaParser<unknown>;
  /**
   * The synthetic tool the `'tool-forced'` output strategy puts on the wire
   * (7.26). Present ONLY under that strategy; under `'instruct'` — the
   * default — this is undefined and not one line below it runs.
   *
   * When present, the tool is appended to the request's tool list and the
   * request carries `toolChoice`, so the provider constrains generation to
   * this shape instead of the model being asked in prose to comply. It is
   * added HERE, at request assembly, and nowhere else: that is what keeps it
   * off `.tools()`, out of the tools slot and its `tools.offered` event, off
   * any MCP server's served list, and away from the dispatcher that runs
   * tools and files middleware rows. It is the strategy's mechanism, not the
   * agent's surface.
   */
  readonly schemaTool?: LLMToolSchema;
  /** v2.14+ — request-side thinking budget. When set, every LLMRequest
   *  carries `thinking: { budget }` so the provider activates extended
   *  thinking. Undefined = no activation (default). */
  readonly thinkingBudget?: number;
  /**
   * True when the agent was built with `.configure()`. Only then does this
   * stage read `scope.resolvedModel` — the per-run model seed committed.
   * Gating on a build-time flag (rather than always reading and falling
   * back) keeps an unconfigured agent's recorded reads unchanged, which is
   * what "absent option = byte-identical" has to mean for a library whose
   * product is the recording.
   */
  readonly runConfigured?: boolean;
  /**
   * "The cursor picks the brain" (9.19.0). Consulted ONCE at the top of the
   * stage with the ADVANCED cursor — `scope.nextSkillCursor ??
   * scope.currentSkillId`, correct in BOTH chart shapes: inside
   * `sf-llm-call` the boundary's `currentSkillId` is a readonly input still
   * holding the previous iteration's cursor and the advanced one lives
   * under `nextSkillCursor`; in the flat chart the engine's outputMapper
   * has already written `currentSkillId` to the advanced value — and with
   * the run's escalation flag (`scope.skillEscalated`, threaded across the
   * `sf-llm-call` boundary by the grouped chart's mappers). The result
   * resolves field by field down the STATED precedence chain:
   *
   *   **escalation > per-skill brain > `.configure()` `resolvedModel` >
   *   build-time default** — `provider = brain?.provider ?? deps.provider`;
   *   `model = brain?.model ?? (runConfigured ? scope.resolvedModel :
   *   undefined) ?? deps.model`; `cacheStrategy = brain?.cacheStrategy ??
   *   deps.cacheStrategy`. A brain naming only a model inherits the agent's
   *   provider; a foreign provider without a model was refused at build.
   *
   * Undefined — no brain declared anywhere — and this stage reads no new
   * scope key, resolves exactly as before, and `llm_start` keeps its exact
   * bytes (the additive `brain` field appears only when a rung won).
   */
  readonly brainFor?: import('../skillBrains.js').BrainFor;
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

    // "The cursor picks the brain" (9.19.0) — ONE consult, at the top, with
    // the advanced cursor and the escalation flag. Gated on `deps.brainFor`
    // so an agent without brains reads no new scope key and resolves on the
    // exact line it always did.
    const brain = deps.brainFor
      ? deps.brainFor(
          (scope.nextSkillCursor ?? scope.currentSkillId) as string | undefined,
          scope.skillEscalated === true,
        )
      : undefined;
    const provider = brain?.provider ?? deps.provider;
    const cacheStrategy = brain?.cacheStrategy ?? deps.cacheStrategy;

    // The model for this run. `.configure()` resolved it at seed and
    // COMMITTED it to scope, so what gets called, what the `llm_start`
    // event reports and what cost is priced against are all one value —
    // the one the trace records. Without `.configure()` this is the
    // build-time model and scope is never touched. A winning brain rung
    // (9.19.0) outranks both — the stated precedence chain.
    const model =
      brain?.model ??
      (deps.runConfigured ? (scope.resolvedModel as string | undefined) : undefined) ??
      deps.model;

    // Per-iteration boundary marker (was a dedicated `IterationStart` stage —
    // folded here since emitting is passive observability, not work that needs
    // its own execution stage). Fires FIRST, before the LLM call, so recorders
    // still bracket each ReAct iteration. Payload unchanged (turnIndex reserved
    // for future multi-turn; iterIndex is the per-iteration counter).
    typedEmit(scope, 'agentfootprint.agent.iteration_start', {
      turnIndex: 0,
      iterIndex: iteration,
    });

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
    // `stripFrameworkFields` takes off `injectedBy` — the marker the delivery
    // stage stamps so the messages slot can say WHO put a message here. It is
    // framework bookkeeping, not conversation, and it is removed BEFORE the
    // request exists rather than trusted to be ignored: a consumer-authored
    // adapter that serializes a message wholesale would otherwise put library
    // internals on someone's wire. Stripping removes a FIELD, never a message,
    // so `messages[i]` is still the message the cache marker's index names.
    const messages = stripFrameworkFields(
      (scope.history as readonly LLMMessage[] | undefined) ?? [],
    );

    // Dynamic schemas — registry tools + injection-supplied tools (Skills'
    // `inject.tools` when their Injection is active). Falls back to the static
    // schemas at startup before the tools slot has run. Computed BEFORE the
    // llm_start emit so the event reports what the model ACTUALLY saw this call
    // (count + the name/description catalog), not the static startup set.
    const registeredToolSchemas =
      (scope.dynamicToolSchemas as readonly LLMToolSchema[] | undefined) ?? deps.toolSchemas;
    // Under `'tool-forced'` the schema rides along as one more tool ON THE
    // WIRE. It is reported in `llm_start` too, and deliberately: that event's
    // whole claim is "what the model actually saw this call", and a tool the
    // model was forced to use is the last thing to leave out of it.
    const activeToolSchemas = deps.schemaTool
      ? [...registeredToolSchemas, deps.schemaTool]
      : registeredToolSchemas;

    typedEmit(scope, 'agentfootprint.stream.llm_start', {
      iteration,
      provider: provider.name,
      model,
      systemPromptChars: systemPrompt.length,
      messagesCount: messages.length,
      toolsCount: activeToolSchemas.length,
      // WHICH BRAIN answered (9.19.0) — stamped ONLY when a brain rung won,
      // so configured/default runs keep byte-identical events.
      ...(brain !== undefined && {
        brain: {
          via: brain.via,
          ...(brain.skillId !== undefined && { skillId: brain.skillId }),
        },
      }),
      ...(activeToolSchemas.length > 0 && {
        tools: activeToolSchemas.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
        })),
      }),
      ...(deps.temperature !== undefined && { temperature: deps.temperature }),
    });

    const startMs = Date.now();
    const baseRequest = {
      ...(systemPrompt.length > 0 && { systemPrompt }),
      messages,
      ...(activeToolSchemas.length > 0 && { tools: activeToolSchemas }),
      model,
      ...(deps.temperature !== undefined && { temperature: deps.temperature }),
      ...(deps.maxTokens !== undefined && { maxTokens: deps.maxTokens }),
      ...(deps.thinkingBudget !== undefined && {
        thinking: { budget: deps.thinkingBudget },
      }),
      ...(deps.schemaTool !== undefined && {
        toolChoice: { type: 'tool' as const, name: deps.schemaTool.name },
      }),
    };
    // v2.6+ — call cache strategy to attach provider-specific cache
    // hints. CacheGate has already routed (apply-markers / no-markers)
    // and populated scope.cacheMarkers accordingly. Strategy.prepareRequest
    // is a pass-through for empty markers.
    const cacheMarkers = (scope.cacheMarkers as readonly CacheMarker[] | undefined) ?? [];
    const cachePrepared = await cacheStrategy.prepareRequest(baseRequest, cacheMarkers, {
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
    //
    // `providerHooks` is the resilience-report channel handed to the
    // provider on every call. When `deps.provider` is decorated
    // (withFallback / withRetry / withCircuitBreaker) its reports become
    // in-run typed events with this stage's real runtimeStageId. Built
    // once per stage — stateless, reused across reliability-loop
    // iterations. Named to avoid shadowing `singleProviderCall`'s own
    // `hooks` parameter, which is the unrelated `{ onFirstChunk }` bag.
    const providerHooks = resilienceHooks(scope);
    const singleProviderCall = async (
      req: LLMRequest,
      hooks: { onFirstChunk?: () => void },
    ): Promise<LLMResponse> => {
      let resp: LLMResponse | undefined;
      let firstChunkFired = false;
      if (provider.stream) {
        for await (const chunk of provider.stream(req, providerHooks)) {
          if (chunk.done) {
            if (chunk.response) resp = chunk.response;
            break;
          }
          // A provider is a port anyone can implement, and a non-terminal
          // chunk that carries no `content` used to die on the next line as
          // `Cannot read properties of undefined (reading 'length')` —
          // naming neither the provider nor the contract it missed. The
          // commonest shape of the mistake is a chunk that ends the stream
          // with its own marker instead of `done: true`, which is why the
          // refusal says what the terminal chunk looks like.
          if (typeof (chunk.content as unknown) !== 'string') {
            throw new TypeError(
              `provider '${provider.name}' yielded a stream chunk whose \`content\` is ` +
                `${chunk.content === undefined ? 'missing' : `a ${typeof chunk.content}`}. ` +
                `Every chunk from LLMProvider.stream() is ` +
                `{ tokenIndex: number, content: string, done: boolean }, and the LAST one is ` +
                `{ content: '', done: true, response } — the response payload rides the ` +
                `terminal chunk. A chunk that ends the stream any other way is not seen as ` +
                `terminal, and its missing content stops the run here.`,
            );
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
        // Raw errors propagate so the reliability loop can classify them;
        // friendly translation happens at the terminal ErrorBridge.
        //
        // Hooks are passed to BOTH phases. A decorated provider that falls
        // back in each reports twice — deliberately NOT deduped, because
        // those are two genuinely billed calls and collapsing them would
        // hide real double-billing. (That this branch can re-call at all
        // after a stream is a pre-existing quirk; see MENTAL_MODEL §14.)
        resp = await provider.complete(req, providerHooks);
      }
      // `'tool-forced'`: the answer arrived as the synthetic tool's ARGUMENTS,
      // so it is moved into `content` and the call is taken off the list here,
      // at the single seam every later reader goes through. Everything
      // downstream — the reliability validator, the scope writes, the Route
      // decider, the retry loop — then sees the response it would have seen
      // under `'instruct'`: a final answer that is a JSON string, and no tool
      // calls. One normalization, no second code path, and nothing further
      // down has to know which strategy is in force.
      const forcedName = deps.schemaTool?.name;
      if (forcedName !== undefined) {
        const answer = readSchemaToolAnswer(resp);
        if (answer !== undefined) {
          resp = {
            ...resp,
            content: answer,
            toolCalls: resp.toolCalls.filter((tc) => tc.name !== forcedName),
          };
        }
      }
      return resp;
    };

    // v2.13 — build the output-schema validator hook when both
    // reliability + outputSchemaParser are configured. The reliability
    // loop applies the validator only on terminal turns (toolCalls
    // empty) so tool-using turns aren't rejected for failing the final-
    // answer schema. ValidationFailure carries `stage` + `path` for the
    // typed event payload.
    let postValidate: OutputSchemaValidator | undefined;
    if (deps.outputSchemaParser !== undefined) {
      const parser = deps.outputSchemaParser;
      postValidate = (response) => {
        try {
          applyOutputSchema(response.content, parser);
        } catch (err) {
          // applyOutputSchema throws OutputSchemaError with
          // {stage, rawOutput, cause}. Convert to ValidationFailure for
          // the gate's typed handling. Pull a `path` if the underlying
          // cause exposes Zod-style issues. Use the cause's message
          // (the actual parser error) when available, falling back to
          // the wrapper's message for parsers without a cause.
          const e = err as {
            message: string;
            stage?: 'json-parse' | 'schema-validate';
            rawOutput?: string;
            cause?: {
              message?: string;
              issues?: ReadonlyArray<{ path?: ReadonlyArray<string | number> }>;
            };
          };
          let path: string | undefined;
          const firstIssue = e.cause?.issues?.[0];
          if (firstIssue?.path && firstIssue.path.length > 0) {
            path = firstIssue.path.join('.');
          }
          // Use cause message when present (parsers like Zod attach the
          // real error as cause); fall back to wrapper message.
          const message = e.cause?.message ?? e.message;
          throw new ValidationFailure({
            message,
            stage: e.stage ?? 'schema-validate',
            ...(path !== undefined && { path }),
            ...(e.rawOutput !== undefined && { rawOutput: e.rawOutput }),
          });
        }
      };
    }

    let response: LLMResponse | undefined;
    if (deps.reliability) {
      response = await executeWithReliability(
        scope,
        llmRequest,
        deps.reliability,
        provider,
        provider.name,
        model,
        singleProviderCall,
        postValidate,
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
    // v2.14 — hand provider-specific raw thinking data to the
    // NormalizeThinking sub-subflow (the next stage in sf-call-llm
    // when a ThinkingHandler is configured). Undefined when the
    // provider has no thinking content for this call (most calls).
    if (response.rawThinking !== undefined) {
      (scope as TypedScope<AgentState> & { rawThinking: unknown }).rawThinking =
        response.rawThinking;
    }

    typedEmit(scope, 'agentfootprint.stream.llm_end', {
      iteration,
      content: response.content,
      toolCallCount: response.toolCalls.length,
      usage: response.usage,
      stopReason: response.stopReason,
      durationMs,
    });

    // `provider` here is the EFFECTIVE one — a per-skill `brain` overrides the
    // agent's, and the bill follows the call, not the configuration.
    emitCostTick(
      scope,
      deps.pricingTable,
      deps.costBudget,
      { provider: provider.name, model },
      response.usage,
    );
  };
}

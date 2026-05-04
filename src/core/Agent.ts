/**
 * Agent — ReAct primitive (LLM + tools + iteration loop).
 *
 * Pattern: Builder (GoF) → produces a Runner backed by a footprintjs FlowChart.
 * Role:    Layer-5 primitive (core/). Assembles the 3-slot context
 *          pipeline + callLLM + route decider + tool-calls subflow +
 *          loopTo. Composition nestable anywhere that accepts a Runner.
 * Emits:   Via internal recorders:
 *            agentfootprint.agent.turn_start / turn_end
 *            agentfootprint.agent.iteration_start / iteration_end
 *            agentfootprint.agent.route_decided
 *            agentfootprint.stream.llm_start / llm_end
 *            agentfootprint.stream.tool_start / tool_end
 *            agentfootprint.context.* (via ContextRecorder)
 */

import {
  FlowChartExecutor,
  flowChart,
  type CombinedNarrativeEntry,
  type FlowChart,
  type FlowchartCheckpoint,
  type RunOptions,
  type RuntimeSnapshot,
  type TypedScope,
} from 'footprintjs';
// ArrayMergeMode lives on footprintjs's `advanced` subpath, not its
// main barrel. Used to set `arrayMerge: Replace` on subflow output
// mapping for the Tools slot — the slot's deduped tool list must
// REPLACE the parent's `dynamicToolSchemas` rather than concatenate
// with it (default behavior re-introduces duplicate tool names that
// LLM providers reject).
import { ArrayMergeMode } from 'footprintjs/advanced';
import type { CachePolicy, CacheStrategy } from '../cache/types.js';
import { cacheDecisionSubflow } from '../cache/CacheDecisionSubflow.js';
import {
  cacheGateDecide,
  updateSkillHistory as updateSkillHistoryStage,
} from '../cache/CacheGateDecider.js';
import { getDefaultCacheStrategy } from '../cache/strategyRegistry.js';
import { type RunnerPauseOutcome } from './pause.js';
import type {
  LLMProvider,
  LLMMessage,
  LLMToolSchema,
  PermissionChecker,
  PricingTable,
} from '../adapters/types.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { STAGE_IDS, SUBFLOW_IDS } from '../conventions.js';
import { defaultCommentaryTemplates } from '../recorders/observability/commentary/commentaryTemplates.js';
import { defaultThinkingTemplates } from '../recorders/observability/thinking/thinkingTemplates.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { costRecorder } from '../recorders/core/CostRecorder.js';
import { permissionRecorder } from '../recorders/core/PermissionRecorder.js';
import { evalRecorder } from '../recorders/core/EvalRecorder.js';
import { memoryRecorder } from '../recorders/core/MemoryRecorder.js';
import { skillRecorder } from '../recorders/core/SkillRecorder.js';
import { typedEmit } from '../recorders/core/typedEmit.js';
import type { MemoryDefinition } from '../memory/define.types.js';
import { memoryInjectionKey } from '../memory/define.types.js';
import { unwrapMemoryFlowChart } from '../memory/define.js';
import { mountMemoryRead, mountMemoryWrite } from '../memory/wire/mountMemoryPipeline.js';
import { buildSystemPromptSlot } from './slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from './slots/buildMessagesSlot.js';
import { buildToolsSlot } from './slots/buildToolsSlot.js';
import { buildInjectionEngineSubflow } from '../lib/injection-engine/buildInjectionEngineSubflow.js';
import { buildReadSkillTool } from '../lib/injection-engine/skillTools.js';
import type { ActiveInjection, Injection } from '../lib/injection-engine/types.js';
import { defineInstruction } from '../lib/injection-engine/factories/defineInstruction.js';
import {
  applyOutputFallback,
  validateCannedAgainstSchema,
  type OutputFallbackFn,
  type OutputFallbackOptions,
  type ResolvedOutputFallback,
} from './outputFallback.js';
import {
  buildCheckpoint,
  classifyFailurePhase,
  RunCheckpointError,
  validateCheckpoint,
  type AgentRunCheckpoint,
  type RunCheckpointTracker,
} from './runCheckpoint.js';
import {
  applyOutputSchema,
  buildDefaultInstruction,
  OutputSchemaError,
  type OutputSchemaOptions,
  type OutputSchemaParser,
} from './outputSchema.js';
import { RunnerBase, makeRunId } from './RunnerBase.js';
import type { Tool, ToolRegistryEntry } from './tools.js';
import type { ToolProvider } from '../tool-providers/types.js';
import {
  clampIterations,
  validateMemoryIdUniqueness,
  validateToolNameUniqueness,
} from './agent/validators.js';
import type { AgentInput, AgentOptions, AgentOutput, AgentState } from './agent/types.js';
import { breakFinalStage } from './agent/stages/breakFinal.js';
import { iterationStartStage } from './agent/stages/iterationStart.js';
import { routeDeciderStage } from './agent/stages/route.js';
import { buildSeedStage } from './agent/stages/seed.js';
import { buildCallLLMStage } from './agent/stages/callLLM.js';
import { buildToolCallsHandler } from './agent/stages/toolCalls.js';

// Re-export public Agent types so the 28+ existing import sites
// (e.g., `import { type AgentInput } from '../core/Agent.js'`) keep
// working while implementation gradually moves into `./agent/*`.
// Public types canonically live in `./agent/types.ts` (v2.11.1).
export type { AgentInput, AgentOptions, AgentOutput };

// Public types (AgentOptions, AgentInput, AgentOutput) extracted to
// ./agent/types.ts and re-exported above (v2.11.1).

// AgentState extracted to ./agent/types.ts (v2.11.1).

export class Agent extends RunnerBase<AgentInput, AgentOutput> {
  readonly name: string;
  readonly id: string;
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly maxIterations: number;
  private readonly systemPromptValue: string;
  /**
   * Cache policy for the base system prompt (set via
   * `.system(text, { cache })`). Default `'always'` — base prompt is
   * stable per-turn, ideal cache anchor. CacheDecision subflow reads
   * this when computing the SystemPrompt slot's cache markers.
   */
  private readonly systemPromptCachePolicy: CachePolicy;
  /**
   * Global cache kill switch from `Agent.create({ caching: 'off' })`.
   * Threaded into agent scope at seed-time as `scope.cachingDisabled`;
   * read by the CacheGate decider every iteration (highest-priority rule).
   */
  private readonly cachingDisabledValue: boolean;
  /**
   * Provider-specific CacheStrategy. Auto-resolved from
   * `getDefaultCacheStrategy(provider.name)` at agent build time
   * unless the consumer explicitly passes one via builder option.
   * Phase 7+ implementations (Anthropic, OpenAI, Bedrock) register
   * themselves in the strategyRegistry on import.
   */
  private readonly cacheStrategy: CacheStrategy;
  private readonly registry: readonly ToolRegistryEntry[];
  /**
   * The Injection list — Skills, Steering, Instructions, Facts (and
   * RAG, Memory). Evaluated each iteration by the
   * InjectionEngine subflow; active set is filtered by slot subflows.
   */
  private readonly injections: readonly Injection[];
  private readonly pricingTable?: PricingTable;
  private readonly costBudget?: number;
  private readonly permissionChecker?: PermissionChecker;

  /**
   * Voice config — shared by viewers (Lens, ChatThinkKit, CLI tail).
   * `appName` is the active actor in narration ("Chatbot called…").
   * `commentaryTemplates` drives Lens's third-person panel.
   * `thinkingTemplates` drives chat-bubble first-person status.
   * Defaults to bundled English; consumer overrides via builder.
   */
  readonly appName: string;
  readonly commentaryTemplates: Readonly<Record<string, string>>;
  readonly thinkingTemplates: Readonly<Record<string, string>>;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  /**
   * Reference to the most recent executor. Set on every `createExecutor()`
   * call (i.e., every `run()` and `resume()`); read by `getLastSnapshot()`
   * / `getLastNarrativeEntries()` so post-run UIs (Lens Trace tab,
   * ExplainableShell) can pull execution state without intercepting the
   * call. `undefined` until the first run.
   */
  private lastExecutor?: FlowChartExecutor;

  /**
   * Reference to the FlowChart compiled for the most recent run. Cached
   * here rather than recomputed via `buildChart()` so `getSpec()` returns
   * the SAME spec the executor traced — important when the spec is used
   * to reconcile `getLastSnapshot()` for ExplainableShell.
   */
  private lastFlowChart?: FlowChart;

  /**
   * Memory subsystems registered via `.memory()`. Each definition mounts
   * its `read` subflow before the InjectionEngine on every turn; per-id
   * scope keys (`memoryInjectionKey(id)`) keep multi-memory layering
   * collision-free.
   */
  private readonly memories: readonly MemoryDefinition[];

  /**
   * Optional terminal contract. Set via the builder's `.outputSchema()`.
   * When present, `agent.runTyped()` parses + validates the final
   * answer against this parser. `agent.run()` keeps returning the
   * raw string; consumers opt into typed mode explicitly.
   */
  private readonly outputSchemaParser?: OutputSchemaParser<unknown>;

  /**
   * Optional 3-tier degradation for output-schema validation
   * failures. Set via the builder's `.outputFallback({...})`. When
   * present, `parseOutput()` and `runTyped()` fall through:
   *   primary → fallback → canned (in order; canned guarantees no-throw).
   */
  private readonly outputFallbackCfg?: ResolvedOutputFallback<unknown>;

  /** Side-channel for `resumeOnError(...)` — when set, the seed
   *  function restores `scope.history` from this instead of starting
   *  fresh. Cleared on first read so subsequent runs start clean. */
  private pendingResumeHistory?: readonly LLMMessage[];

  /**
   * Optional `ToolProvider` set via the builder's `.toolProvider()`.
   * When present, the Tools slot subflow consults it per iteration
   * (Block A5 follow-up) — the provider's tools land alongside any
   * tools registered statically via `.tool()` / `.tools()`. The
   * tool-call dispatcher also consults it for per-iteration execute
   * lookup so dynamic chains (`gatedTools`, `skillScopedTools`)
   * dispatch correctly when their visible-set changes mid-turn.
   */
  private readonly externalToolProvider?: ToolProvider;

  constructor(
    opts: AgentOptions,
    systemPromptValue: string,
    registry: readonly ToolRegistryEntry[],
    voice: {
      readonly appName: string;
      readonly commentaryTemplates: Readonly<Record<string, string>>;
      readonly thinkingTemplates: Readonly<Record<string, string>>;
    },
    injections: readonly Injection[] = [],
    memories: readonly MemoryDefinition[] = [],
    outputSchemaParser?: OutputSchemaParser<unknown>,
    toolProvider?: ToolProvider,
    systemPromptCachePolicy: CachePolicy = 'always',
    cachingDisabled = false,
    cacheStrategy?: CacheStrategy,
    outputFallbackCfg?: ResolvedOutputFallback<unknown>,
  ) {
    super();
    this.provider = opts.provider;
    this.name = opts.name ?? 'Agent';
    this.id = opts.id ?? 'agent';
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.maxTokens = opts.maxTokens;
    this.maxIterations = clampIterations(opts.maxIterations ?? 10);
    this.systemPromptValue = systemPromptValue;
    this.systemPromptCachePolicy = systemPromptCachePolicy;
    this.cachingDisabledValue = cachingDisabled;
    // Auto-resolve strategy from provider.name unless caller overrides.
    // NoOp is the wildcard fallback so unknown providers stay safe.
    this.cacheStrategy = cacheStrategy ?? getDefaultCacheStrategy(opts.provider.name);
    this.registry = registry;
    this.injections = injections;
    this.memories = memories;
    this.outputSchemaParser = outputSchemaParser;
    this.outputFallbackCfg = outputFallbackCfg;
    this.externalToolProvider = toolProvider;
    // Eager validation: tool names must be unique across .tool() +
    // every Skill.inject.tools — the LLM dispatches by name. Runs in
    // constructor so `Agent.build()` throws immediately on collision,
    // not at first run().
    validateToolNameUniqueness(registry, injections);
    // Eager validation: memory ids must be unique so per-id scope keys
    // (`memoryInjection_${id}`) don't collide.
    validateMemoryIdUniqueness(memories);
    if (opts.pricingTable) this.pricingTable = opts.pricingTable;
    if (opts.costBudget !== undefined) this.costBudget = opts.costBudget;
    if (opts.permissionChecker) this.permissionChecker = opts.permissionChecker;
    this.appName = voice.appName;
    this.commentaryTemplates = voice.commentaryTemplates;
    this.thinkingTemplates = voice.thinkingTemplates;
  }

  static create(opts: AgentOptions): AgentBuilder {
    return new AgentBuilder(opts);
  }

  toFlowChart(): FlowChart {
    return this.buildChart();
  }

  /**
   * Cache policy for the base system prompt. Read by the CacheDecision
   * subflow (v2.6 Phase 4) to know how to treat the SystemPrompt slot's
   * cache markers. Exposed as a method (not direct field access) so
   * the Agent's encapsulation boundary stays clean.
   */
  getSystemPromptCachePolicy(): CachePolicy {
    return this.systemPromptCachePolicy;
  }

  /**
   * The footprintjs `RuntimeSnapshot` from the most recent `run()` /
   * `resume()`. Feeds Lens's Trace tab (ExplainableShell `runtimeSnapshot`
   * prop) so consumers can scrub the execution timeline post-run without
   * threading a recorder through the call site.
   *
   * Returns `undefined` before the first run completes. Returns the
   * snapshot of the most recent run on every call after — including
   * across multiple turns of the same Agent instance.
   */
  getLastSnapshot(): RuntimeSnapshot | undefined {
    return this.lastExecutor?.getSnapshot();
  }

  /**
   * Structured narrative entries from the most recent run. Pairs with
   * `getLastSnapshot()` for ExplainableShell's `narrativeEntries` prop.
   * Empty array (not `undefined`) when no run has completed — matches
   * the prop's expected shape so consumers can wire it directly without
   * a defensive guard.
   */
  getLastNarrativeEntries(): readonly CombinedNarrativeEntry[] {
    return this.lastExecutor?.getNarrativeEntries() ?? [];
  }

  /**
   * The FlowChart compiled for the most recent run (or a freshly-built
   * one if no run has happened yet). Feeds ExplainableShell's `spec`
   * prop. Returning the cached chart matters: the spec must match what
   * `getLastSnapshot()` traced, otherwise the Trace view's stage tree
   * desyncs from the snapshot's runtime tree.
   */
  getSpec(): FlowChart {
    return this.lastFlowChart ?? this.buildChart();
  }

  /**
   * Parse + validate a raw agent answer against the agent's
   * `outputSchema` parser. Throws `OutputSchemaError` on JSON parse
   * or schema validation failure (the rawOutput is preserved on the
   * error for triage). Throws a plain `Error` if the agent has no
   * outputSchema set.
   *
   * Use this when you need to keep `agent.run()` returning the raw
   * string for logging/observability and validate at a different
   * layer; otherwise prefer `agent.runTyped()`.
   */
  parseOutput<T = unknown>(raw: string): T {
    if (!this.outputSchemaParser) {
      throw new Error(
        `Agent.parseOutput: this agent has no outputSchema. Use ` +
          `Agent.create({...}).outputSchema(parser).build() to enable typed output.`,
      );
    }
    return applyOutputSchema(raw, this.outputSchemaParser as OutputSchemaParser<T>);
  }

  /**
   * Async sister of `parseOutput()`. When the agent is configured
   * with `.outputFallback({...})`, this is the version that engages
   * the 3-tier degradation chain on validation failure (the sync
   * `parseOutput` always throws on failure for back-compat).
   *
   * Without `outputFallback`, behaves identically to `parseOutput`
   * — returns sync-style on the happy path, throws OutputSchemaError
   * on validation failure.
   */
  async parseOutputAsync<T = unknown>(raw: string): Promise<T> {
    if (!this.outputSchemaParser) {
      throw new Error(
        `Agent.parseOutputAsync: this agent has no outputSchema. Use ` +
          `Agent.create({...}).outputSchema(parser).build() to enable typed output.`,
      );
    }
    const parser = this.outputSchemaParser as OutputSchemaParser<T>;
    try {
      return applyOutputSchema(raw, parser);
    } catch (err) {
      if (!this.outputFallbackCfg || !(err instanceof OutputSchemaError)) throw err;
      // Engage the 3-tier fallback. The dispatcher gives us the
      // typed-event entry; we synthesize a minimal event shape since
      // these events have no per-stage anchor.
      const emit = (eventType: string, payload: Record<string, unknown>): void => {
        try {
          this.dispatcher.dispatch({
            type: eventType,
            timestamp: Date.now(),
            payload,
          } as never);
        } catch {
          /* observability errors must not poison the fallback path */
        }
      };
      return applyOutputFallback(
        raw,
        parser,
        this.outputFallbackCfg as ResolvedOutputFallback<T>,
        emit,
        err,
      );
    }
  }

  /**
   * Run the agent and return the schema-validated typed output.
   * Convenience over `parseOutputAsync(await agent.run({...}))`.
   *
   * Throws `OutputSchemaError` on parse / validation failure UNLESS
   * `.outputFallback({...})` is configured, in which case the
   * 3-tier degradation chain (primary → fallback → canned) engages.
   *
   * Throws if the agent has no outputSchema set or if the run
   * pauses (use `run()` directly when pauses are expected).
   */
  async runTyped<T = unknown>(input: AgentInput, options?: RunOptions): Promise<T> {
    if (!this.outputSchemaParser) {
      throw new Error(
        `Agent.runTyped: this agent has no outputSchema. Use ` +
          `Agent.create({...}).outputSchema(parser).build() to enable typed output.`,
      );
    }
    const out = await this.run(input, options);
    if (typeof out !== 'string') {
      throw new Error(
        'Agent.runTyped: run paused — typed mode does not support pauses. ' +
          'Use agent.run() + agent.parseOutput(...) after resume.',
      );
    }
    return this.parseOutputAsync<T>(out);
  }

  async run(input: AgentInput, options?: RunOptions): Promise<AgentOutput | RunnerPauseOutcome> {
    // (helper used in the catch block below — module-private function
    // declared at file end via hoisting)
    const executor = this.createExecutor();

    // Auto-checkpoint at iteration boundaries — captures the latest
    // conversation history into a per-run tracker. On error, we
    // wrap the underlying error in `RunCheckpointError` carrying
    // this checkpoint so `agent.resumeOnError(checkpoint)` can
    // continue from the last good iteration.
    const tracker: RunCheckpointTracker = {
      runId: this.currentRunContext?.runId ?? 'unknown',
      originalInput: { message: input.message },
      history: [],
      lastCompletedIteration: 0,
    };
    const stopTracking = this.installCheckpointTracker(tracker);

    try {
      const result = await executor.run({
        input: {
          message: input.message,
          ...(input.identity !== undefined && { identity: input.identity }),
        },
        ...(options ?? {}),
      });
      return this.finalizeResult(executor, result);
    } catch (cause) {
      // Wrap recoverable errors with the last-known-good checkpoint.
      // Pause-signal exceptions are not recoverable in this sense
      // (they're intentional askHuman pauses) — let those propagate.
      if (cause instanceof Error && cause.name !== 'PauseSignal' && tracker.history.length > 0) {
        const checkpoint = buildCheckpoint(tracker, {
          iteration: tracker.inFlightIteration ?? tracker.lastCompletedIteration + 1,
          phase: classifyFailurePhase(cause),
        });
        throw new RunCheckpointError(cause, checkpoint);
      }
      throw cause;
    } finally {
      stopTracking();
    }
  }

  /**
   * Resume an agent run from a checkpoint produced by a prior
   * `RunCheckpointError`. Unlike `agent.resume()` (which takes a
   * `FlowchartCheckpoint` from an intentional pause), this takes
   * an `AgentRunCheckpoint` (conversation-history snapshot) and
   * replays the agent run with that history restored.
   *
   * The next iteration retries the call that originally failed —
   * with the latest provider state (circuit breaker may have
   * closed, vendor may have recovered, etc.).
   *
   * @example
   * ```ts
   * try {
   *   const result = await agent.run({ message: 'long task' });
   * } catch (err) {
   *   if (err instanceof RunCheckpointError) {
   *     await checkpointStore.put(sessionId, err.checkpoint);
   *     // hours / restart later:
   *     const checkpoint = await checkpointStore.get(sessionId);
   *     const result = await agent.resumeOnError(checkpoint);
   *   }
   * }
   * ```
   */
  async resumeOnError(
    checkpoint: AgentRunCheckpoint | unknown,
    options?: RunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    const cp = validateCheckpoint(checkpoint);
    // Stash the checkpointed history on the side channel; the seed
    // function reads + clears it before scope.history initializes.
    this.pendingResumeHistory = cp.history as readonly LLMMessage[];
    return this.run({ message: cp.originalInput.message }, options);
  }

  /**
   * Install a per-run checkpoint tracker. Listens for the agent's
   * own iteration_end events on `this.dispatcher` and snapshots the
   * conversation history into the tracker. Returns a stop function.
   *
   * @internal
   */
  private installCheckpointTracker(tracker: RunCheckpointTracker): () => void {
    const offIterStart = this.dispatcher.on(
      'agentfootprint.agent.iteration_start' as never,
      ((event: { payload?: { iterIndex?: number } }) => {
        const p = event.payload;
        if (typeof p?.iterIndex === 'number') tracker.inFlightIteration = p.iterIndex;
      }) as never,
    );
    const offIterEnd = this.dispatcher.on(
      'agentfootprint.agent.iteration_end' as never,
      ((event: { payload?: { iterIndex?: number; history?: ReadonlyArray<unknown> } }) => {
        const p = event.payload;
        if (typeof p?.iterIndex === 'number') tracker.lastCompletedIteration = p.iterIndex;
        if (Array.isArray(p?.history)) {
          tracker.history = p.history as readonly LLMMessage[];
        }
        tracker.inFlightIteration = undefined;
      }) as never,
    );
    return () => {
      offIterStart();
      offIterEnd();
    };
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    // Fresh executor — footprintjs 4.17.0+ seeds the runtime from
    // `checkpoint.sharedState` (and nested subflow states) automatically
    // on a fresh executor's `resume()`. No need to retain a paused
    // executor between run/resume.
    const executor = this.createExecutor();
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Agent:${this.id}`],
    };

    const chart = this.buildChart();
    const executor = new FlowChartExecutor(chart);
    // Enable structured narrative so `getLastNarrativeEntries()` can
    // hand a populated array to consumer Trace views (ExplainableShell).
    // Cheap when no consumer reads it; the recorder accumulates only.
    executor.enableNarrative();
    this.lastExecutor = executor;
    this.lastFlowChart = chart;

    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    executor.attachCombinedRecorder(new ContextRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(streamRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(agentRecorder({ dispatcher, getRunContext: getRunCtx }));
    if (this.pricingTable) {
      executor.attachCombinedRecorder(costRecorder({ dispatcher, getRunContext: getRunCtx }));
    }
    if (this.permissionChecker) {
      executor.attachCombinedRecorder(permissionRecorder({ dispatcher, getRunContext: getRunCtx }));
    }
    // Always-on bridges for consumer-emitted domain events.
    executor.attachCombinedRecorder(evalRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(memoryRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(skillRecorder({ dispatcher, getRunContext: getRunCtx }));
    for (const r of this.attachedRecorders) executor.attachCombinedRecorder(r);
    return executor;
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): AgentOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('Agent: unexpected result shape — expected final-answer string');
  }

  // ─── Chart assembly ────────────────────────────────────────────

  private buildChart(): FlowChart {
    const provider = this.provider;
    const model = this.model;
    const temperature = this.temperature;
    const maxTokens = this.maxTokens;
    const systemPromptValue = this.systemPromptValue;
    const registry = this.registry;
    // (registryByName + toolSchemas redefined below using
    // `augmentedRegistry` which adds the auto-attached `read_skill`
    // tool when Skills are registered.)
    const _legacyRegistry = registry;
    void _legacyRegistry;
    const maxIterations = this.maxIterations;
    const pricingTable = this.pricingTable;
    const costBudget = this.costBudget;
    const permissionChecker = this.permissionChecker;
    // Cache layer (v2.6) — capture for the seed + chart-build closures.
    // `systemPromptCachePolicy` is fed into the CacheDecision subflow's
    // inputMapper. `cacheStrategy` is consulted by BuildLLMRequest at
    // run-time (Phase 7+ for the actual prepareRequest call). For
    // Phase 6b the chart mounts the stages but BuildLLMRequest is a
    // pass-through; Phase 7 lights up the strategy call.
    const systemPromptCachePolicy = this.systemPromptCachePolicy;
    const cachingDisabled = this.cachingDisabledValue;
    const cacheStrategy = this.cacheStrategy;

    // seed extracted to ./agent/stages/seed.ts (v2.11.2). Factory takes
    // chart-build-time constants + per-run mutable accessors so the
    // resume side-channel and current run id remain dynamic.
    // toolSchemas is finalized further down; pass a getter that reads
    // the eventual const at stage-execution time.
    let toolSchemasResolved: readonly LLMToolSchema[] = [];
    const seed = buildSeedStage({
      maxIterations,
      cachingDisabled,
      get toolSchemas() {
        return toolSchemasResolved;
      },
      consumePendingResumeHistory: () => {
        const h = this.pendingResumeHistory;
        this.pendingResumeHistory = undefined;
        return h;
      },
      getCurrentRunId: () => this.currentRunContext?.runId,
    });

    // Tool registry composition — three sources:
    //
    //   1. Static registry: tools registered via `.tool()`. Always
    //      visible to the LLM; always executable.
    //   2. `read_skill` (auto-attached when ≥1 Skill is registered):
    //      activation tool for LLM-guided Skills.
    //   3. Skill-supplied tools (`Skill.inject.tools[]`): visible only
    //      when the Skill is active (filtered by tools slot subflow);
    //      MUST always be in the executor registry so when the LLM
    //      calls one, the tool-calls handler can dispatch.
    //
    // Tool-name uniqueness is enforced across all three sources at
    // build time. The LLM only sees `tool.schema.name` (no ids), so
    // names ARE the runtime dispatch key — collisions break the LLM's
    // ability to call the right tool. Throw early instead of subtly
    // shadowing.
    const skills = this.injections.filter((i) => i.flavor === 'skill');
    // Collect skill tools, deduping by name when the SAME Tool reference
    // is shared across skills. Different Tool implementations under the
    // same name throws (already validated upstream by
    // validateToolNameUniqueness) — we keep the runtime check as
    // belt-and-suspenders.
    //
    // Block C runtime — `autoActivate: 'currentSkill'` semantics:
    //   When a skill's `defineSkill({ autoActivate: 'currentSkill' })`
    //   is set, its tools are EXCLUDED from the static registry. They
    //   flow into the LLM's tool list ONLY through `dynamicSchemas`
    //   (the buildToolsSlot path that reads activeInjections), which
    //   means they're visible ONLY on iterations after the skill is
    //   activated by `read_skill('id')`. Without this, the LLM sees
    //   every skill's tools on every iteration and the
    //   per-skill-narrowing autoActivate promised in `defineSkill`
    //   doesn't actually narrow anything. Skills WITHOUT autoActivate
    //   keep the v2.4 behavior (tools always visible) for back-compat.
    const skillToolEntries: ToolRegistryEntry[] = [];
    const sharedSkillTools = new Map<string, Tool>();
    for (const skill of skills) {
      const meta = skill.metadata as { autoActivate?: string } | undefined;
      const isAutoActivate = meta?.autoActivate === 'currentSkill';
      const toolsFromSkill = skill.inject.tools ?? [];
      for (const tool of toolsFromSkill) {
        const name = tool.schema.name;
        const existing = sharedSkillTools.get(name);
        if (existing) {
          if (existing !== (tool as unknown as Tool)) {
            throw new Error(
              `Agent: tool name '${name}' is declared by multiple skills with different ` +
                `Tool implementations. Skills MAY share the SAME Tool reference; they may ` +
                `NOT register different functions under the same name.`,
            );
          }
          continue; // dedupe — same reference already added
        }
        sharedSkillTools.set(name, tool as unknown as Tool);
        // autoActivate skills: their tools come ONLY through
        // dynamicSchemas (buildToolsSlot.ts pulls them from
        // activeInjections.inject.tools when the skill is active).
        // Don't pre-load them in the static registry.
        if (isAutoActivate) continue;
        skillToolEntries.push({ name, tool });
      }
    }
    // buildReadSkillTool returns undefined when skills is empty; the
    // length check below short-circuits so the non-null assertion is safe.
    const readSkillEntries: readonly ToolRegistryEntry[] =
      skills.length > 0 ? [{ name: 'read_skill', tool: buildReadSkillTool(skills)! }] : [];
    const augmentedRegistry: readonly ToolRegistryEntry[] = [
      ...registry,
      ...readSkillEntries,
      ...skillToolEntries,
    ];

    // Final cross-source name-uniqueness check: static .tool() vs
    // read_skill vs (deduped) skill tools. After the dedupe above this
    // catches collisions BETWEEN sources (e.g., a static .tool('foo')
    // colliding with a Skill's foo) which are real bugs.
    const seenNames = new Set<string>();
    for (const entry of augmentedRegistry) {
      if (seenNames.has(entry.name)) {
        throw new Error(
          `Agent: duplicate tool name '${entry.name}'. Tool names must be unique ` +
            `across .tool() registrations and Skills' inject.tools (after deduping ` +
            `same-reference shares across skills). The LLM dispatches by name; ` +
            `collisions break tool routing.`,
        );
      }
      seenNames.add(entry.name);
    }

    const registryByName = new Map(augmentedRegistry.map((e) => [e.name, e.tool] as const));
    // Block C runtime — autoActivate skill tools live OUTSIDE the LLM-
    // visible registry (so they don't pollute the per-iteration tool
    // list before the skill activates), but they MUST still be findable
    // by the dispatch handler — the LLM calls them by name once the
    // skill is active, and dispatch looks up by name. Add them to the
    // dispatch map so `lookupTool` resolves correctly. Using the Map
    // backing the static registryByName means autoActivate tools share
    // the same `.execute` wiring as normal tools — no special path.
    for (const [name, tool] of sharedSkillTools.entries()) {
      if (!registryByName.has(name)) {
        registryByName.set(name, tool);
      }
    }
    const toolSchemas = augmentedRegistry.map((e) => e.tool.schema);
    // Late-bind toolSchemas into the seed stage's deps (the factory was
    // built earlier with a getter; this resolves the actual value).
    toolSchemasResolved = toolSchemas;

    const injectionEngineSubflow = buildInjectionEngineSubflow({
      injections: this.injections,
    });
    const systemPromptSubflow = buildSystemPromptSlot({
      prompt: systemPromptValue,
      reason: 'Agent.system()',
    });
    const messagesSubflow = buildMessagesSlot();
    const toolsSubflow = buildToolsSlot({
      tools: toolSchemas,
      ...(this.externalToolProvider && { toolProvider: this.externalToolProvider }),
    });

    // iterationStart extracted to ./agent/stages/iterationStart.ts (v2.11.2).
    const iterationStart = iterationStartStage;

    // callLLM extracted to ./agent/stages/callLLM.ts (v2.11.2). Same
    // late-binding pattern as seed for toolSchemas (computed below).
    const callLLM = buildCallLLMStage({
      provider,
      model,
      ...(temperature !== undefined && { temperature }),
      ...(maxTokens !== undefined && { maxTokens }),
      ...(pricingTable !== undefined && { pricingTable }),
      ...(costBudget !== undefined && { costBudget }),
      maxIterations,
      cacheStrategy,
      get toolSchemas() {
        return toolSchemasResolved;
      },
    });

    // routeDecider extracted to ./agent/stages/route.ts (v2.11.2).
    const routeDecider = routeDeciderStage;

    // toolCallsHandler extracted to ./agent/stages/toolCalls.ts (v2.11.2).
    const toolCallsHandler = buildToolCallsHandler({
      registryByName,
      ...(this.externalToolProvider && { externalToolProvider: this.externalToolProvider }),
      ...(permissionChecker && { permissionChecker }),
    });

    // Final branch is split so memory-write subflows can mount BETWEEN
    // setting `finalContent` and breaking the ReAct loop. PrepareFinal
    // captures the turn payload; BreakFinal terminates the loop.
    const prepareFinalStage = (scope: TypedScope<AgentState>) => {
      const iteration = scope.iteration as number;
      scope.finalContent = scope.llmLatestContent as string;
      // The turn payload memory writes persist: the user's message
      // paired with the agent's final answer.
      scope.newMessages = [
        { role: 'user', content: scope.userMessage as string },
        { role: 'assistant', content: scope.finalContent as string },
      ];

      typedEmit(scope, 'agentfootprint.agent.iteration_end', {
        turnIndex: 0,
        iterIndex: iteration,
        toolCallCount: 0,
      });
      typedEmit(scope, 'agentfootprint.agent.turn_end', {
        turnIndex: 0,
        finalContent: scope.finalContent,
        totalInputTokens: scope.totalInputTokens as number,
        totalOutputTokens: scope.totalOutputTokens as number,
        iterationCount: iteration,
        durationMs: Date.now() - (scope.turnStartMs as number),
      });
    };

    // breakFinalStage extracted to ./agent/stages/breakFinal.ts (v2.11.2).

    // Compose the final branch as its own subflow so memory write
    // subflows mount as visible siblings in narrative + Lens.
    let finalBranchBuilder = flowChart<AgentState>(
      'PrepareFinal',
      prepareFinalStage,
      'prepare-final',
      undefined,
      'Capture turn payload (finalContent + newMessages)',
    );
    for (const m of this.memories) {
      if (m.write) {
        finalBranchBuilder = mountMemoryWrite(finalBranchBuilder, {
          pipeline: {
            read: unwrapMemoryFlowChart(m.read) as never,
            write: unwrapMemoryFlowChart(m.write) as never,
          },
          identityKey: 'runIdentity',
          turnNumberKey: 'turnNumber',
          contextTokensKey: 'contextTokensRemaining',
          newMessagesKey: 'newMessages',
          writeSubflowId: `sf-memory-write-${m.id}`,
        });
      }
    }
    const finalBranchChart = finalBranchBuilder
      .addFunction('BreakFinal', breakFinalStage, 'break-final', 'Terminate the ReAct loop')
      .build();

    // Description prefix `Agent:` is a taxonomy marker — consumers
    // (Lens + FlowchartRecorder) detect Agent-primitive subflows via
    // this prefix and flag them as true agent boundaries (separate
    // from LLMCall subflows which use `LLMCall:` prefix).
    let builder = flowChart<AgentState>(
      'Seed',
      seed,
      STAGE_IDS.SEED,
      undefined,
      'Agent: ReAct loop',
    );

    // Memory READ subflows — mounted between Seed and InjectionEngine
    // for TURN_START timing (default). Each memory writes to its own
    // scope key (`memoryInjection_${id}`) so multiple `.memory()`
    // registrations layer without colliding.
    for (const m of this.memories) {
      builder = mountMemoryRead(builder, {
        pipeline: {
          read: unwrapMemoryFlowChart(m.read) as never,
          ...(m.write !== undefined && { write: unwrapMemoryFlowChart(m.write) as never }),
        },
        identityKey: 'runIdentity',
        turnNumberKey: 'turnNumber',
        contextTokensKey: 'contextTokensRemaining',
        injectionKey: memoryInjectionKey(m.id),
        readSubflowId: `sf-memory-read-${m.id}`,
      });
    }

    builder = builder
      // Injection Engine — evaluates every Injection's trigger once
      // per iteration; writes activeInjections[] to parent scope for
      // the slot subflows to consume. Skipped if no injections were
      // registered (no observable difference, just one more no-op
      // subflow boundary).
      .addSubFlowChartNext(
        SUBFLOW_IDS.INJECTION_ENGINE,
        injectionEngineSubflow,
        'Injection Engine',
        {
          inputMapper: (parent) => ({
            iteration: parent.iteration as number | undefined,
            userMessage: parent.userMessage as string | undefined,
            history: parent.history as readonly LLMMessage[] | undefined,
            lastToolResult: parent.lastToolResult as
              | { toolName: string; result: string }
              | undefined,
            activatedInjectionIds:
              (parent.activatedInjectionIds as readonly string[] | undefined) ?? [],
          }),
          outputMapper: (sf) => ({ activeInjections: sf.activeInjections }),
          // CRITICAL: footprintjs's default `applyOutputMapping`
          // CONCATENATES arrays from subflow output with the parent's
          // existing array values. Without `Replace`, the parent's
          // `activeInjections` from iter N gets CONCATENATED with the
          // subflow's iter N+1 fresh evaluation — producing
          // 8 → 16 → 24 → 32 cumulative injections per turn instead of
          // the intended ~8-per-iter.
          //
          // The slot subflows below (SystemPrompt, Messages, Tools) all
          // read `activeInjections` and render every entry, so without
          // Replace the system prompt grows linearly with iteration
          // count. This was the root-cause of Dynamic-mode costing
          // ~2x more input tokens than Classic in the v2.5.0 Neo
          // benchmarks — the InjectionEngine's intended per-iter
          // recomposition wasn't happening; it was per-iter ACCUMULATION.
          arrayMerge: ArrayMergeMode.Replace,
        },
      )
      .addSubFlowChartNext(SUBFLOW_IDS.SYSTEM_PROMPT, systemPromptSubflow, 'System Prompt', {
        inputMapper: (parent) => ({
          userMessage: parent.userMessage as string | undefined,
          iteration: parent.iteration as number | undefined,
          activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
        }),
        outputMapper: (sf) => ({ systemPromptInjections: sf.systemPromptInjections }),
        // See Tools-subflow comment below — same array-concat hazard.
        // Without Replace, iter N+1's systemPromptInjections gets
        // CONCATENATED with iter N's, multiplying the system prompt
        // each iteration.
        arrayMerge: ArrayMergeMode.Replace,
      })
      .addSubFlowChartNext(SUBFLOW_IDS.MESSAGES, messagesSubflow, 'Messages', {
        inputMapper: (parent) => ({
          messages: parent.history as readonly LLMMessage[] | undefined,
          iteration: parent.iteration as number | undefined,
          activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
        }),
        outputMapper: (sf) => ({ messagesInjections: sf.messagesInjections }),
        // Same array-concat hazard. messagesInjections is consumer-
        // facing observability metadata (ContextRecorder, Lens) — must
        // reflect THIS iteration's history, not be appended to last
        // iteration's. CallLLM no longer reads this for the wire
        // request (uses scope.history directly), so the LLM-protocol
        // bug is fixed independently — but consumers of the
        // messagesInjections stream still expect the per-iteration
        // semantics.
        arrayMerge: ArrayMergeMode.Replace,
      })
      .addSubFlowChartNext(SUBFLOW_IDS.TOOLS, toolsSubflow, 'Tools', {
        inputMapper: (parent) => ({
          iteration: parent.iteration as number | undefined,
          activeInjections: parent.activeInjections as readonly ActiveInjection[] | undefined,
          // The slot subflow reads these to build the per-iteration
          // ToolDispatchContext when an external `.toolProvider()` is
          // configured. Without them the provider sees activeSkillId
          // = undefined every iteration, breaking skillScopedTools etc.
          activatedInjectionIds: parent.activatedInjectionIds as readonly string[] | undefined,
          runIdentity: parent.runIdentity as
            | { tenant?: string; principal?: string; conversationId: string }
            | undefined,
        }),
        outputMapper: (sf) => ({
          toolsInjections: sf.toolsInjections,
          // Pass merged tool schemas (registry + injection-supplied)
          // back up so callLLM uses the right list for THIS iteration.
          dynamicToolSchemas: sf.toolSchemas,
        }),
        // CRITICAL: footprintjs's default `applyOutputMapping`
        // CONCATENATES arrays from subflow output with the parent's
        // existing array values. Without `Replace`, the parent's
        // `dynamicToolSchemas` (carrying the iter N value) gets
        // concatenated with the slot's iter N+1 deduped list,
        // re-introducing duplicate tool names that Anthropic's API
        // rejects with "tools: Tool names must be unique." The slot's
        // toolSchemas IS the authoritative list — replace, don't
        // concatenate.
        arrayMerge: ArrayMergeMode.Replace,
      })
      // ── Cache layer (v2.6) ─────────────────────────────────────
      // CacheDecision subflow walks `activeInjections` + evaluates
      // each `cache:` directive, emits provider-agnostic
      // `CacheMarker[]` to scope. Pure transform; no IO.
      //
      // CRITICAL: arrayMerge: ArrayMergeMode.Replace — same lesson
      // as the v2.5.1 InjectionEngine fix. The default footprintjs
      // behavior CONCATENATES arrays from child to parent;
      // `cacheMarkers` MUST replace each iteration, not accumulate.
      .addSubFlowChartNext(SUBFLOW_IDS.CACHE_DECISION, cacheDecisionSubflow, 'CacheDecision', {
        inputMapper: (parent) => ({
          activeInjections: (parent.activeInjections as readonly Injection[] | undefined) ?? [],
          iteration: (parent.iteration as number | undefined) ?? 1,
          maxIterations: (parent.maxIterations as number | undefined) ?? maxIterations,
          userMessage: (parent.userMessage as string | undefined) ?? '',
          ...(parent.lastToolResult !== undefined && {
            lastToolName: (parent.lastToolResult as { toolName: string } | undefined)?.toolName,
          }),
          cumulativeInputTokens: (parent.totalInputTokens as number | undefined) ?? 0,
          systemPromptCachePolicy,
          cachingDisabled: (parent.cachingDisabled as boolean | undefined) ?? false,
        }),
        outputMapper: (sf) => ({ cacheMarkers: sf.cacheMarkers }),
        arrayMerge: ArrayMergeMode.Replace,
      })
      .addFunction(
        'UpdateSkillHistory',
        updateSkillHistoryStage as never,
        STAGE_IDS.UPDATE_SKILL_HISTORY,
        'Update skill-history rolling window for CacheGate churn detection',
      )
      .addDeciderFunction(
        'CacheGate',
        cacheGateDecide as never,
        STAGE_IDS.CACHE_GATE,
        'Gate cache-marker application: kill switch / hit-rate / skill-churn',
      )
      .addFunctionBranch(
        STAGE_IDS.APPLY_MARKERS,
        'ApplyMarkers',
        // Pass-through stage — markers stay in scope as-is.
        // BuildLLMRequest (Phase 7+) reads them on the next stage.
        () => undefined,
        'Proceed with cache markers from CacheDecision',
      )
      .addFunctionBranch(
        STAGE_IDS.SKIP_CACHING,
        'SkipCaching',
        // Clear markers so BuildLLMRequest sees an empty list and
        // makes the request unmodified.
        (scope: TypedScope<AgentState>) => {
          scope.cacheMarkers = [];
        },
        'Skip caching this iteration',
      )
      .end()
      .addFunction('IterationStart', iterationStart, 'iteration-start', 'Iteration begin marker')
      .addFunction('CallLLM', callLLM, STAGE_IDS.CALL_LLM, 'LLM invocation')
      .addDeciderFunction('Route', routeDecider, SUBFLOW_IDS.ROUTE, 'ReAct routing')
      .addPausableFunctionBranch(
        'tool-calls',
        'ToolCalls',
        toolCallsHandler,
        'Tool execution (pausable via pauseHere)',
      )
      .addSubFlowChartBranch('final', finalBranchChart, 'Final', {
        // Pass through the read-only state the sub-chart needs;
        // OMIT keys the sub-chart writes (finalContent, newMessages)
        // — passing those via inputMapper would freeze them as args.
        inputMapper: (parent) => {
          const { finalContent: _f, newMessages: _nm, ...rest } = parent;
          void _f;
          void _nm;
          return rest;
        },
        outputMapper: (sf) => ({
          finalContent: sf.finalContent as string,
        }),
        // BreakFinal's $break() must reach the outer loopTo so the
        // ReAct iteration terminates; without this the inner break
        // only exits the sub-chart and the outer loop continues.
        propagateBreak: true,
      })
      .setDefault('final')
      .end()
      // Dynamic ReAct: loop back to the InjectionEngine so EVERY iteration
      // re-evaluates triggers (rule predicates, on-tool-return, llm-activated)
      // against the freshest context (the just-appended tool result).
      // Without this, the InjectionEngine runs ONCE per turn and:
      //   - on-tool-return predicates never fire on iter 2+
      //   - read_skill('X') activations are never picked up next iteration
      //   - autoActivate per-skill tool gating is structurally impossible
      //   - tools / system-prompt slots stay frozen at iter 1 content
      // The v2.4 default of loopTo(MESSAGES) bypassed all four — quietly
      // breaking the framework's "Dynamic ReAct" claim. v2.5 restores the
      // v1 behavior that documents promise.
      .loopTo(SUBFLOW_IDS.INJECTION_ENGINE);

    return builder.build();
  }
}

/**
 * Fluent builder. `tool()` accepts any Tool<TArgs, TResult> and registers
 * it by its schema.name. Duplicate names throw at build time.
 */
export class AgentBuilder {
  private readonly opts: AgentOptions;
  private systemPromptValue = '';
  /**
   * Cache policy for the base system prompt. Set via the optional
   * 2nd argument to `.system(text, { cache })`. Default `'always'` —
   * the base prompt is stable per-turn and an ideal cache anchor.
   */
  private systemPromptCachePolicy: CachePolicy = 'always';
  /**
   * Global cache kill switch. Set via `Agent.create({ caching: 'off' })`
   * (handled in `AgentOptions` propagation). Defaults to `false`
   * (caching enabled). When `true`, the CacheGate decider routes to
   * `'no-markers'` every iteration regardless of other rules.
   */
  private cachingDisabledValue = false;
  /**
   * Optional explicit CacheStrategy override. Default: undefined,
   * which means the agent auto-resolves from
   * `getDefaultCacheStrategy(provider.name)` at construction. Power
   * users override here for custom backends or test mocks.
   */
  private cacheStrategyOverride?: CacheStrategy;
  private readonly registry: ToolRegistryEntry[] = [];
  private readonly injectionList: Injection[] = [];
  private readonly memoryList: MemoryDefinition[] = [];
  /**
   * Optional terminal contract — see `outputSchema()`. Stored on the
   * builder, propagated to the Agent at `.build()` time.
   */
  private outputSchemaParser?: OutputSchemaParser<unknown>;

  /** 3-tier output fallback chain — set via `.outputFallback({...})`.
   *  Optional; absent = current throw-on-validation-failure behavior. */
  private outputFallbackCfg?: ResolvedOutputFallback<unknown>;
  /**
   * Optional `ToolProvider` set via `.toolProvider()`. Propagated to
   * the Agent's Tools slot subflow + tool-call dispatcher; consulted
   * per iteration so dynamic chains (`gatedTools`, `skillScopedTools`)
   * react to current activation state.
   */
  private toolProviderRef?: ToolProvider;
  /**
   * Optional override for `AgentOptions.maxIterations`. When set via
   * the `.maxIterations()` builder method, takes precedence over the
   * value passed to `Agent.create({ maxIterations })`.
   */
  private maxIterationsOverride?: number;
  /**
   * Recorders collected via `.recorder()`. Attached to the built Agent
   * before `build()` returns (each via `agent.attach(rec)`).
   */
  private readonly recorderList: import('footprintjs').CombinedRecorder[] = [];
  // Voice config — defaults until the consumer calls .appName() /
  // .commentaryTemplates() / .thinkingTemplates(). Stored as plain
  // dicts (Record<string, string>) so the builder doesn't depend on
  // the template-engine modules at compile time; the runtime types
  // come from the agentfootprint barrel exports.
  private appNameValue = 'Chatbot';
  private commentaryOverrides: Readonly<Record<string, string>> = {};
  private thinkingOverrides: Readonly<Record<string, string>> = {};

  constructor(opts: AgentOptions) {
    this.opts = opts;
    // Cache layer: opts.caching === 'off' propagates to scope's
    // `cachingDisabled` kill switch read by CacheGate. opts.cacheStrategy
    // overrides the registry-resolved default.
    if (opts.caching === 'off') this.cachingDisabledValue = true;
    if (opts.cacheStrategy !== undefined) this.cacheStrategyOverride = opts.cacheStrategy;
  }

  /**
   * Set the base system prompt.
   *
   * @param prompt - The system prompt text. Stable per-turn.
   * @param options - Optional config. `cache` controls how the
   *   CacheDecision subflow treats this prompt block:
   *   - `'always'` (default) — cache the base prompt as a stable
   *     prefix anchor. Highest cache-hit rate; recommended for
   *     production agents whose system prompt rarely changes.
   *   - `'never'` — skip caching. Use if the prompt contains volatile
   *     content (timestamps, per-request user IDs).
   *   - `'while-active'` — semantically equivalent to `'always'` for
   *     the base prompt (it's always active by definition).
   *   - `{ until }` — conditional invalidation (e.g., flush after iter 5).
   */
  system(prompt: string, options?: { readonly cache?: CachePolicy }): this {
    this.systemPromptValue = prompt;
    if (options?.cache !== undefined) {
      this.systemPromptCachePolicy = options.cache;
    }
    return this;
  }

  tool<TArgs, TResult>(tool: Tool<TArgs, TResult>): this {
    const name = tool.schema.name;
    if (this.registry.some((e) => e.name === name)) {
      throw new Error(`Agent.tool(): duplicate tool name '${name}'`);
    }
    this.registry.push({ name, tool: tool as unknown as Tool });
    return this;
  }

  /**
   * Register many tools at once. Convenience for tool sources that
   * return a list (e.g., `await mcpClient(...).tools()`). Each tool
   * is registered via `.tool()` so duplicate-name validation still
   * fires per-entry.
   */
  tools(tools: ReadonlyArray<Tool>): this {
    for (const t of tools) this.tool(t);
    return this;
  }

  /**
   * Wire a chainable `ToolProvider` (from `agentfootprint/tool-providers`)
   * as the agent's per-iteration tool source.
   *
   * The provider is consulted EVERY iteration via `provider.list(ctx)`
   * with `ctx = { iteration, activeSkillId, identity }`. Tools the
   * provider emits flow into the Tools slot alongside any static
   * tools registered via `.tool()` / `.tools()`. The tool-call
   * dispatcher also consults the provider so dynamic chains
   * (`gatedTools`, `skillScopedTools`) dispatch correctly when their
   * visible-set changes mid-turn.
   *
   * Throws if called more than once on the same builder (avoids
   * silent override surprises).
   *
   * @example  Permission-gated baseline
   *   import { gatedTools, staticTools } from 'agentfootprint/tool-providers';
   *   import { PermissionPolicy } from 'agentfootprint/security';
   *
   *   const policy = PermissionPolicy.fromRoles({
   *     readonly: ['lookup', 'list_skills', 'read_skill'],
   *     admin:    ['lookup', 'list_skills', 'read_skill', 'delete'],
   *   }, 'readonly');
   *
   *   const provider = gatedTools(
   *     staticTools(allTools),
   *     (toolName) => policy.isAllowed(toolName),
   *   );
   *
   *   const agent = Agent.create({ provider: llm, model })
   *     .system('You answer.')
   *     .toolProvider(provider)
   *     .build();
   */
  toolProvider(provider: ToolProvider): this {
    if (this.toolProviderRef) {
      throw new Error(
        'AgentBuilder.toolProvider: already set. Each agent has at most one external ToolProvider.',
      );
    }
    this.toolProviderRef = provider;
    return this;
  }

  /**
   * Override the ReAct iteration cap set via `Agent.create({
   * maxIterations })`. Convenience for builder-style code that prefers
   * fluent setters over constructor opts. Last call wins.
   *
   * Throws if `n` is not a positive integer or exceeds the hard cap
   * (`clampIterations`'s upper bound).
   */
  maxIterations(n: number): this {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`AgentBuilder.maxIterations: expected a positive integer, got ${n}.`);
    }
    this.maxIterationsOverride = n;
    return this;
  }

  /**
   * Attach a footprintjs `CombinedRecorder` to the built Agent. Wired
   * via `agent.attach(rec)` immediately after construction, so the
   * recorder sees every event from the very first run.
   *
   * Equivalent to calling `agent.attach(rec)` post-build; the builder
   * method is a convenience for codebases that prefer fully-fluent
   * agent assembly. Multiple recorders are supported (each gets its
   * own `attach()` call).
   */
  recorder(rec: import('footprintjs').CombinedRecorder): this {
    this.recorderList.push(rec);
    return this;
  }

  /**
   * Set the agent's display name — substituted as `{{appName}}` in
   * commentary + thinking templates. Same place to brand a tenant
   * ("Acme Bot"), distinguish multi-agent roles ("Triage" vs
   * "Reviewer"), or localize ("Asistente"). Default: `'Chatbot'`.
   */
  appName(name: string): this {
    this.appNameValue = name;
    return this;
  }

  /**
   * Override agentfootprint's bundled commentary templates. Spread on
   * top of `defaultCommentaryTemplates`; missing keys fall back. Same
   * `Record<string, string>` shape with `{{vars}}` substitution as
   * the bundled defaults — see `defaultCommentaryTemplates` for the
   * full key list.
   *
   * Use cases: i18n (`'agent.turn_start': 'El usuario...'`), brand
   * voice ("You: {{userPrompt}}"), per-tenant customization.
   */
  commentaryTemplates(templates: Readonly<Record<string, string>>): this {
    this.commentaryOverrides = { ...this.commentaryOverrides, ...templates };
    return this;
  }

  /**
   * Override agentfootprint's bundled thinking templates. Same
   * contract shape as commentary; different vocabulary — first-person
   * status the chat bubble shows mid-call. Per-tool overrides go via
   * `tool.<toolName>` keys (e.g., `'tool.weather': 'Looking up the
   * weather…'`). See `defaultThinkingTemplates` for the full key list.
   */
  thinkingTemplates(templates: Readonly<Record<string, string>>): this {
    this.thinkingOverrides = { ...this.thinkingOverrides, ...templates };
    return this;
  }

  // ─── Injection sugar — context engineering surface ───────────
  //
  // ALL of these push into the same `injectionList`. The Injection
  // primitive is identical across flavors; the methods are just
  // narrative-friendly aliases. Duplicate ids throw at build time.

  /**
   * Register any `Injection`. Use this for power-user / custom flavors;
   * for built-in flavors use the typed sugar (`.skill`, `.steering`,
   * `.instruction`, `.fact`).
   */
  injection(injection: Injection): this {
    if (this.injectionList.some((i) => i.id === injection.id)) {
      throw new Error(`Agent.injection(): duplicate id '${injection.id}'`);
    }
    this.injectionList.push(injection);
    return this;
  }

  /**
   * Register a Skill — LLM-activated, system-prompt + tools.
   * Auto-attaches the `read_skill` activation tool to the agent.
   * Skill stays active for the rest of the turn once activated.
   */
  skill(injection: Injection): this {
    return this.injection(injection);
  }

  /**
   * Bulk-register every Skill in a `SkillRegistry`. Use for shared
   * skill catalogs across multiple Agents — register skills once on
   * the registry; attach the same registry to every consumer Agent.
   *
   * @example
   *   const registry = new SkillRegistry();
   *   registry.register(billingSkill).register(refundSkill);
   *   const supportAgent = Agent.create({ provider }).skills(registry).build();
   *   const escalationAgent = Agent.create({ provider }).skills(registry).build();
   */
  skills(registry: { list(): readonly Injection[] }): this {
    for (const skill of registry.list()) this.injection(skill);
    return this;
  }

  /**
   * Register a Steering doc — always-on system-prompt rule.
   * Use for invariant guidance: output format, persona, safety policies.
   */
  steering(injection: Injection): this {
    return this.injection(injection);
  }

  /**
   * Register an Instruction — rule-based system-prompt guidance.
   * Predicate runs each iteration. Use for context-dependent rules
   * including the "Dynamic ReAct" `on-tool-return` pattern.
   */
  instruction(injection: Injection): this {
    return this.injection(injection);
  }

  /**
   * Bulk-register many instructions at once. Convenience for consumer
   * code that organizes its instruction set in a flat array (`const
   * instructions = [outputFormat, dataRouting, ...]`). Each element
   * is registered via `.instruction()` so duplicate-id checks still
   * fire per-entry.
   */
  instructions(injections: ReadonlyArray<Injection>): this {
    for (const i of injections) this.instruction(i);
    return this;
  }

  /**
   * Register a Fact — developer-supplied data the LLM should see.
   * User profile, env info, computed summary, current time, …
   * Distinct from Skills (LLM-activated guidance) and Steering
   * (always-on rules) in INTENT — the engine treats them all alike.
   */
  fact(injection: Injection): this {
    return this.injection(injection);
  }

  /**
   * Register a Memory subsystem — load/persist conversation context,
   * facts, narrative beats, or causal snapshots across runs.
   *
   * The `MemoryDefinition` is produced by `defineMemory({ type, strategy,
   * store })`. Multiple memories layer cleanly via per-id scope keys
   * (`memoryInjection_${id}`):
   *
   * ```ts
   * Agent.create({ provider })
   *   .memory(defineMemory({ id: 'short', type: MEMORY_TYPES.EPISODIC,
   *                          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
   *                          store }))
   *   .memory(defineMemory({ id: 'facts', type: MEMORY_TYPES.SEMANTIC,
   *                          strategy: { kind: MEMORY_STRATEGIES.EXTRACT,
   *                                      extractor: 'pattern' }, store }))
   *   .build();
   * ```
   *
   * The READ subflow runs at the configured `timing` (default
   * `MEMORY_TIMING.TURN_START`) and writes its formatted output to the
   * `memoryInjection_${id}` scope key for the slot subflows to consume.
   */
  memory(definition: MemoryDefinition): this {
    if (this.memoryList.some((m) => m.id === definition.id)) {
      throw new Error(
        `Agent.memory(): duplicate id '${definition.id}' — each memory needs a unique id ` +
          'to keep its scope key (`memoryInjection_${id}`) collision-free.',
      );
    }
    this.memoryList.push(definition);
    return this;
  }

  /**
   * Register a RAG retriever — semantic search over a vector-indexed
   * corpus. Identical plumbing to `.memory()` (RAG resolves to a
   * `MemoryDefinition` produced by `defineRAG()`); this alias exists
   * so the consumer's intent reads clearly:
   *
   * ```ts
   * agent
   *   .memory(shortTermConversation)   // remembers what the USER said
   *   .rag(productDocs)                // retrieves what the CORPUS says
   *   .build();
   * ```
   *
   * Both end up as memory subflows, but the alias separates "user
   * conversation memory" from "document corpus retrieval" in code
   * intent, ids, and Lens chips.
   */
  rag(definition: MemoryDefinition): this {
    return this.memory(definition);
  }

  /**
   * Declarative terminal contract. The agent's final answer must be
   * JSON matching `parser`. Auto-injects a system-prompt instruction
   * telling the LLM the shape, and exposes `agent.runTyped()` /
   * `agent.parseOutput()` for parse + validate at the call site.
   *
   * The `parser` is duck-typed: any object with a `parse(unknown): T`
   * method works (Zod, Valibot, ArkType, hand-written). The optional
   * `description` field on the parser drives the auto-generated
   * instruction; consumers can also override via `opts.instruction`.
   *
   * Throws if called more than once on the same builder (avoids
   * silent override surprises).
   *
   * @param parser  Validation strategy that throws on shape failure.
   * @param opts    Optional `{ name, instruction }` to customize.
   *
   * @example
   *   import { z } from 'zod';
   *   const Output = z.object({
   *     status: z.enum(['ok', 'err']),
   *     items: z.array(z.string()),
   *   }).describe('A status enum + an array of strings.');
   *
   *   const agent = Agent.create({...})
   *     .outputSchema(Output)
   *     .build();
   *
   *   const typed = await agent.runTyped({ message: '...' });
   *   typed.status; // narrowed to 'ok' | 'err'
   */
  outputSchema<T>(parser: OutputSchemaParser<T>, opts?: OutputSchemaOptions): this {
    if (this.outputSchemaParser) {
      throw new Error(
        'AgentBuilder.outputSchema: already set. Each agent has at most one terminal contract.',
      );
    }
    this.outputSchemaParser = parser as OutputSchemaParser<unknown>;
    const instructionText = opts?.instruction ?? buildDefaultInstruction(parser);
    const id = opts?.name ?? 'output-schema';
    // Always-on system-slot instruction. Activates every iteration so
    // long runs keep the contract present (recency-first redundancy).
    this.injectionList.push(
      defineInstruction({
        id,
        activeWhen: () => true,
        prompt: instructionText,
      }),
    );
    return this;
  }

  /**
   * 3-tier degradation for output-schema validation failures. Pairs
   * with `.outputSchema()` — calling `.outputFallback()` without an
   * `outputSchema` first throws (the fallback has nothing to validate).
   *
   * Three tiers:
   *
   *   1. **Primary** — LLM emitted schema-valid JSON. Caller gets it.
   *   2. **Fallback** — `OutputSchemaError` thrown. The async
   *      `fallback(error, raw)` runs; its return is re-validated.
   *   3. **Canned** — static safety-net value. NEVER throws when set.
   *
   * `canned` is validated against the schema at builder time —
   * fail-fast on misconfig (a `canned` that doesn't validate would
   * defeat the fail-open guarantee).
   *
   * Two typed events fire on tier transitions for observability:
   *   - `agentfootprint.resilience.output_fallback_triggered`
   *   - `agentfootprint.resilience.output_canned_used`
   *
   * @example
   * ```ts
   * import { z } from 'zod';
   * const Refund = z.object({ amount: z.number(), reason: z.string() });
   *
   * const agent = Agent.create({...})
   *   .outputSchema(Refund)
   *   .outputFallback({
   *     fallback: async (err, raw) => ({ amount: 0, reason: 'manual review' }),
   *     canned:   { amount: 0, reason: 'unable to process' },
   *   })
   *   .build();
   * ```
   */
  outputFallback<T>(options: OutputFallbackOptions<T>): this {
    if (!this.outputSchemaParser) {
      throw new Error(
        'AgentBuilder.outputFallback: call .outputSchema(parser) FIRST. ' +
          'outputFallback supplements outputSchema; one without the other is incoherent.',
      );
    }
    if (this.outputFallbackCfg) {
      throw new Error(
        'AgentBuilder.outputFallback: already set. Each agent has at most one fallback chain.',
      );
    }
    // Build-time validation — canned MUST satisfy the schema.
    if (options.canned !== undefined) {
      validateCannedAgainstSchema(options.canned, this.outputSchemaParser as OutputSchemaParser<T>);
    }
    this.outputFallbackCfg = {
      fallback: options.fallback as OutputFallbackFn<unknown>,
      ...(options.canned !== undefined && { canned: options.canned as unknown }),
      hasCanned: options.canned !== undefined,
    };
    return this;
  }

  build(): Agent {
    // Resolve the voice config: bundled defaults + consumer overrides.
    // Templates flow through the same barrel exports the rest of the
    // library uses, so a future locale-pack swap is a single import.
    const voice = {
      appName: this.appNameValue,
      commentaryTemplates: { ...defaultCommentaryTemplates, ...this.commentaryOverrides },
      thinkingTemplates: { ...defaultThinkingTemplates, ...this.thinkingOverrides },
    };
    const opts =
      this.maxIterationsOverride !== undefined
        ? { ...this.opts, maxIterations: this.maxIterationsOverride }
        : this.opts;
    const agent = new Agent(
      opts,
      this.systemPromptValue,
      this.registry,
      voice,
      this.injectionList,
      this.memoryList,
      this.outputSchemaParser,
      this.toolProviderRef,
      this.systemPromptCachePolicy,
      this.cachingDisabledValue,
      this.cacheStrategyOverride,
      this.outputFallbackCfg,
    );
    // Attach builder-collected recorders so they receive events from
    // the very first run. Mirrors what consumers would do post-build
    // via `agent.attach(rec)`; the builder method is purely sugar.
    for (const rec of this.recorderList) {
      agent.attach(rec);
    }
    return agent;
  }
}

// Validators + helpers extracted to ./agent/validators.ts (v2.11.1).

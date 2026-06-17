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
  type AttachRecorderOptions,
  type CombinedNarrativeEntry,
  type CombinedRecorder,
  type CommitValuesMode,
  type FlowChart,
  type FlowchartCheckpoint,
  type ObserverDrainResult,
  type ReadTrackingMode,
  type RunOptions,
  type RuntimeSnapshot,
} from 'footprintjs';
import type { CachePolicy, CacheStrategy } from '../cache/types.js';
import type { ReliabilityConfig } from '../reliability/types.js';
import { ReliabilityFailFastError } from '../reliability/types.js';
import { extractSequence } from '../security/extractSequence.js';
import { PolicyHaltError } from '../security/PolicyHaltError.js';
import { updateSkillHistory as updateSkillHistoryStage } from '../cache/CacheGateDecider.js';
import { getDefaultCacheStrategy } from '../cache/strategyRegistry.js';
import { SUBFLOW_IDS } from '../conventions.js';
import { type RunnerPauseOutcome } from './pause.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMToolSchema,
  PermissionChecker,
  PricingTable,
} from '../adapters/types.js';
import type { CredentialProvider } from '../identity/types.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { contextEvaluatedRecorder } from '../recorders/core/ContextEvaluatedRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { errorBridge } from '../recorders/core/ErrorBridge.js';
import { costRecorder } from '../recorders/core/CostRecorder.js';
import { permissionRecorder } from '../recorders/core/PermissionRecorder.js';
import { evalRecorder } from '../recorders/core/EvalRecorder.js';
import { memoryRecorder } from '../recorders/core/MemoryRecorder.js';
import { skillRecorder } from '../recorders/core/SkillRecorder.js';
import { validationRecorder } from '../recorders/core/ValidationRecorder.js';
import { toolsRecorder } from '../recorders/core/ToolsRecorder.js';
import { reliabilityRecorder } from '../recorders/core/ReliabilityRecorder.js';
import type { MemoryDefinition } from '../memory/define.types.js';
import {
  causalEvidenceRecorder,
  type CausalEvidenceRecorderHandle,
} from '../memory/causal/evidenceRecorder.js';
import { buildSystemPromptSlot } from './slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from './slots/buildMessagesSlot.js';
import { buildToolsSlot, type ProviderToolCache } from './slots/buildToolsSlot.js';
import { buildInjectionEngineSubflow } from '../lib/injection-engine/buildInjectionEngineSubflow.js';
import type { Injection, InjectionContext } from '../lib/injection-engine/types.js';
import { applyOutputFallback, type ResolvedOutputFallback } from './outputFallback.js';
import {
  buildCheckpoint,
  classifyFailurePhase,
  RunCheckpointError,
  validateCheckpoint,
  type AgentRunCheckpoint,
  type RunCheckpointTracker,
} from './runCheckpoint.js';
import { applyOutputSchema, OutputSchemaError, type OutputSchemaParser } from './outputSchema.js';
import { RunnerBase, makeRunId } from './RunnerBase.js';
import type { ToolRegistryEntry } from './tools.js';
import type { ToolProvider } from '../tool-providers/types.js';
import {
  clampIterations,
  validateMemoryIdUniqueness,
  validateToolNameUniqueness,
} from './agent/validators.js';
import type {
  AgentInput,
  AgentOptions,
  AgentOutput,
  AgentState,
  ObserverDeliveryOptions,
} from './agent/types.js';
import { routeDeciderStage } from './agent/stages/route.js';
import { buildSeedStage } from './agent/stages/seed.js';
import { buildCallLLMStage } from './agent/stages/callLLM.js';
import { buildToolCallsHandler } from './agent/stages/toolCalls.js';
import type { ToolArgValidationMode } from './agent/toolArgsValidation.js';
import { buildAgentChart } from './agent/buildAgentChart.js';
import { buildDynamicAgentChart } from './agent/buildDynamicAgentChart.js';
import { buildToolRegistry } from './agent/buildToolRegistry.js';
import { AgentBuilder } from './agent/AgentBuilder.js';
import { buildThinkingSubflow } from './slots/buildThinkingSubflow.js';
import { findThinkingHandler } from '../thinking/registry.js';
import type { ThinkingHandler } from '../thinking/types.js';
export { AgentBuilder };

// Re-export public Agent types so the 28+ existing import sites
// (e.g., `import { type AgentInput } from '../core/Agent.js'`) keep
// working while implementation gradually moves into `./agent/*`.
// Public types canonically live in `./agent/types.ts` (v2.11.1).
export type { AgentInput, AgentOptions, AgentOutput, ObserverDeliveryOptions };

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
  /** Skill-graph cursor resolver (`graph.nextSkill`), set when built via
   *  `.skillGraph(graph)`. Plumbed into the Injection Engine so route triggers
   *  are `from`-gated against the persisted `currentSkillId`. */
  private readonly skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined;
  /** Skill-graph reachable-set resolver (`graph.reachableSkills`), set when built
   *  via `.skillGraph(graph)`. Plumbed into the tool-calls handler so `read_skill`
   *  is gated to in-graph jumps. Undefined → gate off. */
  private readonly skillGraphReachable?: (currentSkillId?: string) => readonly string[];
  private readonly pricingTable?: PricingTable;
  private readonly costBudget?: number;
  private readonly permissionChecker?: PermissionChecker;
  private readonly toolArgValidation?: ToolArgValidationMode;
  /** Snapshot read-tracking policy (#18/#14) — forwarded to the internal
   *  executor. Agent default is `'summary'` (cheap markers), NOT
   *  footprintjs's `'full'`. See AgentOptions.readTracking. */
  private readonly readTracking: ReadTrackingMode;
  /** Commit-log value encoding (#13c-B) — forwarded to the internal
   *  executor. Agent default is `'delta'` (append/delete verbs; growing
   *  arrays like `history` record only their tails — lossless, linear
   *  retained memory), NOT footprintjs's `'full'`. See
   *  AgentOptions.commitValues. */
  private readonly commitValues: CommitValuesMode;
  private readonly credentialProvider?: CredentialProvider;
  /** Evidence bridge (#5) — present iff a CAUSAL memory is mounted. */
  private readonly causalEvidence?: CausalEvidenceRecorderHandle;
  /** Observer delivery tier (RFC-001 Block 10). `'inline'` (default) is
   *  byte-identical to pre-10 releases; `'deferred'` routes the bridge
   *  recorders + consumer attachments through footprintjs's bounded
   *  capture queue. See AgentOptions.observerDelivery. */
  private readonly observerDelivery: 'inline' | 'deferred';
  /** Queue dials forwarded on every deferred attach (first attach
   *  configures the executor's single dispatcher). */
  private readonly observerDeliveryOptions?: ObserverDeliveryOptions;

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

  // `lastExecutor` is now inherited as a protected field from RunnerBase
  // (single canonical source for footprintjs snapshot access across all
  // runners). Agent's `getLastSnapshot()` delegates to the inherited
  // implementation but is kept here for the JSDoc + clearer return type.

  // The chart is now cached on RunnerBase (`protected chart`) via
  // `initChart()` — built ONCE at constructor time. `getSpec()` returns
  // it. `createExecutor()` reuses it. The earlier `lastFlowChart`
  // field was a per-run workaround for the lazy-build pattern; both
  // are obsolete now. `getSpec()` always returns the same reference
  // the executor traces.

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

  /**
   * Optional rules-based reliability config (v2.11.5+). Set via the
   * builder's `.reliability({...})`. When present, every CallLLM
   * execution is wrapped in a retry/fallback/fail-fast loop driven
   * by `preCheck` and `postDecide` rules. Consumed by `buildCallLLMStage`.
   */
  private readonly reliabilityConfig?: ReliabilityConfig;

  /**
   * Resolved ThinkingHandler (v2.14+). Auto-wired by `provider.name`
   * via `findThinkingHandler` UNLESS the builder explicitly set one
   * (or `null` to opt out). When undefined, the NormalizeThinking
   * sub-subflow is NOT mounted at chart build time — zero overhead
   * for non-thinking agents.
   */
  private readonly thinkingHandler?: ThinkingHandler;
  /**
   * v2.14+ — request-side thinking budget. When set, every LLMRequest
   * carries `thinking: { budget }`. AnthropicProvider translates to the
   * wire format. Undefined = no thinking activation (default behavior).
   */
  private readonly thinkingBudget?: number;
  /** Threaded to footprintjs `flowChart()` so every node the Agent
   *  builder creates is observed by these recorders at build time. Set
   *  from `opts.structureRecorders`; undefined when consumer didn't
   *  attach any. */
  private readonly structureRecorders?: readonly import('footprintjs').StructureRecorder[];
  /** Per-COMPOSITION translator (L1b). Set from `opts.groupTranslator`;
   *  undefined when consumer didn't attach one. */
  private readonly agentGroupTranslator?: import('./translator.js').GroupTranslator;
  /** ReAct loop mode — 'dynamic' (default, re-engineer all slots each turn,
   *  flat chart), 'classic' (engineer context once, loop→Messages only, flat
   *  chart), or 'dynamic-grouped' (dynamic semantics + LLM turn wrapped in an
   *  sf-llm-call subflow for richer Lens grouping). Set from `opts.reactMode`.
   *  See AgentOptions. */
  private readonly reactMode: 'classic' | 'dynamic' | 'dynamic-grouped';

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
    reliabilityConfig?: ReliabilityConfig,
    thinkingHandlerValue?: ThinkingHandler | null,
    thinkingBudgetValue?: number,
    skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined,
    skillGraphReachable?: (currentSkillId?: string) => readonly string[],
  ) {
    super();
    this.provider = opts.provider;
    this.name = opts.name ?? 'Agent';
    this.id = opts.id ?? 'agent';
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.maxTokens = opts.maxTokens;
    this.maxIterations = clampIterations(opts.maxIterations ?? 10);
    this.structureRecorders = opts.structureRecorders;
    this.agentGroupTranslator = opts.groupTranslator;
    this.reactMode = opts.reactMode ?? 'dynamic';
    this.systemPromptValue = systemPromptValue;
    this.systemPromptCachePolicy = systemPromptCachePolicy;
    this.cachingDisabledValue = cachingDisabled;
    // Auto-resolve strategy from provider.name unless caller overrides.
    // NoOp is the wildcard fallback so unknown providers stay safe.
    this.cacheStrategy = cacheStrategy ?? getDefaultCacheStrategy(opts.provider.name);
    this.registry = registry;
    this.injections = injections;
    this.skillGraphNextSkill = skillGraphNextSkill;
    this.skillGraphReachable = skillGraphReachable;
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
    // Evidence bridge (#5): a CAUSAL memory gets a run-scoped harvest recorder
    // (decisions/toolCalls/iterations/duration/tokens). Attached per run below;
    // its `collect` is threaded into the write mount via chartDeps.
    if (memories.some((m) => m.type === 'causal')) {
      this.causalEvidence = causalEvidenceRecorder();
    }
    if (opts.pricingTable) this.pricingTable = opts.pricingTable;
    if (opts.costBudget !== undefined) this.costBudget = opts.costBudget;
    if (opts.permissionChecker) this.permissionChecker = opts.permissionChecker;
    if (opts.toolArgValidation !== undefined) this.toolArgValidation = opts.toolArgValidation;
    // Default 'summary' — measurement-gated (#18): stageReads values have
    // zero consumers across af/lens/eui, and 'full' clones ~18MB of unread
    // data per 200 iterations. Consumers opt into 'full' explicitly.
    this.readTracking = opts.readTracking ?? 'summary';
    // Default 'delta' — the accepted #13c-B design: agentfootprint opts in
    // immediately (the agent's history-append workload is exactly the case
    // the verb exists for; reconstruction stays lossless via commitValueAt).
    this.commitValues = opts.commitValues ?? 'delta';
    // RFC-001 Block 10 — observer delivery tier. Fail fast on the dials
    // without the switch (no silently-ignored combinations; same policy
    // that merged reactMode/reactStructure in 6.0.0).
    this.observerDelivery = opts.observerDelivery ?? 'inline';
    if (opts.observerDeliveryOptions !== undefined && this.observerDelivery !== 'deferred') {
      throw new Error(
        "Agent: observerDeliveryOptions requires observerDelivery: 'deferred' — " +
          'the dials configure the deferred capture queue and have no meaning inline.',
      );
    }
    this.observerDeliveryOptions = opts.observerDeliveryOptions;
    if (opts.credentials) this.credentialProvider = opts.credentials;
    if (reliabilityConfig !== undefined) this.reliabilityConfig = reliabilityConfig;
    // v2.14 — Resolve thinking handler. Three states:
    //   - thinkingHandlerValue === undefined → auto-wire by provider.name
    //   - thinkingHandlerValue === null      → opt out (no handler)
    //   - thinkingHandlerValue: ThinkingHandler → explicit override
    // Auto-wire returns undefined for providers without a registered
    // handler (gpt-4o, mistral, etc.), in which case the subflow is NOT
    // mounted at chart build time.
    if (thinkingHandlerValue === null) {
      // explicit opt-out
    } else if (thinkingHandlerValue !== undefined) {
      this.thinkingHandler = thinkingHandlerValue;
    } else {
      const auto = findThinkingHandler(opts.provider.name);
      if (auto) this.thinkingHandler = auto;
    }
    if (thinkingBudgetValue !== undefined) this.thinkingBudget = thinkingBudgetValue;
    this.appName = voice.appName;
    this.commentaryTemplates = voice.commentaryTemplates;
    this.thinkingTemplates = voice.thinkingTemplates;

    // Eager chart construction — see `RunnerBase.initChart` JSDoc.
    // Note re Agent specifics (footprintjs inventor's review):
    // - `providerToolCache: { current: Tool[] }` is closed over by the
    //   chart's Discover + dispatch stages. It's shared across
    //   sequential runs of this Agent instance, but the Discover stage
    //   overwrites `current` at the start of every iteration (line 158
    //   of `buildToolsSlot.ts`), so stale data never reaches a tool
    //   call. Concurrent runs on the SAME Agent instance already share
    //   `currentRunContext` and the recorder dispatcher — eager build
    //   doesn't change that constraint.
    // - `currentRunContext` is read by the per-stage `getRunCtx`
    //   lambda at execution time (not at chart-build time), so a fresh
    //   value per run still flows through correctly.
    this.initChart(() => this.buildChart());
  }

  static create(opts: AgentOptions): AgentBuilder {
    return new AgentBuilder(opts);
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
  // `getSpec()` inherited from RunnerBase — returns the cached chart
  // built once at constructor time via `initChart()`. Same reference
  // every call, same reference the executor traces.

  // ─── UI group translation (L1b) ───────────────────────────────
  protected override getGroupTranslator(): import('./translator.js').GroupTranslator | undefined {
    return this.agentGroupTranslator;
  }

  /** Agent has no nested-runner members (tools are function executors,
   *  not Runner instances). Slot ids + tool names live in `extra` so
   *  Lens can render an Agent card with slot rows + a tool list without
   *  inspecting `buildTimeStructure`.
   *
   *  Memories are NOT included as members — they're an internal
   *  mechanism, not a composition-level concept. Consumers who need
   *  memory visibility should listen for `agentfootprint.memory.*`
   *  events at runtime. */
  protected override buildUIGroupMetadata(): import('./translator.js').GroupMetadata {
    const toolNames = this.registry.map((r) => r.name);
    return {
      kind: 'Agent',
      id: this.id,
      name: this.name,
      members: [],
      extra: {
        slots: [SUBFLOW_IDS.SYSTEM_PROMPT, SUBFLOW_IDS.MESSAGES, SUBFLOW_IDS.TOOLS] as const,
        toolNames,
        maxIterations: this.maxIterations,
      },
    };
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
        // Co-engineered boundary (#16): the engine's loop-iteration limit
        // (footprintjs 9 default 1000) must never fire BELOW the agent's own
        // budget — give it headroom (×2 + 10 covers double-hop loop shapes).
        // Consumer-provided options win.
        maxIterations: this.maxIterations * 2 + 10,
        ...(options ?? {}),
      });
      return this.finalizeResult(executor, result);
    } catch (cause) {
      // Wrap recoverable errors with the last-known-good checkpoint.
      // Don't wrap intentional terminal signals — let them propagate as
      // their typed shapes so callers can `instanceof` them:
      //   • PauseSignal — askHuman pause, not a failure
      //   • PolicyHaltError — policy-driven termination; resuming would
      //     immediately re-trigger the same halt (the synthetic
      //     tool_result is already in history)
      //   • ReliabilityFailFastError — finalizeResult constructs and
      //     throws this AFTER the chart returns cleanly, so it never
      //     enters this catch (kept here for documentation only)
      const isTerminalTypedError =
        cause instanceof Error &&
        (cause.name === 'PauseSignal' ||
          cause instanceof PolicyHaltError ||
          cause instanceof ReliabilityFailFastError);
      if (cause instanceof Error && !isTerminalTypedError && tracker.history.length > 0) {
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
   * **Resume = REPLAY from the last completed iteration boundary,
   * not exact-state restore.** Only the conversation history is
   * restored; everything else re-seeds fresh:
   *
   *   - **Tool re-execution / idempotency**: tool side effects from
   *     the FAILED iteration are not in the checkpoint. The model
   *     re-decides from the restored history and may re-issue those
   *     tool calls — they WILL execute again (there is no built-in
   *     toolCallId dedup). Mutating tools (payments, emails, DB
   *     writes) must be idempotent — key on stable call content, not
   *     `ctx.toolCallId` (a re-issued call gets a new id).
   *   - **Fresh `runId`**: the resumed run's events carry a new
   *     `runId`; use `checkpoint.runId` to correlate back to the
   *     failing run.
   *   - **Iteration counter + budget reset**: the resumed run starts
   *     at iteration 1 with a full `maxIterations` budget
   *     (`checkpoint.lastCompletedIteration` is diagnostic only).
   *     Token/cost accumulators also restart at zero.
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

    // Reuse the cached chart built at constructor time.
    // The Agent's executor dials: readTracking (#18/#14, snapshot stageReads)
    // and commitValues (#13c-B, commit-log value encoding).
    const executor = new FlowChartExecutor(this.getSpec(), {
      readTracking: this.readTracking,
      commitValues: this.commitValues,
    });
    // Enable structured narrative so `getLastNarrativeEntries()` can
    // hand a populated array to consumer Trace views (ExplainableShell).
    // Cheap when no consumer reads it; the recorder accumulates only.
    executor.enableNarrative();
    this.lastExecutor = executor;

    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    // RFC-001 Block 10 — observer delivery tier. With 'deferred', every
    // bridge below is attached onto footprintjs's bounded capture queue
    // ("one beat behind": capture inline ≈ microseconds, delivery at the
    // next microtask checkpoint, terminal flush before run()/resume()
    // returns). Default 'inline' attaches with no options bag —
    // byte-identical to every prior release.
    const deferredOpts: AttachRecorderOptions | undefined =
      this.observerDelivery === 'deferred'
        ? { delivery: 'deferred', ...this.observerDeliveryOptions }
        : undefined;
    const attachObserver = (rec: CombinedRecorder): void => {
      if (deferredOpts) executor.attachCombinedRecorder(rec, deferredOpts);
      else executor.attachCombinedRecorder(rec);
    };

    attachObserver(new ContextRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Evidence bridge (#5): harvest decisions/toolCalls/tokens for causal snapshots.
    // ALWAYS INLINE — never routed through the deferred queue: the memory
    // write stage consumes its accumulators MID-run (`collect()` via
    // `evidenceSource`, mountMemoryPipeline). Deferred delivery would run
    // `collect()` before the queue flushed the turn's tool/token/decision
    // events, persisting an incomplete causal snapshot.
    if (this.causalEvidence) executor.attachCombinedRecorder(this.causalEvidence);
    // The InjectionEngine typedEmits context.evaluated; this bridge forwards it
    // to the dispatcher (ContextRecorder handles the write-derived context.*).
    attachObserver(contextEvaluatedRecorder({ dispatcher, getRunContext: getRunCtx }));
    attachObserver(streamRecorder({ dispatcher, getRunContext: getRunCtx }));
    // agentRecorder feeds the run-checkpoint tracker (iteration_end →
    // history snapshot), which is read ONLY in run()'s catch — after the
    // engine's terminal flush at the reject boundary — so deferral is safe
    // (pinned by test: crash checkpoints stay complete under 'deferred').
    attachObserver(agentRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Terminal-failure bridge: footprintjs onRunFailed → typed error.fatal,
    // so a thrown run clears in-flight live state + flips monitor status.
    // Deferral-safe: the reject-boundary terminal flush delivers error.fatal
    // before the rejection reaches the caller.
    attachObserver(errorBridge({ dispatcher, getRunContext: getRunCtx }));
    if (this.pricingTable) {
      attachObserver(costRecorder({ dispatcher, getRunContext: getRunCtx }));
    }
    if (this.permissionChecker) {
      attachObserver(permissionRecorder({ dispatcher, getRunContext: getRunCtx }));
    }
    // Always-on bridges for consumer-emitted domain events.
    attachObserver(evalRecorder({ dispatcher, getRunContext: getRunCtx }));
    attachObserver(memoryRecorder({ dispatcher, getRunContext: getRunCtx }));
    attachObserver(skillRecorder({ dispatcher, getRunContext: getRunCtx }));
    attachObserver(toolsRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Tool-args validation events (#9) — always-on; zero-cost when no
    // validation event fires.
    attachObserver(validationRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Reliability telemetry (rules-loop fail_fast / retried / recovered).
    // Always-on, but zero-cost when no .reliability() config fires events.
    attachObserver(reliabilityRecorder({ dispatcher, getRunContext: getRunCtx }));
    for (const r of this.attachedRecorders) {
      // A recorder's OWN `delivery` field is more specific than the
      // agent-level default — footprintjs's options bag would override the
      // field, so recorders that declare a tier are attached bare (their
      // field rules). This gives consumers a per-recorder escape hatch:
      // `{ id, delivery: 'inline', ...hooks }` stays inline under an
      // observerDelivery: 'deferred' agent, and vice versa.
      if (r.delivery !== undefined) executor.attachCombinedRecorder(r);
      else attachObserver(r);
    }
    return executor;
  }

  /**
   * Flush the deferred-observer backlog of the most recent run's executor,
   * then await async listener completions under a deadline (RFC-001 §11 —
   * the serverless / graceful-shutdown pattern). Resolves immediately with
   * zeros before the first run or when `observerDelivery` is `'inline'`
   * and no recorder opted into `'deferred'` itself.
   *
   * `pending === 0` means a full drain; non-zero honestly reports
   * continuations still outstanding at the deadline — never silent loss.
   *
   * @example Lambda-style handler
   * ```ts
   * export const handler = async (event) => {
   *   const reply = await agent.run({ message: event.message });
   *   // settle "one beat behind" observer work BEFORE the freeze:
   *   await agent.drainObservers({ timeoutMs: 5_000 });
   *   return reply;
   * };
   * ```
   */
  drainObservers(opts?: { timeoutMs?: number }): Promise<ObserverDrainResult> {
    if (!this.lastExecutor) return Promise.resolve({ done: 0, failed: 0, pending: 0 });
    return this.lastExecutor.drainObservers(opts);
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): AgentOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    // Reliability fail-fast translation (v2.11.5+) — when the
    // reliability retry loop in callLLM hits a `fail-fast` decision,
    // it writes scope.reliabilityFailKind + payload and calls $break.
    // The chart stops; the executor returns the last finalContent
    // (typically empty). At the API boundary we surface the typed
    // error so consumers can `instanceof ReliabilityFailFastError`
    // and branch on `.kind`.
    if (this.reliabilityConfig !== undefined) {
      const snap = executor.getSnapshot();
      // Read via Pick<AgentState, …> so the read shape cannot drift from
      // the typed write side (the fields are declared once on AgentState).
      const state = snap.sharedState as Pick<
        AgentState,
        | 'reliabilityFailKind'
        | 'reliabilityFailPayload'
        | 'reliabilityFailReason'
        | 'reliabilityFailCauseMessage'
        | 'reliabilityFailCauseName'
      >;
      if (state.reliabilityFailKind !== undefined) {
        // Reconstruct the cause Error from the captured message+name —
        // see the matching note in reliabilityExecution.failFast about
        // why we don't keep the original Error in scope.
        let cause: Error | undefined;
        if (state.reliabilityFailCauseMessage !== undefined) {
          cause = new Error(state.reliabilityFailCauseMessage);
          if (state.reliabilityFailCauseName !== undefined) {
            cause.name = state.reliabilityFailCauseName;
          }
        }
        throw new ReliabilityFailFastError({
          kind: state.reliabilityFailKind,
          reason: state.reliabilityFailReason ?? state.reliabilityFailKind,
          ...(cause !== undefined && { cause }),
          ...(state.reliabilityFailPayload !== undefined && {
            payload: state.reliabilityFailPayload,
          }),
          snapshot: snap,
        });
      }
    }
    // Policy-halt translation (v2.12+) — when a `PermissionChecker` returns
    // `{ result: 'halt', ... }`, the toolCalls handler writes a synthetic
    // tool_result, emits `agentfootprint.permission.halt`, sets
    // scope.policyHalt* fields, and calls $break. The chart stops; we
    // surface the typed error here so callers can `instanceof PolicyHaltError`
    // and branch on `.reason` for alert routing.
    {
      const snap = executor.getSnapshot();
      const state = snap.sharedState as {
        policyHaltReason?: string;
        policyHaltTellLLM?: string;
        policyHaltTarget?: string;
        policyHaltArgs?: Readonly<Record<string, unknown>>;
        policyHaltIteration?: number;
        policyHaltCheckerId?: string;
        history?: import('../adapters/types.js').LLMMessage[];
      };
      if (state.policyHaltReason !== undefined && state.policyHaltTarget !== undefined) {
        const history = state.history ?? [];
        const iteration = state.policyHaltIteration ?? 1;
        // Sequence at halt time — derived from history. Includes the
        // proposed call (which DID land in history as the synthetic
        // tool_result for protocol compliance, but the policy denied
        // execution). Filter it out so callers see only dispatched
        // calls, then append the proposed entry as a hint.
        const sequenceWithoutProposed = extractSequence(history.slice(0, -1), iteration);
        throw new PolicyHaltError({
          reason: state.policyHaltReason,
          ...(state.policyHaltTellLLM !== undefined && { tellLLM: state.policyHaltTellLLM }),
          sequence: [
            ...sequenceWithoutProposed,
            { name: state.policyHaltTarget, args: state.policyHaltArgs, iteration },
          ],
          iteration,
          history,
          proposed: { name: state.policyHaltTarget, args: state.policyHaltArgs ?? {} },
          ...(state.policyHaltCheckerId !== undefined && { checkerId: state.policyHaltCheckerId }),
        });
      }
    }
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
    const credentialProvider = this.credentialProvider;
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

    // Tool registry composition extracted to ./agent/buildToolRegistry.ts.
    // Composes static .tool() registry + auto-attached read_skill +
    // skill-supplied tools (with autoActivate scoping); validates
    // name uniqueness; produces the dispatch map.
    const { registryByName, toolSchemas } = buildToolRegistry(registry, this.injections);
    // Late-bind toolSchemas into the seed stage's deps (the factory was
    // built earlier with a getter; this resolves the actual value).
    toolSchemasResolved = toolSchemas;

    const injectionEngineSubflow = buildInjectionEngineSubflow({
      injections: this.injections,
      ...(this.skillGraphNextSkill && { nextSkill: this.skillGraphNextSkill }),
    });
    const systemPromptSubflow = buildSystemPromptSlot({
      prompt: systemPromptValue,
      reason: 'Agent.system()',
    });
    const messagesSubflow = buildMessagesSlot();
    // Per-run cache shared between buildToolsSlot (writer, each
    // iteration) and buildToolCallsHandler (reader, same iteration).
    // Holds the resolved Tool[] from `provider.list(ctx)` so dispatch
    // doesn't re-invoke `list()` — vital for async network providers.
    // A fresh chart (and thus fresh cache) is built per `agent.run()`,
    // so concurrent runs don't share state.
    const providerToolCache: ProviderToolCache = { current: [] };
    const toolsSubflow = buildToolsSlot({
      tools: toolSchemas,
      ...(this.externalToolProvider && { toolProvider: this.externalToolProvider }),
      ...(this.externalToolProvider && { providerToolCache }),
    });

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
      ...(this.reliabilityConfig !== undefined && { reliability: this.reliabilityConfig }),
      ...(this.outputSchemaParser !== undefined && {
        outputSchemaParser: this.outputSchemaParser,
      }),
      ...(this.thinkingBudget !== undefined && { thinkingBudget: this.thinkingBudget }),
    });

    // routeDecider extracted to ./agent/stages/route.ts (v2.11.2).
    const routeDecider = routeDeciderStage;

    // toolCallsHandler extracted to ./agent/stages/toolCalls.ts (v2.11.2).
    const toolCallsHandler = buildToolCallsHandler({
      registryByName,
      ...(this.externalToolProvider && { externalToolProvider: this.externalToolProvider }),
      ...(this.externalToolProvider && { providerToolCache }),
      ...(permissionChecker && { permissionChecker }),
      ...(credentialProvider && { credentialProvider }),
      ...(this.toolArgValidation && { toolArgValidation: this.toolArgValidation }),
      // Skill-graph read_skill gate: bound the model's read_skill jumps to the
      // reachable set from the current cursor. Undefined → gate off (back-compat).
      ...(this.skillGraphReachable && { allowedSkillIds: this.skillGraphReachable }),
    });

    // v2.14 — Build the NormalizeThinking sub-subflow only when a
    // ThinkingHandler resolved (auto-wired by provider.name OR
    // explicitly set via .thinkingHandler()). Conditional mount ensures
    // zero overhead for non-thinking agents — the chart has zero extra
    // stages when undefined.
    const thinkingSubflow = this.thinkingHandler
      ? buildThinkingSubflow(this.thinkingHandler)
      : undefined;

    // Chart composition extracted to ./agent/buildAgentChart.ts (v2.11.2).
    // The deps object is identical for both chart shapes — only the
    // wiring differs (flat call-llm stage vs sf-llm-call subflow).
    const chartDeps = {
      memories: this.memories,
      // Evidence bridge (#5): closure hand-off to the CAUSAL write mounts.
      ...(this.causalEvidence && { causalEvidenceSource: this.causalEvidence.collect }),
      systemPromptCachePolicy,
      maxIterations,
      seed,
      callLLM,
      routeDecider,
      toolCallsHandler,
      injectionEngineSubflow,
      systemPromptSubflow,
      messagesSubflow,
      toolsSubflow,
      ...(thinkingSubflow !== undefined && { thinkingSubflow }),
      updateSkillHistoryStage,
      // Gate the UpdateSkillHistory stage on skills being registered —
      // same idiom buildToolRegistry uses to auto-attach `read_skill`.
      hasSkills: this.injections.some((i) => i.flavor === 'skill'),
      // Builders only branch on classic-vs-dynamic SEMANTICS; the grouped
      // chart shape is selected below by choosing buildDynamicAgentChart.
      reactMode: (this.reactMode === 'classic' ? 'classic' : 'dynamic') as 'classic' | 'dynamic',
      ...(this.structureRecorders !== undefined && {
        structureRecorders: [...this.structureRecorders],
      }),
    };

    // `'dynamic-grouped'` wraps the whole LLM turn in an `sf-llm-call` subflow —
    // the same boundary LLMCall produces — so Lens / explainable-ui render it as
    // an LLM group with its slots inside. `'classic'` and `'dynamic'` use the
    // flat chart; they differ only in `chartDeps.reactMode` (whether the Context
    // selector re-engineers the static slots each turn). Grouping is dynamic-only
    // (it re-seeds context every turn by design), so there is no classic-grouped.
    return this.reactMode === 'dynamic-grouped'
      ? buildDynamicAgentChart(chartDeps)
      : buildAgentChart(chartDeps);
  }
}

// AgentBuilder extracted to ./agent/AgentBuilder.ts (v2.11.2).
// Re-export so the 28+ existing import sites continue to work unchanged.

// Validators + helpers extracted to ./agent/validators.ts (v2.11.1).

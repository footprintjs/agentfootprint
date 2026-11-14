import { livePort } from './builder/livePort.js';
import { setSystem, type PromptPort } from './builder/prompt/system.js';
import {
  currentRecipeSource,
  type RecipeSourcePort,
  type DuplicateRegistrationPort,
} from './builder/recipes/source.js';
import { duplicateRegistration } from './builder/recipes/source.js';
import { applyRecipe, type RecipePort } from './builder/recipes/apply.js';
import { setRunConfiguration, type RunConfigurationPort } from './builder/settings/configure.js';
import { setMaxIterations, type IterationLimitPort } from './builder/settings/iterations.js';
import { setWindowStrategy, type WindowConfigurationPort } from './builder/window/configure.js';
import { setCompaction } from './builder/window/configure.js';
import {
  assertDistinctSummarizer,
  type SummarizerIdentityPort,
  type WindowConflictPort,
} from './builder/window/guards.js';
import { assertWindowNotSet } from './builder/window/guards.js';
import { setThinkingBudget, type ThinkingBudgetPort } from './builder/thinking/configure.js';
import { registerTool, type ToolRegistrationPort } from './builder/tools/register.js';
import { setToolProvider, type ToolProviderPort } from './builder/tools/provider.js';
import { configureAct, type ActPort } from './builder/act/configure.js';
import { registerInjection, type InjectionPort } from './builder/injections/register.js';
import { mountSkillGraph, type GraphMountPort } from './builder/graph/mount.js';
import { configureMaps, type MapsPort, type MapsPlanPort } from './builder/maps/configure.js';
import { resolveMapsPlan } from './builder/maps/configure.js';
import { configureClaims, type ClaimsPort } from './builder/claims/configure.js';
import { registerMemory, type MemoryPort } from './builder/memory/register.js';
import { configureEvidence, type EvidencePort } from './builder/evidence/configure.js';
import { configureAnswerLimits, type AnswerLimitsPort } from './builder/answer/limits.js';
import { configureScriptTravel, type ScriptTravelPort } from './builder/scripts/configure.js';
import {
  configureInputsLayer,
  type InputsLayerPort,
  type ResultsLayerPort,
  type AnswerLayerPort,
} from './builder/honesty/layers.js';
import { configureResultsLayer } from './builder/honesty/layers.js';
import { configureAnswerLayer } from './builder/honesty/layers.js';
import { configureTime, type TimePort } from './builder/time/configure.js';
import { configureSkillToolScope, type SkillToolScopePort } from './builder/skills/scope.js';
import { configureOutputSchema, type OutputSchemaPort } from './builder/output/schema.js';
import { configureOutputFallback, type OutputFallbackPort } from './builder/output/fallback.js';
import { assertOutputFallbackCoherent } from './builder/output/fallback.js';
import {
  resolveOutputEnforcement,
  type OutputEnforcementPort,
} from './builder/output/enforcement.js';
import { configureFindings, type FindingsPort } from './builder/findings/configure.js';
import { configureToolChoice, type ToolChoicePort } from './builder/toolChoice/configure.js';
import { configureOntology, type OntologyPort } from './builder/ontology/configure.js';
import { assertToolMiddleware } from './builder/middleware/guards.js';
import { assertMiddleware } from './builder/middleware/guards.js';
import { configureCheckIn, type CheckInPort } from './builder/consent/configure.js';
import { configureSelfExplain, type SelfExplainPort } from './builder/selfExplain/configure.js';
import { assembleAgent, type AssemblyPort } from './builder/assembly/build.js';
/**
 * AgentBuilder — fluent builder for Agent. Extracted from Agent.ts in
 * v2.11.2 as part of the core/agent decomposition. Same surface, same
 * behavior; just lives in its own file for readability.
 *
 * Re-exported by Agent.ts so external consumers importing
 * `AgentBuilder` from `'../core/Agent.js'` continue to work.
 */

import type { SkillGraphOptions } from './builder/graph/options.js';
export type { SkillGraphOptions } from './builder/graph/options.js';
import {
  resolveAnswerValidation,
  type AnswerValidationOptions,
  type ResolvedAnswerValidation,
} from '../../answer-validation/index.js';

import {
  type OutputSchemaOptions,
  type OutputSchemaParser,
  type OutputSchemaStrategy,
} from '../../answer-validation/outputSchema.js';
import { type ResolvedOutputEnforcement } from './outputEnforcement.js';
import {
  resolveNegativeClaims,
  type NegativeClaimsOptions,
  type ResolvedNegativeClaims,
} from './negativeClaims/config.js';
import type { NamesAndNumbersOptions, ResolvedEvidenceGate } from './evidence/types.js';
import { type OutputFallbackOptions, type ResolvedOutputFallback } from '../outputFallback.js';
import type { CachePolicy, CacheStrategy } from '../../cache/types.js';
import type { EngagementPlan, MapsOptions } from '../../maps/engagement/types.js';
import type { Injection, InjectionContext } from '../../injection-engine/types.js';
import {
  type CursorMove,
  type EntryScoring,
  type TurnRoutingPlan,
} from '../../injection-engine/skillGraph.js';
import type { MemoryDefinition } from '../../memory/define.types.js';
import type { ReliabilityConfig } from '../../reliability/types.js';
import type { ThinkingHandler } from '../../thinking/types.js';
import type { Tool, ToolRegistryEntry } from '../../tools/tools.js';
import type { StandingLineWhen } from './assessment/compose.js';
import type { CheckInBuilderOptions } from '../checkin.js';
import type { ToolProvider } from '../../tools/toolProvider.js';
import type { Watcher } from './watch.js';
import type { SelfExplainOptions } from '../../trace-toolpack/selfExplain.js';
import { Agent } from '../Agent.js';
import { type SkillGraphDeclaredMap } from './skillGraphDeclared.js';
import type { AgentOptions, RunConfigFn } from './types.js';
import { type TimeOptions } from '../../time/clock.js';
import type { CompactionOptions } from './window/types.js';
import type { WindowStrategy } from './window/strategy.js';
import type { LLMProvider } from '../../provider-contract/types.js';
import type { MessageMiddleware, ToolMiddleware } from './middleware/types.js';
import { admitAroundTurn } from './aroundTurn/guards.js';
import type { AroundTurn } from './aroundTurn/types.js';
import { type ActOptions } from './act.js';
import type { ResolvedScriptTravel, ScriptTravelOptions } from './scripts/types.js';
import { type RecipeSource } from '../../recipes/provenance.js';
import type { AgentRecipe, AppliedRecipe, RecipeOptions } from '../../recipes/types.js';

/**
 * Fluent builder. `tool()` accepts any Tool<TArgs, TResult> and registers
 * it by its schema.name. Duplicate names throw at build time.
 */
export class AgentBuilder {
  private readonly opts: AgentOptions;
  private systemPromptValue = '';
  /** Whether `.system()` has been called. Separate from the VALUE, because
   *  `.system('')` is a legitimate call (an agent with no instructions) and
   *  `''` is also the default — only a flag can tell the two apart, and the
   *  refusal has to fire on the second call regardless of what was passed. */
  private systemPromptSet = false;
  /**
   * Cache policy for the base system prompt. Set via the optional
   * 2nd argument to `.system(text, { cache })`. Default `'always'` —
   * the base prompt is stable per-turn and an ideal cache anchor.
   */
  private systemPromptCachePolicy: CachePolicy = 'always';
  private systemPromptCacheExplicit = false;
  /**
   * Global cache kill switch. Set via `Agent.create({ caching: 'off' })`
   * (handled in `AgentOptions` propagation). Defaults to `false`
   * (caching enabled). When `true`, the CacheGate decider routes to
   * `'no-markers'` every iteration regardless of other rules.
   */
  private cachingDisabledValue = false;
  /**
   * Optional explicit CacheStrategy override. Default: undefined, which
   * means the agent chooses from the provider's declared `promptCaching`
   * (`cacheStrategyFor`) at construction. Power users override here for
   * custom backends or test mocks.
   */
  private cacheStrategyOverride?: CacheStrategy;
  private readonly registry: ToolRegistryEntry[] = [];
  private readonly injectionList: Injection[] = [];
  /** Captured from `.skillGraph(graph)` — the cursor resolver the Injection
   *  Engine uses to `from`-gate route triggers. Undefined unless a graph with
   *  route edges was mounted. */
  private skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined;
  /** Captured from `.skillGraph(graph)` — the reachable-set resolver the
   *  read_skill gate uses to reject out-of-set skill jumps. Undefined → the gate
   *  is off (plain read_skill agents are unaffected). */
  private skillGraphReachable?: (currentSkillId?: string) => readonly string[];
  /** Captured from `.skillGraph(graph)` — the relevance entry scorer
   *  (`graph.scoreEntries`), present only with `.entryByRelevance()`. When set, the
   *  PickEntry stage picks the starting skill by relevance once per turn. */
  private skillGraphScoreEntries?: (
    ctx: InjectionContext,
    signal?: AbortSignal,
  ) => Promise<EntryScoring>;
  /** Captured from `.skillGraph(graph)` — the `to` end of every declared edge, i.e.
   *  which skills the graph WIRES. Read only by the read_skill gate's open-skill
   *  rule (8.4.0). */
  private skillGraphEdgeTargets?: readonly string[];
  /** Captured from `.skillGraph(graph)` — the cursor resolver that also reports the
   *  clause that won (`graph.explainNextSkill`, 8.5.0). Optional: a graph built
   *  before it existed still routes, it just cannot narrate the hop. */
  private skillGraphExplainNextSkill?: (ctx: InjectionContext) => CursorMove;
  /** Captured from `.skillGraph(graph)` — the suppression reporter
   *  (`graph.supersededEntries`, 8.15.0). Optional: a graph built before it existed
   *  routes identically, it just cannot name the entries the cursor kept off the
   *  wire. */
  private skillGraphSupersededEntries?: (ctx: InjectionContext) => readonly string[];
  /** Is the mounted graph a decision `tree()`? DERIVED from `graph.nodes` — a tree
   *  is the only shape that draws `predicate` diamonds — so no new field had to be
   *  added to the public `SkillGraph`. Feeds the gate's tree-specific refusal. */
  private skillGraphIsTree = false;
  /** Captured from `.skillGraph(graph, options)` (SG-C) — the graph's
   *  turn-routing plan plus the mount's posture/continuity and the node-id
   *  set droppedResume checks against. Undefined for every graph without the
   *  new options → the Agent wires nothing new. */
  private skillGraphCascade?: {
    readonly turnRouting?: TurnRoutingPlan;
    readonly strictness: 'assist' | 'guard' | 'rails';
    readonly continuity: 'turn' | 'conversation';
    readonly nodeIds: ReadonlySet<string>;
  };
  /** Captured from `.skillGraph(graph)` — the graph's note that it DEFERRED its
   *  body-contract checks (built without `knownTools`, it could not tell a typo
   *  from a baseline tool this agent registers), plus the compiled skills to run
   *  them over. `build()` runs them exactly once, against the full tool registry.
   *  This capture is the FALLBACK for a structurally-typed graph whose skills do
   *  not carry the per-skill note: the primary collection reads
   *  `SKILL_GRAPH_DEFERRED_CONTRACT_KEY` off each injection's metadata, which is
   *  how a graph fed through `.skills({ list: () => graph.skills })` — a door
   *  that never sees the graph object — still gets its deferred checks run.
   *  Skills found by both are deduped by id: nothing re-runs, nothing
   *  double-reports. Undefined when the graph already ran them (`knownTools`
   *  given), switched them off (`check: 'off'`), or predates the note. */
  private skillGraphDeferredBodyContract?: {
    readonly mode: 'throw' | 'warn';
    readonly skills: readonly Injection[];
  };
  /** Captured from `.skillGraph(graph, options)` (9.19.0) — the three brain
   *  fields, verbatim; folded + validated at `build()` where the FINAL
   *  injection list (the other declaration home) exists. */
  private skillGraphBrainOptions?: Pick<SkillGraphOptions, 'providers' | 'escalation' | 'decider'>;
  /** Captured from `.skillGraph(graph)` (9.19.0) — the graph's node-id set,
   *  captured UNCONDITIONALLY (unlike the cascade's copy, which only exists
   *  when cascade options were asked for): the brains check-up needs it on
   *  a bare mount too. Undefined when the graph object carries no `nodes`. */
  private skillGraphNodeIds?: ReadonlySet<string>;
  /** Captured from `.skillGraph(graph)` (9.50.0) — the DECLARED map (nodes +
   *  edges, verbatim), projected once at mount so every run can file it as
   *  `agentfootprint.skill.graph_declared`. Undefined when the graph cannot
   *  state one (a structurally-typed graph without `nodes`) — the event then
   *  never fires, and the recording honestly carries no declared map. */
  private skillGraphDeclared?: SkillGraphDeclaredMap;
  /** `.maps()` (9.58.0) — the mount kernel's options; the plan itself is
   *  resolved at build(), where the final injection list and the mounted
   *  graph both exist. Absent = no kernel, zero delta. */
  private mapsOptions?: MapsOptions;
  /** `.claims()` (9.61.0) — the declared claim contract; resolved at build(). */
  private claimsContract?: Readonly<Record<string, { entity: string; field: string }>>;
  private readonly memoryList: MemoryDefinition[] = [];
  /**
   * Optional terminal contract — see `outputSchema()`. Stored on the
   * builder, propagated to the Agent at `.build()` time.
   */
  private outputSchemaParser?: OutputSchemaParser<unknown>;
  private answerValidationConfig?: ResolvedAnswerValidation;
  private negativeClaimsConfig?: ResolvedNegativeClaims;
  /** Corrective re-asks the loop may spend. `0` (the default) means the
   *  schema is judged once, at the caller's boundary, exactly as it always
   *  was — and no enforcement is mounted in the chart at all. */
  /** The evidence gate (9.35.0) — set by `.namesAndNumbersFromEvidence()`,
   *  resolved at the call site so a bad posture throws where it was typed.
   *  Undefined for every agent that did not ask for it, which is what makes
   *  the feature byte-identical when unused. */
  private evidenceGate?: ResolvedEvidenceGate;
  /** The tool posture (9.36.0) — set by `.toolsFromActiveSkill()`. False for
   *  every agent that did not ask for it, and the stamp it gates is the ONLY
   *  thing it does, which is what makes the feature byte-identical when
   *  unused. */
  private toolsFromActiveSkillValue = false;
  /** `.limitsTravelWithTheAnswer()` (this release). False for every agent
   *  that did not ask for it, and the ONE thing it gates is which stage
   *  function the final branch mounts — which is what makes the feature
   *  byte-identical when unused. The recording half is unconditional. */
  private limitsTravelValue = false;
  /** `.scriptTravelsWithTheAnswer()` — resolved at the call site; undefined
   *  for every agent that did not ask, which keeps it byte-identical. */
  private scriptTravelValue?: ResolvedScriptTravel;
  /** `.inputsLayer()` (honesty layer 2). False for every agent that did not
   *  ask for it; a REGISTERED ruled tool arms the layer on its own, so this
   *  is for ruled tools a ToolProvider serves — and for declared sources
   *  without the findings ledger (`inputsLayerSourcesValue`). */
  private inputsLayerValue = false;
  /** `.inputsLayer({ argumentSources: true })` (honesty layer 2): declared
   *  sources without the findings ledger. False unless asked for. */
  private inputsLayerSourcesValue = false;
  /** `.resultsLayer()` (honesty layer 3, step 7b). False for every agent that
   *  did not ask for it; a REGISTERED tool with a `ToolPeriod` arms the layer
   *  on its own, so this is for provider-served tools and for tools that
   *  declare a period only on their results. */
  private resultsLayerValue = false;
  /** `.answerLayer()` (honesty layer 4). Undefined for every agent that did
   *  not ask for it — the chart, the rows, the events and the answer are then
   *  byte-identical; `standingLine` is the prose line's own opt-in. */
  private answerLayerValue?: { readonly standingLine?: StandingLineWhen };
  /** `.time()` (the time layer). Undefined for every agent that did not ask —
   *  then no clock is read, no time row is filed and `time` on a run is refused. */
  private timeValue?: TimeOptions;

  private outputSchemaRetries = 0;
  private outputSchemaStrategy: OutputSchemaStrategy = 'auto';
  private outputSchemaJson?: Readonly<Record<string, unknown>>;

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
   * Observers collected via `.watch()`. Attached to the built Agent before `build()` returns
   * (each via `agent.attach(rec)`), in call order.
   */
  private readonly recorderList: Watcher[] = [];
  // Voice config — defaults until the consumer calls .appName() /
  // .commentaryTemplates() / .thinkingTemplates(). Stored as plain
  // dicts (Record<string, string>) so the builder doesn't depend on
  // the template-engine modules at compile time; the runtime types
  // come from the agentfootprint barrel exports.
  private appNameValue = 'Chatbot';
  private commentaryOverrides: Readonly<Record<string, string>> = {};
  private thinkingOverrides: Readonly<Record<string, string>> = {};
  /**
   * Optional rules-based reliability config (v2.11.5+). Set via
   * `.reliability({...})`. Wraps every `CallLLM` execution in a
   * retry/fallback/fail-fast loop driven by `preCheck` and `postDecide`
   * rules. See `ReliabilityConfig` for the rule shape.
   */
  private reliabilityConfig?: ReliabilityConfig;

  /**
   * Optional ThinkingHandler (v2.14+). Three states:
   *   - undefined (default): the provider's declared handler
   *     (`LLMProvider.thinkingHandler`)
   *   - explicit handler: override it
   *   - explicit `null`: opt out (no thinking handler mounted at all)
   *
   * The framework wraps the configured handler in a real footprintjs
   * sub-subflow at chart build time (see `buildThinkingSubflow`).
   * Mounted as a stage AFTER CallLLM inside `sf-call-llm`. Build-time
   * conditional — no stage when no handler resolves.
   */
  private thinkingHandlerValue?: ThinkingHandler | null;
  /**
   * v2.14+ — request-side thinking activation. When set, every LLM
   * call carries `LLMRequest.thinking = { budget }`, asking the
   * provider (Anthropic) to emit reasoning blocks. Independent from
   * `.thinkingHandler()` (response-side normalization choice).
   */
  private thinkingBudgetValue?: number;
  private selfExplainConfig?: SelfExplainOptions;
  private checkInConfig?: CheckInBuilderOptions;
  /** Per-run config resolver set via `.configure()`. Undefined = the agent
   *  runs on its build-time model + system prompt, unchanged. */
  private runConfigFn?: RunConfigFn;
  /** The agent's one window strategy, from `.window()` or `.compaction()`.
   *  Undefined = no window stage exists, the ReAct loop target is unchanged,
   *  and the run is byte-identical to an agent that never heard of them. */
  private windowStrategyValue?: WindowStrategy;
  /** WHICH door set it (8.18.0). Recorded so every "already set" refusal can
   *  name the call the caller has to go and look at, in every direction. */
  private windowStrategyDoor?: '.window()' | '.compaction()' | '.act({ window })';
  /** The tool-dispatch chain, in call order. Empty = no chain, no ledger. */
  private toolMiddlewareList: readonly ToolMiddleware[] = [];
  /** The message chain, in call order. Empty = no chain, no ledger. */
  private messageMiddlewareList: readonly MessageMiddleware[] = [];
  private aroundTurnPort: AroundTurn | undefined;
  /** `.act()` is the posture block: one per agent. See the method. */
  private actCalled = false;
  /** The recipes applied, in DECLARATION ORDER — the order `.recipe()` was
   *  called, which is the order their builder calls ran. Reported verbatim on
   *  the run manifest. Empty for every agent that never called `.recipe()`,
   *  and an empty list puts NO field on the manifest. */
  private readonly appliedRecipeList: AppliedRecipe[] = [];
  /** The recipe application stack while a `configure` is running — OUTERMOST
   *  first, because a recipe may apply another recipe and the innermost one is
   *  the code that literally called `.tool()`. Empty means a direct call. */
  private readonly recipeStack: AppliedRecipe[] = [];
  /** Which source registered each tool NAME, and each injection ID. Two maps
   *  keyed by the raw name, never one map keyed by a composed string: joining a
   *  kind and a name is the separator-donation collision this repo has fixed
   *  seven times, and there is nothing to gain by risking it here. Consulted
   *  only when a duplicate is detected, so an agent with no recipes pays two
   *  `Map.set` calls and nothing else. */
  private readonly toolSources = new Map<string, RecipeSource>();
  private readonly injectionSources = new Map<string, RecipeSource>();
  /** The findings ledger's options (9.101.0), set by `.findings()` — the ONE
   *  door — and undefined on every agent that never called it. Composed into
   *  the options `build()` hands `Agent` as `AgentOptions.findings`. */
  private findingsValue?: NonNullable<AgentOptions['findings']>;
  /** Tool choice by classifier (9.105.0), set by `.toolChoice()` — the ONE
   *  door — and undefined on every agent that never called it. Composed into
   *  the options `build()` hands `Agent` as `AgentOptions.toolChoice`. */
  private toolChoiceValue?: NonNullable<AgentOptions['toolChoice']>;
  /** The declared ontology (9.106.0), set by `.ontology()` — the ONE door —
   *  and undefined on every agent that never called it. Composed into the
   *  options `build()` hands `Agent` as `AgentOptions.ontology`. */
  private ontologyValue?: NonNullable<AgentOptions['ontology']>;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    // Cache layer: opts.caching === 'off' propagates to scope's
    // `cachingDisabled` kill switch read by CacheGate. opts.cacheStrategy
    // overrides the registry-resolved default.
    if (opts.caching === 'off') this.cachingDisabledValue = true;
    if (opts.cacheStrategy !== undefined) this.cacheStrategyOverride = opts.cacheStrategy;
    // `findings` given as an option goes through the one door (9.101.0), so
    // the instruction piece rides with the arm however it was spelled — an
    // armed agent with no ask would decorate schemas the model was never told
    // about. A later `.findings()` call is then the second call, and refused.
    if (opts.findings !== undefined) this.findings(opts.findings);
    // Same door for `toolChoice` (9.105.0): the option form is validated by
    // the one method, so a misconfigured classifier fails here, not per call.
    if (opts.toolChoice !== undefined) this.toolChoice(opts.toolChoice);
    // Same door for `ontology` (9.106.0): the option form registers the
    // always-on ask through the one method, so a map the model was never
    // told how to read cannot be mounted.
    if (opts.ontology !== undefined) {
      this.ontology(
        opts.ontology,
        opts.ontologyAsk === undefined ? undefined : { ask: opts.ontologyAsk },
      );
    } else if (opts.ontologyAsk !== undefined) {
      throw new Error(
        'Agent.create: `ontologyAsk` without `ontology` — the ask is what the model is told to do ' +
          'with a declared map, so it needs the map. Pass `ontology` (defineOntology) beside it.',
      );
    }
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
    return setSystem(
      livePort<PromptPort>({
        systemPromptSet: {
          get: () => this.systemPromptSet,
          set: (value) => {
            this.systemPromptSet = value;
          },
        },
        systemPromptValue: {
          get: () => this.systemPromptValue,
          set: (value) => {
            this.systemPromptValue = value;
          },
        },
        systemPromptCachePolicy: {
          get: () => this.systemPromptCachePolicy,
          set: (value) => {
            this.systemPromptCachePolicy = value;
          },
        },
        systemPromptCacheExplicit: {
          get: () => this.systemPromptCacheExplicit,
          set: (value) => {
            this.systemPromptCacheExplicit = value;
          },
        },
      }),
      prompt,
      options,
      this,
    ) as this;
  }

  tool<TArgs, TResult>(tool: Tool<TArgs, TResult>): this {
    return registerTool(
      livePort<ToolRegistrationPort>({
        registry: { get: () => this.registry },
        duplicateRefusal: {
          get: () => {
            const method = this.duplicateRefusal;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        toolSources: { get: () => this.toolSources },
        currentSource: {
          get: () => {
            const method = this.currentSource;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
      }),
      tool,
      this,
    ) as this;
  }

  /**
   * Who is registering right now: the app itself, or the recipe whose
   * `configure` is on the stack. A fresh object per call so a later push onto
   * the stack cannot rewrite what an earlier registration recorded.
   */
  private currentSource(): RecipeSource {
    return currentRecipeSource(
      livePort<RecipeSourcePort>({ recipeStack: { get: () => this.recipeStack } }),
    );
  }

  /**
   * The sentence a duplicate registration gets.
   *
   * Two sources both being LOCAL keeps the message it has always had, to the
   * byte: an app whose tests read that string should not have them break
   * because a feature it does not use shipped. As soon as either side is a
   * recipe the message names both — which is the whole point, since "I never
   * registered a `search` tool" is true and unhelpful when a composition did.
   */
  private duplicateRefusal(
    what: 'tool name' | 'injection id',
    name: string,
    sources: ReadonlyMap<string, RecipeSource>,
    callSite: string,
  ): string {
    return duplicateRegistration(
      livePort<DuplicateRegistrationPort>({
        currentSource: {
          get: () => {
            const method = this.currentSource;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
      }),
      what,
      name,
      sources,
      callSite,
    );
  }

  /**
   * Apply a **recipe** — a named, versioned composition over the builder
   * methods below (9.48.0).
   *
   * Every capability an agent needs already ships; what did not was a declared,
   * versioned, inspectable unit of CONFIGURATION. So an agent's setup lived as
   * prose in an example, was copy-pasted into an app, drifted there, and
   * afterwards nothing on the run could say which composition produced the
   * agent that answered. A recipe is that missing noun, and each applied one
   * puts an `{ id, version }` row on the run manifest.
   *
   * `configure` runs SYNCHRONOUSLY and immediately — at the position in the
   * chain where you wrote `.recipe()`, so declaration order is application
   * order and a later call still wins the way it always has. There is no
   * deferred phase, nothing to close and nothing registered anywhere: see
   * {@link AgentRecipe} for why that limit is deliberate.
   *
   * **Conflicts.** A tool name or injection id a recipe introduces that is
   * already taken refuses right here, naming BOTH sources — which recipe, or
   * the app itself. `'error'` is the only policy (`{ conflict }`); anything
   * else is refused by name rather than approximated.
   *
   * @example  an app composing two published recipes
   * ```ts
   * import { defineAgentRecipe } from 'agentfootprint/recipes';
   *
   * const agent = Agent.create({ provider, model })
   *   .recipe(supportDesk)   // system prompt + order lookup
   *   .recipe(housePolicy)   // the steering every agent here carries
   *   .tool(escalate)        // and one tool this app adds itself
   *   .build();
   * ```
   */
  recipe(recipe: AgentRecipe, options?: RecipeOptions): this {
    return applyRecipe(
      livePort<RecipePort>({
        recipeStack: { get: () => this.recipeStack },
        appliedRecipeList: { get: () => this.appliedRecipeList },
      }),
      recipe,
      options,
      () => recipe.configure(this),
      this,
    ) as this;
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
   * Wire a chainable `ToolProvider` (from `agentfootprint/providers`)
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
   *   import { gatedTools, staticTools } from 'agentfootprint/providers';
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
    return setToolProvider(
      livePort<ToolProviderPort>({
        toolProviderRef: {
          get: () => this.toolProviderRef,
          set: (value) => {
            this.toolProviderRef = value;
          },
        },
      }),
      provider,
      this,
    ) as this;
  }

  /**
   * Decide this run's model and/or system prompt when the run starts.
   *
   * An agent is built once and run many times, but not every run wants the
   * same model or the same instructions: a long message may deserve the
   * bigger model, a tenant may have its own house rules, a canary may want
   * last week's prompt. Rebuilding the whole agent per request works and is
   * wasteful; reaching in and mutating one is worse, because the trace then
   * describes an agent that no longer exists.
   *
   * The resolver runs ONCE per `run()`, at the start of the run, and what it
   * returns is **committed to the trace** — `resolvedModel` and
   * `resolvedInstructions` land in the run's commit log before the first LLM
   * call, and the LLM call reads them from there. So the recording says which
   * model actually answered instead of which model the agent was built with.
   *
   * Return `{}` (or nothing) to keep the defaults; `ctx.defaults` carries
   * them, so a resolver can decide relative to what was built rather than
   * restating it. Omit `.configure()` entirely and every run behaves — and
   * records — exactly as it did before.
   *
   * This is the RUN axis only. Tools are the iteration axis and already have
   * an owner: `.toolProvider()`, consulted every iteration.
   *
   * Throws if called more than once (same rule as `.toolProvider()` — a
   * silently-overridden resolver is a config that lies).
   *
   * @example  Bigger model for a bigger question
   *   const agent = Agent.create({ provider, model: 'small-model' })
   *     .system('You answer support questions.')
   *     .configure(({ message, defaults }) =>
   *       message.length > 500 ? { model: 'big-model' } : {},
   *     )
   *     .build();
   *
   * @example  Per-tenant house rules
   *   const agent = Agent.create({ provider, model })
   *     .system('You answer support questions.')
   *     .configure(({ identity, defaults }) => ({
   *       instructions: `${defaults.instructions}\n\n${rulesFor(identity?.tenant)}`,
   *     }))
   *     .build();
   */
  configure(fn: RunConfigFn): this {
    return setRunConfiguration(
      livePort<RunConfigurationPort>({
        runConfigFn: {
          get: () => this.runConfigFn,
          set: (value) => {
            this.runConfigFn = value;
          },
        },
      }),
      fn,
      this,
    ) as this;
  }

  /**
   * Everything this agent DOES about its own loop, in one block.
   *
   * Tools do the work. `.act()` decides about the work. `watch` remembers
   * both — and nothing can act without being watched.
   *
   * Five keys, one per moment of a turn, each optional and each the exact
   * argument the individual door takes:
   *
   * ```ts
   * const agent = Agent.create({ provider, model })
   *   .act({
   *     input:      [scrubSSNs],        // the message, before the run commits it
   *     beforeTool: [refundCeiling],    // every call, before it is dispatched
   *     afterTool:  [hideRawPII],       // every result, before the model reads it
   *     window:     slidingWindow({ keepRecentTurns: 12 }),
   *     output:     [noInternalCodenames],
   *   })
   *   .build();
   * ```
   *
   * **It is sugar, and provably so.** Each key is forwarded to the door that
   * already owned it — `.messageMiddleware()`, `.toolMiddleware()`,
   * `.window()` — so the agent it builds sends the same request bytes and
   * files the same records as the same rules spelled out one call at a time.
   * That equivalence is pinned per key by tests, the way `.compaction()`'s is.
   *
   * **The keys cannot fall behind the loop.** They are locked at compile time
   * against `LoopMoment`, so a sixth moment cannot ship without a key here.
   *
   * **A rule speaks where its hooks say, not where you filed it.** `beforeTool`
   * and `afterTool` are one chain; an entry with both `onToolCall` and
   * `onToolResult` runs at both moments whichever key you wrote it under —
   * the KEYS are named for the moments, the HOOKS for what they receive — and
   * an entry named
   * under both keys is the same object attached once. A governance rule that
   * silently did not run because it was written in the wrong bucket is exactly
   * the failure this library exists to make impossible — so the bucket is
   * checked for the hook it names, and the hooks decide the rest.
   *
   * **Call it once.** A second `.act()` throws: two posture blocks means the
   * answer to "what does this agent do at each moment?" is in two places, and
   * the second one silently wins. Adding one piece to an agent somebody else
   * built — a plugin, a policy pack — is what the individual doors are for,
   * and they stay open for exactly that.
   *
   * @param options - One key per moment. `input` / `output` take message
   *   middleware, `beforeTool` / `afterTool` take tool middleware, `window`
   *   takes a `WindowStrategy`. Unknown keys throw.
   */
  act(options: ActOptions): this {
    return configureAct(
      livePort<ActPort>({
        actCalled: {
          get: () => this.actCalled,
          set: (value) => {
            this.actCalled = value;
          },
        },
        assertNoWindowStrategy: {
          get: () => {
            const method = this.assertNoWindowStrategy;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        noteWindowStrategyDoor: {
          get: () => {
            const method = this.noteWindowStrategyDoor;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        window: {
          get: () => {
            const method = this.window;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        messageMiddleware: {
          get: () => {
            const method = this.messageMiddleware;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        toolMiddleware: {
          get: () => {
            const method = this.toolMiddleware;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
      }),
      options,
      this,
    ) as this;
  }

  /**
   * Choose how the live context window is kept inside its budget.
   *
   * This is the general door; the strategy decides everything about WHEN it
   * acts and WHAT leaves. Three ship, and they share one turn segmentation
   * and one refusal engine, so a refusal reason means the same thing under
   * all of them:
   *
   *   `summarizeOldest({ thresholdTokens, summarizer, ... })`
   *      fold the oldest span into one summary message. `.compaction()` is
   *      this, spelled shorter.
   *   `slidingWindow({ keepRecentTurns })`
   *      keep the last N turns and drop older ones. No summarizer, no LLM
   *      call, no usage requirement — it runs on any provider.
   *   `tokenBudget({ thresholdTokens })`
   *      the counted-token trigger, dropping instead of summarizing.
   *
   * Never removed by any of them: the system envelope, the recent turns, and
   * any turn holding something unresolved — an unanswered tool call, a paused
   * tool, a pending check-in. Those refuse BY NAME in the record and the
   * strategy takes the next oldest instead. Removing an unanswered question
   * would destroy the referent of the answer that has not arrived yet, and
   * splitting a `tool_use` from its `tool_result` produces a request the
   * vendor rejects.
   *
   * **Whatever leaves the window stays in the ledger.** footprintjs's commit
   * log is append-only, so the turns were committed before the strategy ran
   * and remain byte-identical; every strategy files its own recorded step
   * naming the `runtimeStageId`s whose messages left, and emits one
   * `context.evicted` per message. Removing is not forgetting.
   *
   * Exactly one strategy per agent. Omit this (and `.compaction()`) and
   * nothing changes: no stage, no extra committed key, the same request bytes.
   *
   * @example
   * ```ts
   * import { Agent, slidingWindow } from 'agentfootprint';
   *
   * const agent = Agent.create({ provider, model })
   *   .window(slidingWindow({ keepRecentTurns: 12 }))
   *   .build();
   * ```
   */
  window(strategy: WindowStrategy): this {
    return setWindowStrategy(
      livePort<WindowConfigurationPort>({
        assertNoWindowStrategy: {
          get: () => {
            const method = this.assertNoWindowStrategy;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        assertSummarizerIsNotTheAgentItself: {
          get: () => {
            const method = this.assertSummarizerIsNotTheAgentItself;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        windowStrategyValue: {
          get: () => this.windowStrategyValue,
          set: (value) => {
            this.windowStrategyValue = value;
          },
        },
        noteWindowStrategyDoor: {
          get: () => {
            const method = this.noteWindowStrategyDoor;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        windowStrategyDoor: {
          get: () => this.windowStrategyDoor,
          set: (value) => {
            this.windowStrategyDoor = value;
          },
        },
      }),
      strategy,
      this,
    ) as this;
  }

  /**
   * Refuse a strategy that would bill the agent's OWN provider instance for
   * the agent's OWN model (8.14.0).
   *
   * Not about money — `model` is required now, so nothing is billed quietly.
   * It is about two calls that are configured identically and provably behave
   * differently: the agent's call goes through `reliability`, any provider
   * decorator and the cache subflow; the summarizer's call goes through none
   * of them (see `runSummarizer`). Same object, same model, two behaviours,
   * and nobody typed the difference.
   *
   * Deliberately narrow. A different INSTANCE of the same vendor with the same
   * model is allowed — "use the strong model to write the summary, because a
   * bad summary poisons every turn after it" is a real choice — and a second
   * instance also ends the shared per-instance state (cursors, rate-limit
   * buckets, keep-alive pools) that made this pairing bite in the first place.
   *
   * Checked at every door that can set one. `.compaction({...})` and
   * `.window(summarizeOldest({...}))` are the same policy, and since 9.14.0
   * `.memory(defineMemory({ strategy: { kind: 'summarize', llm, model } }))`
   * is a third — a memory that folds recall makes the same un-decorated call
   * against the same pairing. A rule that only some doors enforce is advice.
   */
  private assertSummarizerIsNotTheAgentItself(
    billing: { readonly provider: LLMProvider; readonly model: string } | undefined,
    label: string,
  ): void {
    assertDistinctSummarizer(
      livePort<SummarizerIdentityPort>({ opts: { get: () => this.opts } }),
      billing,
      label,
    );
  }

  /**
   * Keep the live context window inside a token budget — without ever losing
   * the record.
   *
   * Sugar for `.window(summarizeOldest(options))`, and byte-for-byte the same
   * agent. It keeps its own name because compaction is what the market calls
   * this and it is the strategy most people want first.
   *
   * At each ReAct iteration boundary, compaction compares the LAST call's
   * **adapter-reported** input tokens against `thresholdTokens`. Over budget,
   * it folds the oldest foldable span of the conversation into one summary
   * message and sends that instead. Counted, never guessed: a provider that
   * reports no usage gets a named refusal
   * (`CompactionUnmeasurableError`) rather than an invented number.
   *
   * **The fold edits the window, not the record.** The turns it folds stay in
   * the run's commit log byte-identical — footprintjs's log is append-only,
   * so a fold cannot erase them even in principle. The summary enters as its
   * own recorded step naming every `runtimeStageId` it folded, plus what was
   * measured and what refused to fold. A compacted run is still a provable
   * run: the lens draws a fold seam, not a hole.
   *
   * Never folded: the system envelope, the last `keepRecentTurns` turns, and
   * any turn holding something unresolved — an unanswered tool call, a paused
   * tool, a pending check-in. Folding an unanswered question would destroy
   * the referent of the answer that has not arrived yet, so those refuse by
   * name and the fold takes the next oldest instead.
   *
   * Omit `.compaction()` and nothing changes: no stage, no extra keys, the
   * same request bytes as before.
   *
   * @example
   * ```ts
   * const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
   *   .compaction({
   *     thresholdTokens: 120_000,
   *     summarizer: anthropic(),
   *     model: 'claude-haiku-4-5',   // the cheap one writes the summary
   *   })
   *   .build();
   * ```
   */
  compaction(options: CompactionOptions): this {
    return setCompaction(
      livePort<WindowConfigurationPort>({
        assertNoWindowStrategy: {
          get: () => {
            const method = this.assertNoWindowStrategy;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        assertSummarizerIsNotTheAgentItself: {
          get: () => {
            const method = this.assertSummarizerIsNotTheAgentItself;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        windowStrategyValue: {
          get: () => this.windowStrategyValue,
          set: (value) => {
            this.windowStrategyValue = value;
          },
        },
        noteWindowStrategyDoor: {
          get: () => {
            const method = this.noteWindowStrategyDoor;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
      }),
      options,
      this,
    ) as this;
  }

  /**
   * One window strategy per agent, whichever door set it — a second would
   * silently override the first, and a window policy that quietly changed is
   * a policy you cannot audit.
   *
   * **Every refusal names the door that set it (8.18.0).** The three doors are
   * one setting, so a caller who hits this is holding two lines of code and
   * needs to know which one already won. Before, the direction decided how much
   * you were told: `.window()` named the strategy and then talked about
   * `.compaction()` — even when `.act({ window })` was what had set it — while
   * `.act()` said "set by .window() or .compaction()", an `or` that was
   * sometimes neither. `windowStrategyDoor` records the fact once, at the
   * moment it becomes true, and all three sentences read it.
   */
  private assertNoWindowStrategy(door: 'window' | 'compaction' | 'act'): void {
    assertWindowNotSet(
      livePort<Readonly<WindowConflictPort>>({
        windowStrategyValue: {
          get: () => this.windowStrategyValue,
        },
        windowStrategyDoor: {
          get: () => this.windowStrategyDoor,
        },
      }),
      door,
    );
  }

  /** Record which door set the window strategy, for the refusal above. */
  private noteWindowStrategyDoor(door: '.window()' | '.compaction()' | '.act({ window })'): void {
    this.windowStrategyDoor = door;
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
    return setMaxIterations(
      livePort<IterationLimitPort>({
        maxIterationsOverride: {
          get: () => this.maxIterationsOverride,
          set: (value) => {
            this.maxIterationsOverride = value;
          },
        },
      }),
      n,
      this,
    ) as this;
  }

  /**
   * Watch this agent. `.act()` says what the agent may do; `.watch()` says
   * who is looking while it does it.
   *
   * Every observer handed here is attached before `build()` returns, so it
   * sees every event from the very first run — there is no window where the
   * agent has run and nobody was watching.
   *
   * Variadic, because observers come in sets:
   *
   * ```ts
   * const agent = Agent.create({ provider, model })
   *   .watch(toolChoiceRecorder(), routeRecorder())
   *   .act({ beforeTool: [budgetGuard] })
   *   .build();
   * ```
   *
   * Build time, not run time. This returns the builder; `agent.attach(o)`
   * attaches to a live agent and returns an `Unsubscribe` you own. Same
   * mechanism underneath — `.watch()` replays through `agent.attach()` at
   * the end of `build()` — so mixing the two is fine and order is preserved.
   *
   * Called more than once, the sets concatenate in call order. Nothing is
   * de-duplicated here; footprintjs's executor dedupes by recorder id at run
   * time, so the same observer handed in twice still fires once.
   */
  watch(...observers: readonly Watcher[]): this {
    for (const observer of observers) this.recorderList.push(observer);
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
   * weather…'`). See `defaultStatusTemplates` for the full key list.
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
   *
   * An Injection carrying `inject.messages` is ROUTED here, not refused
   * (7.19.1 refused it; 7.21.0 delivers it). What still gets refused is the
   * pair the wire cannot take: a `role: 'tool'` message has no tool call to
   * answer, so it is rejected here, at the declaration, on every provider.
   * A role the ATTACHED provider cannot carry is a different question — it
   * depends on the provider, which this builder does not have — so it is
   * refused at run start instead, by name. This is the one funnel every
   * flavor passes through, so a hand-built Injection cannot go around the
   * checks the named factories make.
   */
  injection(injection: Injection): this {
    return registerInjection(
      livePort<InjectionPort>({
        injectionList: { get: () => this.injectionList },
        duplicateRefusal: {
          get: () => {
            const method = this.duplicateRefusal;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        injectionSources: { get: () => this.injectionSources },
        currentSource: {
          get: () => {
            const method = this.currentSource;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
      }),
      injection,
      this,
    ) as this;
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
   * Mount a declarative **skill graph** (proposal 002) — each skill carries a
   * graph-derived trigger (entry → always/rule, deterministic route → rule /
   * on-tool-return), so dynamic token-efficient loading becomes *declared* and
   * *drawable*. Pure sugar over `.injection()` — `graph.toMermaid()` renders the
   * topology.
   *
   * The optional second argument (SG-C, 9.17.0) sets the MOUNT's routing
   * posture and cursor span — see {@link SkillGraphOptions}. Omitted, the
   * agent behaves byte-for-byte as it always has.
   *
   * @example
   *   const graph = skillGraph()
   *     .entry(triage)
   *     .route(triage, sfp, { when: (r) => r.toolName === 'get_counters' && JSON.parse(r.result).crc > 0 })
   *     .build();
   *   Agent.create({ provider }).skillGraph(graph).build();
   *
   * @example
   *   // The conversation keeps its place across turns, and the model may
   *   // route only when the router declared ambiguity:
   *   Agent.create({ provider })
   *     .skillGraph(graph, { continuity: 'conversation', strictness: 'guard' })
   *     .build();
   */
  skillGraph(
    graph: {
      skills: readonly Injection[];
      nextSkill: (ctx: InjectionContext) => string | undefined;
      reachableSkills?: (currentSkillId?: string) => readonly string[];
      scoreEntries?: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>;
      /** The declared edges. Read for ONE thing: which skills the graph wires, so the
       *  read_skill gate can tell a skill the graph routes from one it never mentions
       *  (see `openSkillIds` in `build()`). Optional for forward-compat with graphs
       *  built before `edges` existed; absent → the graph wires nothing. */
      edges?: ReadonlyArray<{
        readonly to: string;
        /** The declared source (`null` = the synthetic START) — read since
         *  9.50.0 for the `skill.graph_declared` record. Optional for
         *  forward-compat; an edge that omits it is routed exactly as before
         *  but stays OFF the declared-map event (never completed by a guess). */
        readonly from?: string | null;
        /** The declared `SkillEdgeKind` — same 9.50.0 record, same posture. */
        readonly kind?: string;
        /** The author's caption — same 9.50.0 record, same posture. */
        readonly label?: string;
        /** The edge's declared DATA guard (9.51.0) — read for the
         *  `skill.graph_declared` record only, carried verbatim when it has
         *  the compiled shape and skipped otherwise (never completed). */
        readonly guard?: { readonly conditions?: unknown };
      }>;
      /** The same cursor resolver, reporting the clause that won (8.5.0). Optional for
       *  forward-compat; absent → no `cursorMove` on `context.evaluated`. */
      explainNextSkill?: (ctx: InjectionContext) => CursorMove;
      /** The entries the cursor law superseded this iteration (8.15.0). Optional for
       *  forward-compat; absent → no `supersededIds` on `context.evaluated`. */
      supersededEntries?: (ctx: InjectionContext) => readonly string[];
      /** The drawn nodes. Read for TWO things: a `predicate` node means this graph is
       *  a decision `tree()` (the gate's refusal says so out loud), and the node-id
       *  set is what a continuity cursor is validated against (`droppedResume`).
       *  Derived here rather than added to `SkillGraph` as a mode field — the shape
       *  is already public, and one fact should not be declared twice. */
      nodes?: ReadonlyArray<{
        readonly kind: string;
        readonly id?: string;
        /** The drawn caption (predicate diamonds) — read since 9.50.0 for the
         *  `skill.graph_declared` record only. */
        readonly label?: string;
      }>;
      /** The graph's turn-routing plan (SG-C) — tier-1 rules, intent candidates,
       *  the classifier and the resolved tie policy. Optional for forward-compat
       *  with graphs built before it existed; absent → the cascade cannot run
       *  (classify needs it; continuity degrades to nothing rather than guess). */
      turnRouting?: TurnRoutingPlan;
      /** How the graph picks a turn's starting entry (SG-C). Read for one
       *  refusal: `strictness: 'rails'` cannot honor `'model-read'`. */
      entrySelection?: 'scorer' | 'model-read' | 'classify';
      /** The graph's note that it deferred its body-contract checks to agent build
       *  (built without `knownTools` — see `SkillGraph.deferredBodyContract`).
       *  Optional for forward-compat; absent → the checks already ran at graph build
       *  (or were off), so this agent never re-runs them. Library-built graphs also
       *  stamp the note on each compiled skill's metadata, which `build()` prefers —
       *  this field is the fallback for a structurally-typed graph without the
       *  per-skill stamps (skills found by both are deduped by id). */
      deferredBodyContract?: { readonly mode: 'throw' | 'warn' };
    },
    options?: SkillGraphOptions,
  ): this {
    return mountSkillGraph(
      livePort<GraphMountPort>({
        opts: { get: () => this.opts },
        skillGraphNextSkill: {
          get: () => this.skillGraphNextSkill,
          set: (value) => {
            this.skillGraphNextSkill = value;
          },
        },
        injection: {
          get: () => {
            const method = this.injection;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        skillGraphReachable: {
          get: () => this.skillGraphReachable,
          set: (value) => {
            this.skillGraphReachable = value;
          },
        },
        skillGraphScoreEntries: {
          get: () => this.skillGraphScoreEntries,
          set: (value) => {
            this.skillGraphScoreEntries = value;
          },
        },
        skillGraphEdgeTargets: {
          get: () => this.skillGraphEdgeTargets,
          set: (value) => {
            this.skillGraphEdgeTargets = value;
          },
        },
        skillGraphExplainNextSkill: {
          get: () => this.skillGraphExplainNextSkill,
          set: (value) => {
            this.skillGraphExplainNextSkill = value;
          },
        },
        skillGraphSupersededEntries: {
          get: () => this.skillGraphSupersededEntries,
          set: (value) => {
            this.skillGraphSupersededEntries = value;
          },
        },
        skillGraphIsTree: {
          get: () => this.skillGraphIsTree,
          set: (value) => {
            this.skillGraphIsTree = value;
          },
        },
        skillGraphNodeIds: {
          get: () => this.skillGraphNodeIds,
          set: (value) => {
            this.skillGraphNodeIds = value;
          },
        },
        skillGraphDeclared: {
          get: () => this.skillGraphDeclared,
          set: (value) => {
            this.skillGraphDeclared = value;
          },
        },
        skillGraphBrainOptions: {
          get: () => this.skillGraphBrainOptions,
          set: (value) => {
            this.skillGraphBrainOptions = value;
          },
        },
        skillGraphCascade: {
          get: () => this.skillGraphCascade,
          set: (value) => {
            this.skillGraphCascade = value;
          },
        },
        skillGraphDeferredBodyContract: {
          get: () => this.skillGraphDeferredBodyContract,
          set: (value) => {
            this.skillGraphDeferredBodyContract = value;
          },
        },
      }),
      graph,
      options,
      this,
    ) as this;
  }

  /**
   * Mount the maps kernel (9.58.0) — the layer that owns ENGAGEMENT, the
   * axis orthogonal to every map's own cursor.
   *
   * A mounted map (today: the skill map; the screen map is the next tenant)
   * keeps sole ownership of its position. What the kernel owns is whether
   * that map's contributions — prompt fragment and tools — ride the next
   * call. An engagement founded on a GUESS (an entry regex, a classifier)
   * is renewed only by concrete evidence: the map's own tool called, a
   * declared route fired, the model asking by name. Without corroboration
   * for `renewalGrace` consecutive passes the map is PARKED — its cursor
   * stays exactly where the map put it, its contribution stops riding, and
   * explicit or structural evidence re-engages it (an accepted `read_skill`
   * pick is the recovery door). Every standing change is a typed event:
   * `agentfootprint.map.engaged` / `agentfootprint.map.parked`.
   *
   * Why: in a recorded 30-call turn, an entry regex matched the word "zone"
   * inside "find the most recent zone redundancy run" — a noun the person
   * wanted to FIND, not a task. The turn stood on an audit skill for all 30
   * calls; its 4 tools were never called; ~7k characters of the wrong map
   * rode every call of a 359k-token turn. Under the kernel that map parks
   * on call four.
   *
   * Requires a mounted skill map — refused at build() otherwise. Zero-delta
   * when absent: no scope key, no events, byte-identical evaluation.
   *
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .skillGraph(myMap)
   *     .maps({ renewalGrace: 3 })
   *     .build();
   */
  maps(options: MapsOptions = {}): this {
    return configureMaps(
      livePort<MapsPort>({
        mapsOptions: {
          get: () => this.mapsOptions,
          set: (value) => {
            this.mapsOptions = value;
          },
        },
      }),
      options,
      this,
    ) as this;
  }

  /**
   * WHICH ANSWER FIELDS ARE CLAIMS ABOUT WHICH FACTS (9.61.0) — the claim
   * seam's contract.
   *
   * The evidence gate (`.evidence()`) grounds the answer's names and
   * numbers: every value must appear in a tool result. Its own limit is
   * stated in its docs — it cannot catch a false claim assembled from real
   * values ("fc1/3 is healthy" when the data says the port is down uses
   * entirely grounded tokens). This closes that hole for the facts you
   * name: the run's semantic envelopes settle typed readings, and each
   * declared field of the validated answer is compared against the one it
   * claims to report.
   *
   * DECLARED, NEVER INFERRED — the `argumentsFrom` precedent. The library
   * does not guess that an answer field named `nav_count` is about
   * `nav(screen2)`; you say so, and the checker joins. Nothing is blocked:
   * a disagreement files one `agentfootprint.integrity.context_error` at
   * seam `'claim'`, and the answer is returned exactly as it was — unless an
   * enforcing `.answerValidation({ agentChecks: ['claims'] })` lists the
   * check, which then withholds a contradicted answer.
   *
   * Requires `.outputSchema()` — without a validated answer object there is
   * no typed stratum to read, and prose is never checked. Refused at
   * `build()` rather than skipped, because a contract that silently checks
   * nothing is worse than no contract.
   *
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .tool(screenTool)                       // returns describedResult({ facts: [...], provenance })
   *     .outputSchema(AnswerSchema)
   *     .claims({ nav_count: { entity: 'screen2', field: 'nav' } })
   *     .build();
   */
  claims(contract: Readonly<Record<string, { entity: string; field: string }>>): this {
    return configureClaims(
      livePort<ClaimsPort>({
        claimsContract: {
          get: () => this.claimsContract,
          set: (value) => {
            this.claimsContract = value;
          },
        },
      }),
      contract,
      this,
    ) as this;
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
    return registerMemory(
      livePort<MemoryPort>({
        memoryList: { get: () => this.memoryList },
        assertSummarizerIsNotTheAgentItself: {
          get: () => {
            const method = this.assertSummarizerIsNotTheAgentItself;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
      }),
      definition,
      this,
    ) as this;
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
   * ## What the DEFAULT buys you, and what it does not
   *
   * `.outputSchema(parser)` on its own means **judge, do not re-ask**: the
   * prompt gets the instruction, native structured output is used when the
   * effective provider/model and available JSON Schema support it, and the
   * answer is validated locally in the loop. Unsupported native schemas or
   * providers fall back to instruction plus validation. A
   * failure is recorded (`outputAttempts`), announced
   * (`agentfootprint.agent.output_contract_unmet`), warned about once, and
   * readable afterwards through `agent.outputContractUnmet()`. What it does
   * NOT do is spend a turn fixing the answer — pass `{ retries: 1 }` for the
   * first real correction. Before 8.18.0 the default judged nothing at all
   * inside the run, and a `run()` caller could not tell a contract had been
   * missed.
   *
   * ## The two ways a run with a contract can END
   *
   * `runTyped()` throws **`OutputSchemaError`** when the answer fails the
   * schema — and **`MessageDeniedError`** when an `act({ output })` rule
   * refused to release the answer at all. The second one is not a schema
   * failure and is never re-asked: the answer was withheld on purpose, and
   * asking the model for a better-shaped version of a string nobody is allowed
   * to see would route around the rule. A `catch` block that only knows about
   * `OutputSchemaError` will miss it.
   *
   * `run()` throws neither for a schema failure: it returns the raw answer, as
   * it always has, and says so through the channels above.
   *
   * @param parser  Validation strategy that throws on shape failure.
   * @param opts    Optional `{ name, instruction, retries, strategy, jsonSchema }`.
   *
   * @example
   *   import { z } from 'zod';
   *   const Output = z.object({
   *     status: z.enum(['ok', 'err']),
   *     items: z.array(z.string()),
   *   }).describe('A status enum + an array of strings.');
   *
   *   const agent = Agent.create({...})
   *     .outputSchema(Output, { retries: 1 })
   *     .build();
   *
   *   const typed = await agent.runTyped({ message: '...' });
   *   typed.status; // narrowed to 'ok' | 'err'
   */
  /**
   * Require every **name and number in the final answer** to appear in a tool
   * result the run actually read (9.35.0). If one does not, the model typed it
   * rather than read it.
   *
   * ## What it is — and what it provably is not
   *
   * It is a **fabrication detector, not a correctness judge.** It catches
   * invented values. It CANNOT catch a false claim assembled from real values:
   * *"fc1/3 is healthy"* when the data says the port is down uses entirely
   * grounded tokens, and this check passes it without a murmur. Anyone who
   * reads it as a hallucination check will trust it for the one thing it
   * cannot do. It is also conservative by design (small numbers, all-letters
   * names and units are not examined), because a false accusation costs a real
   * turn and can refuse a good answer.
   *
   * The check is **deterministic** — set membership over normalized tokens. No
   * second model, no embedding, no judge. A guard that needed a bigger model
   * to police a smaller one would invert this library's whole thesis and would
   * fail exactly where the small model is deployed.
   *
   * ## The three postures
   *
   * Same three words as `.skillGraph({ strictness })`, deliberately — and a
   * SEPARATE setting, because routing authority and evidence discipline are
   * different decisions:
   *
   *   • `'assist'` (**default**) — record and flag. The answer goes out
   *     unchanged; you learn how often it happens before you act on it.
   *   • `'guard'` — the unsupported values are named back to the model, which
   *     gets ONE more ordinary turn (tools still on the wire, so it can go and
   *     fetch what it guessed — except under an ENFORCING `.answerValidation()`,
   *     where that turn and every later call of the run are served no tools,
   *     so a tool that writes or sends never runs twice before the answer is
   *     withheld). Survivors ship flagged. **This is the recommended posture
   *     for a weaker model.**
   *   • `'rails'` — the same one revision, then `run()` raises
   *     `UnsupportedValuesError` rather than return an answer that still
   *     carries them.
   *
   * Values the USER supplied — this turn's message, the conversation, the
   * system prompt and skill bodies — are exempt without being declared: the
   * user gave them, so they were not invented.
   *
   * Every judgement lands on the emit channel as
   * `agentfootprint.agent.evidence_checked`, whatever the posture, so a
   * debugger can show the answer, the values and whether the revision fixed
   * them. The terminal verdict is readable after the run with
   * `agent.unsupportedValues()`.
   *
   * `nudge: true` adds the staged-refs nudge — the recency half of grounded
   * numbers. When an iteration's context holds tool results staged by
   * reference (`artifacts.placement` tickets) and a served tool declares
   * `wants` over one of their kinds, ONE late line is appended to that
   * request naming the refs and the spender: derived numbers come from the
   * tool, not from mental arithmetic. Composed from declarations only,
   * request-only (never history), recorded as
   * `agentfootprint.agent.grounding_nudged`. Off by default.
   *
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .tool(showInterface)
   *     .namesAndNumbersFromEvidence({
   *       posture: 'guard',
   *       // The default extractor guesses from digits and punctuation; teach
   *       // it your domain's shapes and they are checked by name.
   *       shapes: [{ name: 'wwn', match: /(?:[0-9a-f]{2}:){7}[0-9a-f]{2}/ }],
   *       exempt: ['v9.35.0'],
   *       // Name staged dataset refs + the compute tool late in the context,
   *       // where recency works FOR the instruction.
   *       nudge: true,
   *     })
   *     .build();
   */
  namesAndNumbersFromEvidence(opts?: NamesAndNumbersOptions): this {
    return configureEvidence(
      livePort<EvidencePort>({
        evidenceGate: {
          get: () => this.evidenceGate,
          set: (value) => {
            this.evidenceGate = value;
          },
        },
      }),
      opts,
      this,
    ) as this;
  }

  /**
   * Make the limits of an answer travel WITH the answer (this release).
   *
   * A tool that returns `coverage(verdict, { checked, notChecked,
   * cannotCover })` — or `absent({ what, checked, … })` — declares the ground
   * its result stands on. With this on, the run's declarations are folded into
   * one block and appended to the final answer, so a reader learns whether
   * *"everything looks fine"* means **verified** or **unexamined**. (A typed
   * answer gets the same limits as data instead — see below.)
   *
   * ## Why appended, and not asked for
   *
   * A limit the model is asked to carry is a limit the model can drop, and
   * dropping it is invisible: an answer with no caveat and an answer whose
   * caveat was omitted read identically. The block is therefore composed by
   * the framework from what the tools declared and concatenated onto the
   * answer — the model does not write it, so the model cannot drop it. The
   * price is that it changes the bytes of the answer, which is why it is off
   * by default.
   *
   * **What it is not.** It does not judge whether the model stated the limits
   * in its own prose, and it does not refuse an answer that did not. Both
   * would need a second model to decide what counts as "stated", which is the
   * one thing this library will not put in a guard (see
   * `.namesAndNumbersFromEvidence()` and `core/agent/evidence/README.md`).
   *
   * Off → byte-identical: nothing is appended and the final branch mounts the
   * stage function it has always mounted. The RECORDING half runs either way
   * (`agentfootprint.tools.coverage_declared` / `.absent`, and
   * `coverageDeclared` in the snapshot), so you can measure how often your
   * tools declare limits before you decide to ship them.
   *
   * ## With an output schema, the limits come back as data
   *
   * A typed answer (`.outputSchema()`) is JSON, and JSON with a block of prose
   * after it is not JSON — so nothing is appended to it. The answer stays
   * exactly what the model sent, `runTyped()` parses it, and the same limits
   * the block would have listed come back beside it:
   * `agent.answerCoverage()` (`{ checked, notChecked, cannotCover }`),
   * `turn_end.answerCoverage`, and `answerCoverage` in the snapshot.
   *
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .tool(replicationHealth)   // returns coverage(verdict, { … })
   *     .limitsTravelWithTheAnswer()
   *     .build();
   *
   * @example A typed answer — the limits as data
   * ```ts
   * const typed = Agent.create({ provider, model })
   *   .tool(replicationHealth)
   *   .outputSchema(Verdict)
   *   .limitsTravelWithTheAnswer()
   *   .build();
   * const verdict = await typed.runTyped({ message: 'is replication healthy?' });
   * const limits = typed.answerCoverage(); // undefined when no tool declared any
   * ```
   */
  limitsTravelWithTheAnswer(): this {
    return configureAnswerLimits(
      livePort<AnswerLimitsPort>({
        limitsTravelValue: {
          get: () => this.limitsTravelValue,
          set: (value) => {
            this.limitsTravelValue = value;
          },
        },
      }),
      this,
    ) as this;
  }

  /**
   * Make the script a code-running call SUBMITTED travel with the answer,
   * attached by the library from the run record and labelled from the
   * execution record — so "always show the script" holds without the model's
   * cooperation, and the model never retypes a program that would then need
   * checking.
   *
   * A tool is code-running because it DECLARES so (`Tool.script`;
   * `codeRunnerTool` declares `{ argument: 'code', language }`). Each call of
   * one files a `script` row: the program handed to the tool (after any
   * before-tool middleware) and what its runner reported. With this on:
   *
   * - `turn_end.scripts` carries the attached scripts as data on every answer
   *   — a host with its own renderer reads it and never parses the text;
   * - a PROSE answer also carries them as text after its `---` separator, one
   *   block per script: a label line ("Script submitted to run_code on call c1
   *   — completed, exit 0. Attached by the library from the run record:"),
   *   then the program in the library's own fence, byte for byte. A typed
   *   answer (`.outputSchema()`) gets the data only.
   *
   * The label says only what the record proves: `completed, exit 0` needs an
   * explicit exit code; a bare runner verdict reads "runner reported success;
   * no exit code"; a timeout, a cancellation or a service error with no exit
   * code reads "outcome unknown"; a tool that returned without runner facts
   * reads "tool call returned; execution not confirmed". A result withheld
   * over the tool's ceiling does not undo a completed execution — both are
   * said. A program over `maxBytes` (default 4,000 UTF-8 bytes) is cut at a
   * code-point boundary and says it is incomplete.
   *
   * `which: 'last'` (default) attaches the last call of the turn that reached
   * the tool; `'all'` every such call, at most 8, the rest counted on
   * `turn_end.scripts.omitted`. The attached text is part of the answer the
   * app chose to show: `run()` returns it and memory keeps it.
   *
   * Refused at build when no registered tool declares `script` (and no
   * `ToolProvider` could serve one): an arm that could never attach anything
   * is a misconfiguration, not a no-op.
   *
   * @example
   * ```ts
   * const agent = Agent.create({ provider, model })
   *   .tool(codeRunnerTool({ runner: localCodeRunner() }))
   *   .namesAndNumbersFromEvidence({ posture: 'guard', code: 'match' })
   *   .scriptTravelsWithTheAnswer({ which: 'last', maxBytes: 4000 })
   *   .build();
   * ```
   */
  scriptTravelsWithTheAnswer(opts?: ScriptTravelOptions): this {
    return configureScriptTravel(
      livePort<ScriptTravelPort>({
        scriptTravelValue: {
          get: () => this.scriptTravelValue,
          set: (value) => {
            this.scriptTravelValue = value;
          },
        },
      }),
      opts,
      this,
    ) as this;
  }

  /**
   * Mount the INPUTS LAYER (honesty layer 2) for ruled tools the build cannot
   * see — tools a `ToolProvider` serves.
   *
   * A tool that declares `askOrAssume` (`defineTool({ …, askOrAssume: { window:
   * { assume: '2h' } } })`) arms the layer by itself when it is REGISTERED on
   * the agent (`.tool()`, a skill's tools, an MCP tool registered here): the
   * library fills a value the call leaves out, files it on the findings ledger
   * as `default`, tells the model in a note on the result, and the answer's
   * standing says the value was assumed. A ToolProvider's list is only known
   * per iteration, so the build cannot see its ruled tools — and a ruled tool
   * met on an agent without the layer is REFUSED rather than run unruled,
   * because configured-and-inert looks exactly like configured-and-working.
   * This one line mounts the layer so those tools' rules apply.
   *
   * `argumentSources: true` arms DECLARED SOURCES without the findings
   * ledger: each ruled tool's served schema carries the reserved `_findings`
   * argument with `from` alone — where each argument value came from (the
   * person's words as a `quote`, a result's `id`, an earlier answer, the app,
   * or `'assumed'`) — and the layer CHECKS each claim before the batch runs;
   * under an `ask` rule a value the checks do not trace is asked of the
   * person. The same checks and rows as `.findings({ argumentSources: true })`,
   * without the ledger's `_findings` schema on every tool (about 2,500
   * characters each) — `.findings()` beside it serves both, exactly as that
   * door does.
   *
   * Off → the chart is byte-identical (nothing mounted, decorated, read or
   * written).
   *
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .toolProvider(fleetTools)   // lists a tool that declares askOrAssume
   *     .inputsLayer()
   *     .build();
   *
   * @example
   *   // The model says where each ruled value came from; the library checks it.
   *   const agent = Agent.create({ provider, model })
   *     .tool(searchLogs)           // declares askOrAssume: { window: { ask, choices } }
   *     .inputsLayer({ argumentSources: true })
   *     .build();
   */
  inputsLayer(options?: { readonly argumentSources?: boolean }): this {
    return configureInputsLayer(
      livePort<InputsLayerPort>({
        inputsLayerValue: {
          get: () => this.inputsLayerValue,
          set: (value) => {
            this.inputsLayerValue = value;
          },
        },
        inputsLayerSourcesValue: {
          get: () => this.inputsLayerSourcesValue,
          set: (value) => {
            this.inputsLayerSourcesValue = value;
          },
        },
      }),
      options,
      this,
    ) as this;
  }

  /**
   * Mount the RESULTS LAYER (honesty layer 3) for periods the build cannot
   * see coming — a `ToolPeriod` on a tool a `ToolProvider` serves, or a
   * `period` a tool declares only on its results.
   *
   * A result says what time its read covered: `absent({ …, period })`,
   * `coverage(value, { …, period })` or `describedResult({ …, period })` —
   * the instants it `queried`, and what the store `held` (or `'unknown'`, said
   * out loud). The layer runs at the loop head, reads the batch just run, and
   * files ONE verdict per call on the findings ledger (`kind: 'period'`):
   * `covered`, `partly-held`, `not-held`, `unknown` — or `undeclared`, when
   * the tool declares a `ToolPeriod` and the result said nothing about what its
   * read covered. The answer's standing (`agent.assessment()`) reads "not
   * sure" for every verdict but `covered`. It serves the model nothing: the
   * period is already in the result the model read.
   *
   * A REGISTERED tool that declares a `ToolPeriod` (`defineTool({ …, period:
   * { argument: 'window' } })`) arms the layer by itself. Without the layer, a
   * declared period is still recorded (`coverageDeclared`, the events, the
   * `Period:` line under `.limitsTravelWithTheAnswer()`) — but no verdict is
   * filed, and one dev warning per tool says so.
   *
   * Off → the chart is byte-identical (nothing mounted, read or written).
   *
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .tool(backupRuns)   // returns absent({ …, period }) / describedResult({ …, period })
   *     .resultsLayer()
   *     .build();
   *   await agent.run({ message: 'Any failed backups in the last hour?' });
   *   (await agent.assessment())?.reasons; // [{ reason: 'period-not-held', layer: 3, … }]
   */
  resultsLayer(): this {
    return configureResultsLayer(
      livePort<ResultsLayerPort>({
        resultsLayerValue: {
          get: () => this.resultsLayerValue,
          set: (value) => {
            this.resultsLayerValue = value;
          },
        },
      }),
      this,
    ) as this;
  }

  /**
   * Mount the ANSWER LAYER (honesty layer 4): every answer gets its standing,
   * folded from the run's committed record — never from how sure the model
   * sounded — and served as data.
   *
   * The standing is one of five words: `known` (a supporting row: a passed
   * `.answerValidation()` report for these exact bytes), `consistent` with the
   * run's record (checks ran and none fired — never "verified"), `not-sure`
   * (a reason fired: an assumed argument, an empty result that did not say
   * what it searched, a declared gap, an unsupported value, a limit that cut
   * the turn short, …), `ask`, or `not-assessed` (nothing on the record could
   * be checked). It is the same fold as `agent.assessment()` and
   * `assessAnswer(recording)`, run once inside the run at the head of the
   * final branch, so the in-run standing equals the one a later reader folds.
   *
   * Armed, three things happen and no others:
   *
   * - `turn_end.answerAssessment` and one `agentfootprint.answer.assessed`
   *   event carry the value, its rendering, the reason kinds and the checks
   *   that ran — never a value from the answer or a quote;
   * - the Route decider files two witness rows on the findings ledger, so the
   *   fold can read them: the evidence gate's clean pass (`grounded` — the
   *   names-and-numbers check RAN; it never supports "known") and an answer
   *   given before a skill's declared steps finished (`steps-unfinished`);
   * - every row the findings ledger gets carries its conversation `turn`.
   *
   * It is a LABEL: it never asks, never refuses and never changes the model's
   * reply. The one exception is opt-in — `{ standingLine: true }` appends ONE
   * line to a prose answer (`Not sure — window = "2h" was assumed by
   * search_logs's rule, not given by you.`), after the limits separator.
   * Refused beside `.answerValidation()` (which judges the exact bytes
   * delivered) and beside `.outputSchema()` (a typed answer is JSON, and JSON
   * followed by prose is not) — through this door and `AgentOptions.answerLayer`
   * alike; the standing still travels as data there. The line, like the
   * limits block, is appended to the answer the run returns — never streamed
   * on `stream.token`.
   *
   * `{ standingLine: { when } }` says the line only when it matters:
   * `'always'` (what `true` means), `'unless-consistent'` (not for
   * "consistent with the run's record"), or `'not-sure-or-ask'` (only "not
   * sure" and "ask" — not "consistent", "not assessed" or "known"). `ask` is
   * said in every mode. The mode decides the LINE only: the standing travels
   * as data in every mode (`turn_end.answerAssessment`, the event), the limits
   * block (`.limitsTravelWithTheAnswer()`) is appended whether or not the line
   * is, and memory keeps exactly the answer that was delivered. **No line is
   * never a check:** under `'not-sure-or-ask'` it means no reason fired, which
   * includes "nothing could be checked" — and an app that hides both the line
   * and the data leaves the person unable to tell "checked" from "not
   * assessed".
   *
   * @example Say it only when it matters
   *   Agent.create({ provider, model })
   *     .tool(searchLogs)
   *     .answerLayer({ standingLine: { when: 'not-sure-or-ask' } })
   *     .build();
   *
   * The in-run fold reads no app declarations: `agent.assessment(declarations)`
   * and the answer account take `rowsAt`, and can say more than the run did.
   *
   * Off → the chart, the committed rows, the events and the answer are
   * byte-identical.
   *
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .tool(searchLogs)
   *     .answerLayer()                       // the standing as data
   *     .build();
   *   agent.on('agentfootprint.answer.assessed', (e) => console.log(e.payload.standing));
   *
   * @example One line to the person, too
   *   Agent.create({ provider, model }).tool(searchLogs).answerLayer({ standingLine: true }).build();
   */
  answerLayer(options?: {
    readonly standingLine?:
      | boolean
      | { readonly when: 'always' | 'unless-consistent' | 'not-sure-or-ask' };
  }): this {
    return configureAnswerLayer(
      livePort<AnswerLayerPort>({
        answerLayerValue: {
          get: () => this.answerLayerValue,
          set: (value) => {
            this.answerLayerValue = value;
          },
        },
      }),
      options,
      this,
    ) as this;
  }

  /**
   * Arm the TIME LAYER's clock: every run declares when "now" is and which
   * zone the person is in, and the run records it.
   *
   * - **The zone is per run.** `run({ message, time: { zone } })` names the
   *   person's zone; `zone` here is an optional FALLBACK for a run that names
   *   none. With neither, the zone is UNKNOWN — the server's zone is never
   *   used and none is guessed: instants are spelled in UTC and said to be,
   *   the person is asked their zone before any time they wrote is read, and
   *   the zone they answer holds for the next turns. A zone is an IANA name
   *   (`'America/Los_Angeles'`, `'UTC'`); an abbreviation (`PST`) or a bare
   *   offset names no zone and is refused.
   * - **`now` is the app's** (`time: { now }` — the message's time), else the
   *   turn's start, recorded as a default (`nowSource: 'default'`).
   * - **The model is told the date.** Every request ends with the library's
   *   one time line, opening with the turn's clock ("This turn's time: Friday
   *   2026-10-09 08:40 America/Los_Angeles (UTC-07:00).").
   * - **Recorded once per turn.** Seed files one `clock` row on the ledger
   *   (`agent.findings()`): `now`, `nowSource`, `zone`, `zoneSource`, and a
   *   window set in a UI (`time: { window }`, recorded `source: 'control'`).
   *   Each dispatched call files a `call` row with `dispatchedAt`.
   * - **Frozen across a pause.** `resume(checkpoint, answer, { time })` keeps
   *   the paused turn's clock; a `time` that differs is recorded as a
   *   `clock-on-resume` row, never applied.
   * - **The limits in the person's zone.** Under `.limitsTravelWithTheAnswer()`,
   *   every `Period:` line is rendered in the clock's zone with the zone named
   *   (`2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)`); the typed
   *   record keeps the instants as declared.
   * - **The person's words, read by YOUR reader** (`reader`, no default). A
   *   `TimeReader` returns zone-less parts (`'10/09/26'` → three numbers, the
   *   order undecided); the library resolves them against the clock into
   *   every candidate window and files one `time-reading` row per mention —
   *   once per turn, only on a message a person wrote, never re-read on a
   *   resume or a retry. `policy` picks among the candidates: `dateOrder`
   *   (`'ask'` default, or `'MDY'` / `'DMY'` / `'YMD'`) and `year` (`'ask'`
   *   default, or `'current'`); a pick is recorded as assumed. A
   *   `kind: 'model'` reader's window is never taken as the person's words:
   *   it waits for the person to confirm it.
   * - **The time ask checks the answer** (a `requestInput` field with a
   *   `format`: `'instant'`, `'time-range'` or `'zone'`). A resume whose answer
   *   has no offset, ends before it starts, names no zone, or — under
   *   `.time()`, which knows the person's zone — writes a wall time the clocks
   *   skip is not taken: the ask comes back with `refused: { answer, reason }`
   *   and `repeat: { count }`, and nothing runs. The reason is a catalog
   *   sentence (`defaultTimeAskMessages`); `messages` overrides any key.
   *
   * Off → nothing is filed, read or rendered differently, and `time` on a run
   * is refused (a door that ignored it would look configured and do nothing).
   *
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .tool(searchLogs)
   *     .time({ zone: 'America/Los_Angeles' }) // the fallback; each run's own zone wins
   *     .limitsTravelWithTheAnswer()
   *     .build();
   *   await agent.run({ message, time: { now: sentAt, zone: session.zone } });
   *
   *   // With a reader: the words are read once per turn, and recorded.
   *   Agent.create({ provider, model }).time({ reader: myReader, policy: { dateOrder: 'MDY' } });
   */
  time(options?: TimeOptions): this {
    return configureTime(
      livePort<TimePort>({
        timeValue: {
          get: () => this.timeValue,
          set: (value) => {
            this.timeValue = value;
          },
        },
      }),
      options,
      this,
    ) as this;
  }

  /**
   * Offer a skill's tools **only while that skill is active** (9.36.0). One
   * line, for every skill on the agent.
   *
   * ## What it fixes
   *
   * By default a skill's `tools` go into the agent's STATIC tool list at build
   * time, so the model can see and call them from iteration 1 — activated or
   * not. Narrowing that was a per-skill field (`defineSkill({ autoActivate:
   * 'currentSkill' })`) you had to remember on every skill; the one you forgot
   * kept its tools on the wire for the life of the agent, and nothing said so.
   * This says it once, for all of them.
   *
   * With it on, a skill's tools enter the request on the iterations where the
   * skill is active — through the same readmission path `autoActivate` has used
   * since v2.5 — and nowhere else. Everything else is untouched: `read_skill`,
   * `list_skills`, your `.tool()` registry, provider tools and every other
   * active skill's tools stay offered, because a scoped agent still has to
   * handle the input nobody imagined.
   *
   * ## Not a posture dial, and why
   *
   * `.skillGraph({ strictness })` and `.namesAndNumbersFromEvidence({ posture })`
   * take three values because there is a real middle there — record it, revise
   * it, refuse it. The wire has no middle: a tool's schema is either in the
   * request or it is not, and "record that we sent it" is just sending it. A
   * three-value dial here would ship one behaviour under two names.
   *
   * ## What it does NOT do
   *
   * It governs the OFFER, not dispatch. A tool stays resolvable by name so an
   * active skill's call lands — the split `autoActivate` has always had. If you
   * need execution itself gated (an inactive skill's tool refused even when the
   * model names it from a restored transcript), that is a `PermissionChecker`
   * or a `gatedTools` provider, and it is a different question: authority to
   * run, not what the model was shown.
   *
   * ## Interaction with the per-skill flag and with `scopeTools`
   *
   * All three stamp the same field, and none can contradict another:
   * `autoActivate` has one legal value, so a skill can ask to be scoped and can
   * never ask to be exempt. A skill that declared its own keeps it; the graph's
   * `scopeTools: true` fills in the skills it wires; this fills in the rest.
   * Turning it on can only remove tools from the static list, never add one.
   *
   * **Opt-in.** The default is unchanged — an agent that never calls this
   * keeps additive tool visibility. Version 10 retires old APIs without
   * changing this active routing policy.
   *
   * @example
   *   const skills = await skillsFromDir('./skills', { tools: [lookupOrder, issueRefund] });
   *   const agent = Agent.create({ provider, model })
   *     .skills({ list: () => skills })
   *     .toolsFromActiveSkill()   // billing's tools appear when billing does
   *     .build();
   */
  toolsFromActiveSkill(): this {
    return configureSkillToolScope(
      livePort<SkillToolScopePort>({
        toolsFromActiveSkillValue: {
          get: () => this.toolsFromActiveSkillValue,
          set: (value) => {
            this.toolsFromActiveSkillValue = value;
          },
        },
      }),
      this,
    ) as this;
  }

  outputSchema<T>(parser: OutputSchemaParser<T>, opts?: OutputSchemaOptions): this {
    return configureOutputSchema(
      livePort<OutputSchemaPort>({
        outputSchemaParser: {
          get: () => this.outputSchemaParser,
          set: (value) => {
            this.outputSchemaParser = value;
          },
        },
        outputSchemaRetries: {
          get: () => this.outputSchemaRetries,
          set: (value) => {
            this.outputSchemaRetries = value;
          },
        },
        outputSchemaStrategy: {
          get: () => this.outputSchemaStrategy,
          set: (value) => {
            this.outputSchemaStrategy = value;
          },
        },
        outputSchemaJson: {
          get: () => this.outputSchemaJson,
          set: (value) => {
            this.outputSchemaJson = value;
          },
        },
        injectionList: { get: () => this.injectionList },
        injectionSources: { get: () => this.injectionSources },
        currentSource: {
          get: () => {
            const method = this.currentSource;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
      }),
      parser,
      opts,
      this,
    ) as this;
  }

  /**
   * The findings ledger (9.101.0) — the model's OWN standings on its tool
   * results, on the record, at zero extra calls.
   *
   * WHY. A long tool-using run serves every result back in full on every
   * call, and what the model already stood on, left open, ruled out or found
   * to be noise is nowhere but in its head. With this door every served tool
   * schema carries a reserved optional `_findings` argument: the model
   * declares a `basis` for each call before the result exists ('direct' when
   * it expects the answer, 'exploratory' when it is looking) and, on its next
   * tool call or as a top-level `_findings.previous` on a JSON answer, the
   * STANDING of each previous result by its tool_result id — 'fact' with the
   * assertions it stands on, 'open' with what would settle it, 'ruled-out'
   * with one line, 'noise' with nothing. The library peels the argument off
   * before anything else reads the call (middleware, validation, execute and
   * every pause carrier see the call as if the key were never there), files
   * one flat append-only `findingsLedger` on the run's state through ONE
   * writer, and leaves history verbatim. Read it back with
   * {@link Agent.findings}. Nothing infers: a call with no declaration files
   * no row, and a result nobody named has no standing — never 'open'.
   *
   * WHAT THE ANSWER TURN IS SERVED. Once the model has declared a standing,
   * every later call is served a request-only system piece composed from the
   * folded ledger (`findings/serve.ts · findingsLedgerPiece` — facts,
   * limitations, evidenceRefs and nextSteps, each marked "declared by the
   * model"; results nobody named listed as undeclared, never open), and on
   * the wire only — `history` never changes — a result the model judged
   * `noise` or `ruled-out` is replaced by a ticket (`collapseJudged`).
   * `serve` chooses how much of the pile stays: `'ledger-and-facts'` (the
   * default) keeps fact, open and undeclared results verbatim beside the
   * piece; `'ledger-only'` collapses fact results too and is BENCH-GATED —
   * shipped so `bench/findings-shuffle.mjs` can measure it on a real model,
   * not a recommendation, never a default until that run shows the answer
   * does not drift under shuffled evidence. `answerAsk` (9.103.0) appends
   * the answer-turn ask (`findings/reserved.ts · FINDINGS_ANSWER_ASK`) to
   * that piece under `'quote-facts'` — BENCH-GATED the same way, against
   * the fidelity dip the real-model page's fourth run measured; `'none'`
   * (the default) writes no key and serves the piece exactly as before.
   * `keepLedgerFacts` is the ceiling
   * of fact turns the WINDOW holds under standing-aware eviction (9.102.0) —
   * the same dial as `AgentOptions.keepLedgerFacts` (that field says why and
   * what it costs), this door winning when both are given, resolved once by
   * `Agent` at build and threaded to the window stage on an armed agent with
   * a window strategy, where `stages/window.ts · buildWindowStage` spends it
   * as the `'ledger-fact'` pin ceiling; a negative or non-integer value is
   * refused here.
   *
   * `argumentSources: true` (honesty layer 2, declared sources) — on a tool
   * that declares argument rules (`askOrAssume`), the reserved argument also
   * carries `from`, first and required: the model says where each argument
   * value came from (the person's words as a `quote`, a result's `id`, an
   * earlier answer, the app, or `'assumed'`), and the inputs layer CHECKS each
   * claim before the batch runs and files the verdict on the call's argument
   * rows — under an `ask` rule, a value the checks do not trace is asked of the
   * person, and the rule's sentence names `_findings.from`. No instruction line
   * is added: `from` explains itself in its own property. It needs the inputs
   * layer (a registered ruled tool, or `.inputsLayer()`) and is refused at
   * build without it. The same arm WITHOUT this ledger:
   * `.inputsLayer({ argumentSources: true })`. Off (the default): nothing is
   * served, read or written.
   *
   * Once per agent (a second call is refused, the `.window()` grammar).
   * Registers the always-on `findings-ledger` instruction — the byte-for-byte
   * twin of {@link outputSchema}'s piece, hashed per piece on every receipt,
   * so a reworded ask is a different hash a bench can name. An agent that
   * never calls this is byte-identical to one built before the ledger
   * existed: no decoration, no peel, no key, no piece, no event.
   *
   * @example
   * ```ts
   * const agent = Agent.create({ provider, model })
   *   .tool(search)
   *   .findings()
   *   .build();
   * await agent.run({ message: 'which port is down?' });
   * const ledger = agent.findings() ?? [];
   * const facts = ledger.filter((r) => r.kind === 'standing' && r.standing === 'fact');
   * ```
   */
  findings(options?: NonNullable<AgentOptions['findings']>): this {
    return configureFindings(
      livePort<FindingsPort>({
        findingsValue: {
          get: () => this.findingsValue,
          set: (value) => {
            this.findingsValue = value;
          },
        },
        injectionList: { get: () => this.injectionList },
        injectionSources: { get: () => this.injectionSources },
        currentSource: {
          get: () => {
            const method = this.currentSource;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
      }),
      options,
      this,
    ) as this;
  }

  /**
   * Tool choice by classifier (9.105.0) — a SECOND READING of which tool
   * answers the current step, filed beside the model's own call, and
   * optionally a NARROWING of what is served.
   *
   * At every model call the tools slot asks `classifier` one `choice`
   * question over the tools it is about to serve — the merged wire minus the
   * always-served doors, each by its own description — and files a
   * `ToolChoiceRow` under `AgentState.toolChoices`: the provider's ranking
   * (its distribution as sent, an unscored tool absent), its pick, its
   * confidence, its cost, and the names actually served. After the reply
   * `callLLM` files a `ToolChoiceOutcomeRow`: the tools the model called,
   * whether the first is the pick (`firstAgrees`), and any `miss`. The
   * model's call is never overridden; a failed classifier call is a
   * `ToolChoiceErrorRow` and the full set is served (fail open).
   *
   * `serve: 'all'` (the default) is advisory: the wire is byte for byte what
   * it was. `serve: { top: N }` narrows the served list to the top-N plus the
   * doors (`read_skill`, `list_skills`, `skip_step`, `present`, and
   * `alwaysServe`), and serves the full wire with the reason on the row when
   * the classifier failed or scored fewer than N (`unavailable`), fewer than
   * N + 1 candidates were offered (`too-few`), the previous call missed
   * (`after-miss`) or the call is the wrap-up (`wrap-up`). A miss — the model
   * naming a narrowed-away tool — is recorded, answered by the dispatcher's
   * off-wire path as before, and the next call serves the full wire.
   *
   * Once per agent (a second call is refused, the `.findings()` grammar);
   * `reactMode: 'classic'` is refused at build. An agent that never calls
   * this is byte-identical to one built before the option existed: no
   * classifier call, no key, no event.
   *
   * @example
   * ```ts
   * import { mockClassifier } from 'agentfootprint/classify';
   *
   * const agent = Agent.create({ provider, model })
   *   .tool(lookup)
   *   .tool(charge)
   *   .toolChoice({ classifier: typesafe(), serve: { top: 2 } })
   *   .build();
   * await agent.run({ message: 'refund order 42' });
   * agent.getSnapshot()?.sharedState.toolChoices; // pick → served → called, per call
   * ```
   */
  toolChoice(options: NonNullable<AgentOptions['toolChoice']>): this {
    return configureToolChoice(
      livePort<ToolChoicePort>({
        toolChoiceValue: {
          get: () => this.toolChoiceValue,
          set: (value) => {
            this.toolChoiceValue = value;
          },
        },
      }),
      options,
      this,
    ) as this;
  }

  /**
   * The declared ontology (9.106.0) — a MAP of what exists and where, never
   * a way to fetch it.
   *
   * WHY. When a tool result does not hold what a question needs, the model
   * has nothing to say about where the need WOULD be met — it guesses a
   * source, or reports the absence as if nothing anywhere held the term. An
   * ontology lets the application declare, once, what each term IS (its
   * meaning and unit — the context contract's `domainDefinitions`), how
   * terms RELATE, which SOURCE holds a term with the author's own coverage
   * sentence, and which registered TOOL reads it from there. The model is
   * served that map as data on every call and asked to name the source, the
   * tool or the neighbouring node a need points at — as a proposal. The
   * library executes nothing through the map, fetches nothing, and never
   * decides that a node "has no data": a node with no declared source is
   * served as `known, not held here`, which is what the declaration says.
   *
   * WHAT IT DOES. Takes the frozen `Ontology` `defineOntology` returned
   * (`agentfootprint/ontology`); at `.build()` every tool name a node's `via`
   * names is checked against the agent's tool registry and a name no
   * registry carries is refused, naming the ontology and the tool. At run
   * `seed` writes the whole spec once as the run constant
   * `AgentState.ontology`, every model call is served ONE request-only
   * system piece composed from that key (`ontology/serve.ts ·
   * ontologyPiece`, joined after the recovery piece and before the findings
   * piece, hashed on the receipt, rebuilt byte-equal by `servedAt`) and
   * `agentfootprint.ontology.served` fires per call with identities and
   * counts only. Registers the always-on `ontology` instruction
   * (`ONTOLOGY_INSTRUCTION`, the `outputSchema()` twin: a system piece on
   * the receipt, never an injected turn).
   *
   * Once per agent (a second call is refused, the `.findings()` grammar). An
   * agent that never calls this is byte-identical to one built before the
   * map existed: no key, no piece, no instruction, no event.
   *
   * `options.ask` (9.107.0, the `answerAsk` grammar — a named value, never a
   * boolean): `'use-the-map'` (the default) registers the versioned
   * `ONTOLOGY_INSTRUCTION` — read the question in the map's terms, look where
   * a source and its tool are declared, walk a relation from a term held to
   * a term needed, and when a need is unmet name where it would be met,
   * never a value off a definition, never the map itself to the person.
   * `'none'` serves the map as data and registers no ask of the library's,
   * for an application that writes its own through `.instruction()` — the
   * map is served either way; only the ask changes, and the served view and
   * the receipt show which (the `ontology` injection present or absent).
   *
   * @example
   * ```ts
   * import { defineOntology } from 'agentfootprint/ontology';
   *
   * const map = defineOntology({
   *   id: 'fleet',
   *   version: '1',
   *   sources: { inventory: { meaning: 'the switch inventory export', configured: true } },
   *   nodes: {
   *     port: { meaning: 'a physical switch port', sources: [{ source: 'inventory', via: ['lookup_port'] }] },
   *     port_error_rate: { meaning: 'CRC errors per minute on a port', unit: 'errors/min' },
   *   },
   *   edges: [{ from: 'port_error_rate', to: 'port', relation: 'measured-on' }],
   * });
   * const agent = Agent.create({ provider, model }).tool(lookupPort).ontology(map).build();
   * ```
   */
  ontology(
    ontology: NonNullable<AgentOptions['ontology']>,
    options?: { readonly ask?: NonNullable<AgentOptions['ontologyAsk']> },
  ): this {
    return configureOntology(
      livePort<OntologyPort>({
        ontologyValue: {
          get: () => this.ontologyValue,
          set: (value) => {
            this.ontologyValue = value;
          },
        },
        injectionList: { get: () => this.injectionList },
        injectionSources: { get: () => this.injectionSources },
        currentSource: {
          get: () => {
            const method = this.currentSource;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
      }),
      ontology,
      options,
      this,
    ) as this;
  }

  /**
   * 3-tier degradation for output-schema validation failures. Pairs
   * with `.outputSchema()` — an agent that has one and not the other is
   * refused at `.build()`, in either call order.
   *
   * Three tiers:
   *
   *   1. **Primary** — LLM emitted schema-valid JSON. Caller gets it.
   *   2. **Fallback** — `OutputSchemaError` thrown. The async
   *      `fallback(error, raw)` runs; its return is re-validated.
   *   3. **Canned** — static safety-net value. NEVER throws when set.
   *
   * `canned` is validated against the schema at `.build()` — fail-fast on
   * misconfig (a `canned` that doesn't validate would defeat the fail-open
   * guarantee at the exact moment it is needed).
   *
   * ## The tiers run at the TYPED boundary — `run()` does not reach them
   *
   * `runTyped()` and `parseOutputAsync()` engage the chain. **`run()` does
   * not**, and cannot: these tiers produce a typed value `T`, and `run()`
   * resolves to the raw answer string — substituting a fallback there would
   * hand a caller a different answer than the model gave, invisibly. So an
   * agent consumed through `run()` (a server route, a queue worker,
   * `standingAgent`) gets NO fallback, and until 8.18.0 nothing said so. Now
   * the unmet-contract warning and
   * `agentfootprint.agent.output_contract_unmet` both carry
   * `fallbackConfigured: true` — the signal that a safety net exists and this
   * caller is not standing under it.
   *
   * Two typed events fire on tier transitions for observability:
   *   - `agentfootprint.resilience.output_fallback_triggered`
   *   - `agentfootprint.resilience.output_canned_used` — carries
   *     `retriesSpent`, and warns when the canned value lands after re-asks
   *     that were billed. With `canned` set, `runTyped()` is structurally
   *     unable to throw, so nothing else would report that spend.
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
    return configureOutputFallback(
      livePort<OutputFallbackPort>({
        outputFallbackCfg: {
          get: () => this.outputFallbackCfg,
          set: (value) => {
            this.outputFallbackCfg = value;
          },
        },
      }),
      options,
      this,
    ) as this;
  }

  /**
   * `.outputFallback()` needs `.outputSchema()`, and it needs it by the time
   * the agent exists — not by the time the call is written (8.18.0).
   *
   * The requirement is set MEMBERSHIP: a fallback is degradation for a
   * contract, so an agent with one and not the other is incoherent. Order is
   * not the requirement, and refusing on order made a builder whose lines
   * could not be reordered without reading an error message to find out —
   * `.outputFallback().outputSchema()` threw while `.outputSchema()
   * .outputFallback()` was fine, and both end with the same agent.
   *
   * The `canned` value is validated here for the same reason: validating it
   * needs the parser, so it belongs wherever the parser is guaranteed.
   */
  private assertOutputFallbackCoherent(): void {
    assertOutputFallbackCoherent(
      livePort<Readonly<OutputFallbackPort>>({
        outputFallbackCfg: {
          get: () => this.outputFallbackCfg,
        },
        outputSchemaParser: {
          get: () => this.outputSchemaParser,
        },
      }),
    );
  }

  /**
   * Wire rules-based reliability around every `CallLLM` execution.
   * The framework wraps the LLM call in a retry/fallback/fail-fast
   * loop driven by `preCheck` and `postDecide` rules.
   *
   * Decision verbs the rules can emit (see `ReliabilityDecision` for
   * the full list):
   *
   *   • `continue`    — pre-check OK, proceed to the call
   *   • `ok`          — post-call OK, commit and return
   *   • `retry`       — re-call same provider (bumps `attempt`)
   *   • `retry-other` — advance to next provider in `providers[]`
   *   • `fallback`    — invoke `config.fallback(req, lastError)`
   *   • `fail-fast`   — throw `ReliabilityFailFastError` at `agent.run()`
   *
   * **Streaming + reliability semantics — first-chunk arbitration:**
   * Pre-first-chunk failures (connection/headers/breaker-open) honor
   * the full rule set (retry, retry-other, fallback, fail-fast).
   * Post-first-chunk failures (mid-stream) honor only `ok` and
   * `fail-fast`; rules wanting `retry`/`retry-other`/`fallback` are
   * escalated to fail-fast with kind `'mid-stream-not-retryable'`.
   * This matches LangChain's `RunnableWithFallbacks` pattern and
   * the prevailing industry default — see the streaming + reliability
   * design memo for the full discussion.
   *
   * Throws if called more than once on the same builder.
   *
   * @example
   *   import { Agent } from 'agentfootprint';
   *   import { ReliabilityFailFastError } from 'agentfootprint/resilience';
   *
   *   const agent = Agent.create({ provider, model: 'mock' })
   *     .system('Triage support tickets.')
   *     .reliability({
   *       postDecide: [
   *         { when: (s) => s.errorKind === '5xx-transient' && s.attempt < 3,
   *           then: 'retry', kind: 'transient-retry' },
   *         { when: (s) => s.error !== undefined,
   *           then: 'fail-fast', kind: 'unrecoverable' },
   *       ],
   *       circuitBreaker: { failureThreshold: 3 },
   *     })
   *     .build();
   *
   *   try {
   *     await agent.run({ message: 'help' });
   *   } catch (e) {
   *     if (e instanceof ReliabilityFailFastError) {
   *       console.log(e.kind, e.reason);
   *     }
   *   }
   */
  reliability(config: ReliabilityConfig): this {
    if (this.reliabilityConfig) {
      throw new Error(
        'AgentBuilder.reliability: already set. Each agent has at most one reliability config.',
      );
    }
    this.reliabilityConfig = config;
    return this;
  }

  /**
   * Wire a thinking handler (v2.14+). Omitted, the agent uses the handler
   * the provider declares (`LLMProvider.thinkingHandler` — `anthropic()`
   * declares one, and a wrapper that forwards the field keeps it). Pass a
   * handler to override it, or `null` to mount no thinking stage at all.
   * Calling twice throws.
   *
   * @example
   *   // Custom handler that redacts thinking content
   *   Agent.create({...}).thinkingHandler(myRedactingHandler).build();
   *
   * @example
   *   // Opt out of thinking parsing entirely
   *   Agent.create({ provider: anthropic({...}), model: '...' })
   *     .thinkingHandler(null)
   *     .build();
   */
  thinkingHandler(handler: ThinkingHandler | null): this {
    if (this.thinkingHandlerValue !== undefined) {
      throw new Error(
        'AgentBuilder.thinkingHandler: already set. Each agent has at most one thinking-handler choice.',
      );
    }
    this.thinkingHandlerValue = handler;
    return this;
  }

  /**
   * v2.14+ — REQUEST-side thinking activation. Tells the provider to
   * emit reasoning blocks alongside its response.
   *
   * **What this does:** every LLM call carries
   * `LLMRequest.thinking = { budget }` — the intent. The adapter sends the
   * shape the MODEL takes, from what it declares per model
   * (`LLMProvider.thinkingMode`):
   *   - `'budget'` (Claude 4.6 and earlier): `thinking: { type: 'enabled',
   *     budget_tokens: budget }` — a target for the thinking, not a hard cap
   *     (`max_tokens` is the cap);
   *   - `'adaptive'` (Claude 4.7 and later, Mythos Preview, and any id the
   *     table does not know): `thinking: { type: 'adaptive', display:
   *     'summarized' }` — the model decides whether and how much to think and
   *     the budget is NOT sent (dev mode says so once per model); it only
   *     keeps `max_tokens` above it. An adapter's `thinkingMode` option
   *     changes the answer for one id (an alias, a profile ARN, or Opus 4.6
   *     wanted adaptive);
   *   - `'none'` (Claude 3.x except 3.7 Sonnet): refused here at `build()`
   *     with an `UnsupportedThinkingError`.
   *
   * **Distinct from `.thinkingHandler()`:**
   *   - `.thinking({ budget })` = ASK the model to think (request side)
   *   - `.thinkingHandler(h)`   = NORMALIZE the response (response side)
   *
   * Most consumers want both; auto-wired handler covers the response
   * side automatically when `.thinking()` is set on a thinking-capable
   * provider. Setting `.thinking()` without `.thinkingHandler(null)`
   * is the typical happy path.
   *
   * **Provider compatibility:**
   *   - Anthropic: per model, as above. A budget model needs a whole
   *     `budget` of at least 1024, and no thinking model takes a
   *     `temperature` other than the default — both are refused with an
   *     `UnsupportedThinkingError` before the request is sent.
   *   - OpenAI: ignores. o1/o3 reasoning is selected at the model id
   *     level; this field is a no-op for OpenAIProvider.
   *
   * **`max_tokens`:** thinking counts toward it. When the request's
   * `maxTokens` (default 4096 on the Anthropic adapters) is not above the
   * budget, the adapter raises it to `budget + 1024`.
   *
   * Calling twice throws — same shape as `.reliability()` /
   * `.outputSchema()`.
   *
   * @example
   *   Agent.create({ provider: anthropic({...}), model: 'claude-opus-5-5' })
   *     .system('You are a careful reasoning agent.')
   *     .thinking({ budget: 5000 })   // adaptive on Opus 5.5; budget_tokens on Haiku 4.5
   *     .build();
   */
  thinking(opts: { budget: number }): this {
    return setThinkingBudget(
      livePort<ThinkingBudgetPort>({
        thinkingBudgetValue: {
          get: () => this.thinkingBudgetValue,
          set: (value) => {
            this.thinkingBudgetValue = value;
          },
        },
      }),
      opts,
      this,
    ) as this;
  }

  /**
   * Let this agent answer why-questions about its OWN previous completed
   * turn, from its recorded trace. Mounts one skill: day to day the tool
   * catalog carries only the skill's activation row; when the user asks
   * "why did you…", the LLM activates it and that iteration alone gets
   * the trace tools (inline mode) or a single `explain_run` tool that
   * runs a nested trace debugger on a cheaper model (delegate mode).
   *
   * Evidence binds LATE — always to the previous COMPLETED run, never
   * the in-flight one — and includes control edges (a per-run
   * control-dependence recorder is attached automatically).
   *
   * @example
   *   Agent.create({ provider, model })
   *     .system('You are a refunds assistant.')
   *     .tool(lookupOrder)
   *     .selfExplain()                                 // inline, zero config
   *     .build();
   *
   * @example
   *   .selfExplain({ delegate: { provider: anthropic(), model: 'claude-haiku-4-5' } })
   */
  /**
   * Configure the evidence pack that rides a check-in ask. A tool DEMANDS a
   * check-in by declaring `checkIn: 'always'` or a `(args, ctx) => boolean`
   * predicate ({@link defineTool}); this method controls WHAT the human sees
   * when it trips. Optional — a tool with `checkIn` works without it (default:
   * `'standard'` evidence + the deterministic lexical scorer, zero LLM calls).
   *
   * - `evidence: 'standard'` (default) — the full pack: `willDo` (plain-words
   *   claim), `read` (what context the run consumed), `drivers` (which context
   *   drove the pick, ranked), `trail` (compact run-so-far summary).
   * - `evidence: 'minimal'` — just `willDo` (zero cost).
   * - `evidence: <assembler>` — bring your own {@link CheckInAssembler}.
   * - `scorer` — swap the `drivers` ranker (default is zero-LLM lexical; pass
   *   an embedding-backed one wrapping `explainChoice` for semantic ranking).
   *
   * @example
   *   Agent.create({ provider, model })
   *     .tool(defineTool({ name: 'issue_refund', description: 'Refund a charge',
   *       inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
   *       checkIn: (args) => (args.amount as number) > 1000,   // ask only for big refunds
   *       execute: async ({ amount }) => `refunded ${amount}` }))
   *     .checkIn({ evidence: 'standard' })
   *     .build();
   */
  /**
   * Wrap every tool dispatch in a governance chain.
   *
   * Each middleware answers with one of three verbs — `allow()`, `deny(reason)`
   * or `ask({ question })` — and there is deliberately no fourth. In
   * particular there is no way to return a result: whatever the chain decides,
   * the answer the model finally reads is the real tool's output or a refusal.
   * A rule cannot quietly become the tool.
   *
   * - **`allow()`** passes the call through. **`allow(args, why)`** replaces
   *   the args and the run commits BOTH versions with your `why` beside them,
   *   so a slice taken later can find the moment they changed and who changed
   *   them.
   * - **`deny(reason)`** refuses. The reason reaches the model verbatim, as
   *   the tool result, and the loop continues — the agent adapts in-flight. A
   *   denial is data, not a crash.
   * - **`ask({ question })`** suspends the run for a person, on the same
   *   checkpoint machinery `checkIn` and `askHuman` use. The answer is a
   *   DECISION, not a result: approve and the chain resumes and the real tool
   *   runs; decline and it becomes a denial the model reads.
   *
   * Order is call order, and each middleware sees the previous one's output.
   * The first non-allow answer wins and the rest of the chain does not run. A
   * middleware that throws is a denial carrying the error as its reason —
   * never a silent pass.
   *
   * A link may also carry an **`onToolResult`** hook, which decides about the
   * RESULT once the tool has run and before the model reads it — `allow()`,
   * `allow(value, why)` or `deny(reason)`, and no `ask`, because the tool has
   * already run and there is nothing left for a person to prevent. That half
   * of the chain is walked BACKWARDS, so the first-declared rule has the first
   * word about the call and the last word about the answer. A link with only
   * `onToolResult` takes no part in dispatch at all.
   *
   * `.act({ beforeTool, afterTool })` is the same chain, named by moment.
   *
   * An existing `PermissionChecker` still decides FIRST: it is not part of
   * this chain, it runs ahead of it, so a call it denies never reaches a
   * middleware. `gatedTools` is a different layer again — it decides which
   * tools the model can SEE; this decides what happens when one is called.
   *
   * Omit this and nothing changes: no chain walk, no committed ledger key, the
   * same request bytes.
   *
   * @example
   * ```ts
   * import { Agent, allow, deny } from 'agentfootprint';
   *
   * const agent = Agent.create({ provider, model })
   *   .toolMiddleware({
   *     name: 'no-prod-writes',
   *     onToolCall: (call) =>
   *       call.args.env === 'prod' ? deny('writes to prod need a change ticket') : allow(),
   *   })
   *   .build();
   * ```
   */
  toolMiddleware(...middleware: readonly ToolMiddleware[]): this {
    for (const mw of middleware) this.assertToolMiddleware(mw);
    this.toolMiddlewareList = [...this.toolMiddlewareList, ...middleware];
    return this;
  }

  /**
   * A tool link needs a name and at least one hook. Both are optional
   * INDIVIDUALLY — a rule about calls, a rule about results, or both — but a
   * link with neither is a governance rule that can never run, and finding
   * that out from a quiet run rather than from `build()` is the whole disease.
   */
  private assertToolMiddleware(mw: unknown): void {
    assertToolMiddleware(mw);
  }

  /**
   * Wrap the message boundary in a governance chain — the input before the
   * model sees it, the output before the caller receives it.
   *
   * Same verbs as {@link toolMiddleware} minus one: there is no `ask` here,
   * and the type says so. Tool dispatch runs inside a pausable stage, so it
   * has a checkpoint to suspend on; the message boundary is a plain stage, and
   * inventing a second pause to give it one would be a worse answer than not
   * offering it.
   *
   * The `'input'` half runs at the very top of the run, BEFORE the message is
   * committed. That placement is the point: everything downstream reads
   * `scope.history` — the window strategies, the injections, all three slots,
   * the bytes on the wire and every slice taken afterwards — so the
   * transformed text is what the whole run agrees was said. The `'output'`
   * half runs before final capture. Configuring this door withholds provider
   * draft tokens and `stream.llm_end.content` (marked `contentWithheld: true`).
   * An accepted run emits its captured final answer once; a refused output
   * emits no answer or `turn_end` and makes no final memory write. The API
   * boundary emits `error.fatal` so public streams can close.
   *
   * This door may inspect both phases. For input-only rules with immediate
   * draft streaming, declare `.act({ input: [rule] })`. Output policy is not
   * audit erasure: raw model content and rewrite evidence remain in the run.
   * Coverage/standing text is composed after the output rule; policy approval
   * is not answer validation.
   *
   * `deny(reason)` at either phase raises a `MessageDeniedError` rather than
   * returning. At `'input'` there is no model to tell; at `'output'` the
   * middleware has just refused to release an answer, and handing the caller a
   * string in its place is the one substitution they must never make without
   * noticing. The error carries the reason, the phase and the middleware's
   * name — never the refused content.
   *
   * @example
   * ```ts
   * import { Agent, allow } from 'agentfootprint';
   *
   * const agent = Agent.create({ provider, model })
   *   .messageMiddleware({
   *     name: 'mask-card-numbers',
   *     onMessage: (msg) => {
   *       const clean = msg.content.replace(/\b(?:\d[ -]?){13,16}\b/g, '[card]');
   *       return clean === msg.content ? allow() : allow(clean, 'masked a card number');
   *     },
   *   })
   *   .build();
   * ```
   */
  messageMiddleware(...middleware: readonly MessageMiddleware[]): this {
    for (const mw of middleware) this.assertMiddleware(mw, 'messageMiddleware', 'onMessage');
    this.messageMiddlewareList = [...this.messageMiddlewareList, ...middleware];
    return this;
  }

  /**
   * Wrap every top-level turn of this agent — awaited work before it, an
   * `AsyncLocalStorage` around it, cleanup after it. `proceed()` runs the turn
   * and resolves to nothing, so the wrapper cannot change how the turn ended;
   * `proceed({ time })` sets the clock of a new turn. A hosted turn enters only
   * after the host's identity, admission and session checks. One per agent; a
   * mounted agent with a wrapper is refused by `AroundTurnError`.
   *
   * @example
   * ```ts
   * Agent.create({ provider, model }).aroundTurn({
   *   name: 'prepare',
   *   around: async (turn, proceed) => {
   *     const prepared = await prepare(turn);
   *     await context.run(prepared, () => proceed());
   *   },
   * });
   * ```
   */
  aroundTurn(wrapper: AroundTurn): this {
    this.aroundTurnPort = admitAroundTurn(wrapper, this.aroundTurnPort);
    return this;
  }

  /** Shared shape check — a chain built from a typo fails at build time, not
   *  as a silent no-op on the one call that needed governing. */
  private assertMiddleware(mw: unknown, method: string, hook: string): void {
    assertMiddleware(mw, method, hook);
  }

  checkIn(opts: CheckInBuilderOptions = {}): this {
    return configureCheckIn(
      livePort<CheckInPort>({
        checkInConfig: {
          get: () => this.checkInConfig,
          set: (value) => {
            this.checkInConfig = value;
          },
        },
      }),
      opts,
      this,
    ) as this;
  }

  selfExplain(opts: SelfExplainOptions = {}): this {
    return configureSelfExplain(
      livePort<SelfExplainPort>({
        selfExplainConfig: {
          get: () => this.selfExplainConfig,
          set: (value) => {
            this.selfExplainConfig = value;
          },
        },
        opts: { get: () => this.opts },
      }),
      opts,
      this,
    ) as this;
  }

  /**
   * Resolve what the loop will enforce about the output — or `undefined` when
   * nothing is mounted, which is the default and the byte-identical path.
   *
   * Both refusals live here rather than in `.outputSchema()` because both
   * depend on the WHOLE agent: the tools are registered by other calls that
   * may come after, and `.selfExplain()` attaches its own.
   */
  /**
   * Resolve `.maps()` into the kernel's plan (9.58.0). Undefined when the
   * kernel is not mounted — the zero-delta path. Refuses loudly when there
   * is nothing to manage: the kernel owns engagement, and with no map
   * mounted there is nothing to engage or park.
   */
  private resolveMapsPlan(injections: readonly Injection[]): EngagementPlan | undefined {
    return resolveMapsPlan(
      livePort<MapsPlanPort>({
        mapsOptions: {
          get: () => this.mapsOptions,
          set: (value) => {
            this.mapsOptions = value;
          },
        },
        skillGraphNextSkill: {
          get: () => this.skillGraphNextSkill,
          set: (value) => {
            this.skillGraphNextSkill = value;
          },
        },
        skillGraphNodeIds: {
          get: () => this.skillGraphNodeIds,
          set: (value) => {
            this.skillGraphNodeIds = value;
          },
        },
        skillGraphExplainNextSkill: {
          get: () => this.skillGraphExplainNextSkill,
          set: (value) => {
            this.skillGraphExplainNextSkill = value;
          },
        },
      }),
      injections,
    );
  }

  /**
   * Validate a JSON answer against host-owned evidence before delivering it.
   * Requires outputSchema. Enforce (default) refuses failed or unverified
   * checks; observe returns the answer with a recorded verdict. Both modes
   * withhold draft tokens until this boundary. The callback cannot rewrite
   * the answer; the schema's JSON-safe output is serialized once for delivery.
   * `.outputFallback()` and `.limitsTravelWithTheAnswer()` are refused beside it
   * in this version.
   *
   * `agentChecks: ['claims', 'names-and-numbers']` makes the agent's own
   * `.claims()` and `.namesAndNumbersFromEvidence()` verdicts rows of the same
   * report, so a contradicted field or an invented value is withheld rather
   * than only recorded (see {@link AnswerValidationOptions.agentChecks}).
   */
  answerValidation<T>(options: AnswerValidationOptions<T>): this {
    if (this.answerValidationConfig !== undefined) {
      throw new Error('AgentBuilder.answerValidation: already configured.');
    }
    this.answerValidationConfig = resolveAnswerValidation(options);
    return this;
  }

  /**
   * Observe ordinary prose with `{ prose: true }`, preserving the answer and live
   * streaming. Warnings never confirm or block a claim. No schema or tool list is
   * required; optional `phrases` extends the grammar with bounded literal data.
   * `.outputFallback()` is unsupported because it substitutes text after observation.
   *
   * Or deliver typed negative claims as library-written statements of the searches
   * they cite. `field` is a required top-level array in `.outputSchema()`'s JSON
   * Schema; entries contain only `kind`, required `about`, and `restsOn` handles.
   * The output adds `statement`, `delivery: 'record-composed'` and `version`.
   *
   * An unestablished citation withholds the answer by default. `state-searched`
   * delivers what was searched while retaining its failed or unverified standing.
   * Bounded prose observation files warnings; other answer text remains unchecked.
   * The structured path is unmeasured: typed enforcement is available, not recommended
   * until its benchmark gates pass. Declaration order with `.outputSchema()` does
   * not matter; the complete contract is checked at build.
   *
   * @example
   * ```ts
   * builder.negativeClaims({ field: 'negatives', tools: ['list_incidents'] });
   * ```
   */
  negativeClaims(options: NegativeClaimsOptions): this {
    if (this.negativeClaimsConfig !== undefined) {
      throw new Error('Agent.negativeClaims: already configured.');
    }
    this.negativeClaimsConfig = resolveNegativeClaims(options);
    return this;
  }

  private resolveOutputEnforcement(
    servedSchema?: Readonly<Record<string, unknown>>,
  ): ResolvedOutputEnforcement | undefined {
    return resolveOutputEnforcement(
      livePort<Readonly<OutputEnforcementPort>>({
        outputSchemaParser: {
          get: () => this.outputSchemaParser,
        },
        outputSchemaStrategy: {
          get: () => this.outputSchemaStrategy,
        },
        registry: { get: () => this.registry },
        injectionList: { get: () => this.injectionList },
        toolProviderRef: {
          get: () => this.toolProviderRef,
        },
        selfExplainConfig: {
          get: () => this.selfExplainConfig,
        },
        outputSchemaJson: {
          get: () => this.outputSchemaJson,
        },
        findingsValue: {
          get: () => this.findingsValue,
        },
        opts: { get: () => this.opts },
        negativeClaimsConfig: {
          get: () => this.negativeClaimsConfig,
        },
        outputSchemaRetries: {
          get: () => this.outputSchemaRetries,
        },
        outputFallbackCfg: {
          get: () => this.outputFallbackCfg,
        },
        answerValidationConfig: {
          get: () => this.answerValidationConfig,
        },
      }),
      servedSchema,
    );
  }

  build(): Agent {
    return assembleAgent(
      livePort<AssemblyPort>({
        appNameValue: { get: () => this.appNameValue },
        commentaryOverrides: { get: () => this.commentaryOverrides },
        thinkingOverrides: { get: () => this.thinkingOverrides },
        maxIterationsOverride: { get: () => this.maxIterationsOverride },
        findingsValue: { get: () => this.findingsValue },
        toolChoiceValue: { get: () => this.toolChoiceValue },
        ontologyValue: { get: () => this.ontologyValue },
        inputsLayerValue: { get: () => this.inputsLayerValue },
        resultsLayerValue: { get: () => this.resultsLayerValue },
        timeValue: { get: () => this.timeValue },
        opts: { get: () => this.opts },
        inputsLayerSourcesValue: { get: () => this.inputsLayerSourcesValue },
        selfExplainConfig: { get: () => this.selfExplainConfig },
        registry: { get: () => this.registry },
        evidenceGate: { get: () => this.evidenceGate },
        injectionList: { get: () => this.injectionList },
        skillGraphCascade: { get: () => this.skillGraphCascade },
        toolsFromActiveSkillValue: { get: () => this.toolsFromActiveSkillValue },
        toolProviderRef: { get: () => this.toolProviderRef },
        recorderList: { get: () => this.recorderList },
        checkInConfig: { get: () => this.checkInConfig },
        skillGraphScoreEntries: { get: () => this.skillGraphScoreEntries },
        skillGraphBrainOptions: { get: () => this.skillGraphBrainOptions },
        skillGraphNextSkill: { get: () => this.skillGraphNextSkill },
        skillGraphNodeIds: { get: () => this.skillGraphNodeIds },
        thinkingBudgetValue: { get: () => this.thinkingBudgetValue },
        reliabilityConfig: { get: () => this.reliabilityConfig },
        resolveMapsPlan: {
          get: () => {
            const method = this.resolveMapsPlan;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        scriptTravelValue: { get: () => this.scriptTravelValue },
        claimsContract: { get: () => this.claimsContract },
        outputSchemaParser: { get: () => this.outputSchemaParser },
        assertOutputFallbackCoherent: {
          get: () => {
            const method = this.assertOutputFallbackCoherent;
            return (...args: Parameters<typeof method>): ReturnType<typeof method> =>
              Reflect.apply(method, this, args) as ReturnType<typeof method>;
          },
        },
        negativeClaimsConfig: { get: () => this.negativeClaimsConfig },
        outputFallbackCfg: { get: () => this.outputFallbackCfg },
        limitsTravelValue: { get: () => this.limitsTravelValue },
        outputSchemaJson: { get: () => this.outputSchemaJson },
        answerValidationConfig: { get: () => this.answerValidationConfig },
        answerLayerValue: { get: () => this.answerLayerValue },
        skillGraphIsTree: { get: () => this.skillGraphIsTree },
        skillGraphEdgeTargets: { get: () => this.skillGraphEdgeTargets },
        skillGraphDeferredBodyContract: { get: () => this.skillGraphDeferredBodyContract },
      }),
      ({
        opts,
        voice,
        injections,
        toolProvider,
        negativeSchema,
        skillBrains,
        mapsPlan,
        claimContract,
        negativeClaims,
      }) =>
        new Agent(
          opts,
          this.systemPromptValue,
          this.registry,
          voice,
          injections,
          this.memoryList,
          this.outputSchemaParser,
          toolProvider,
          this.systemPromptCachePolicy,
          this.cachingDisabledValue,
          this.cacheStrategyOverride,
          this.outputFallbackCfg,
          this.reliabilityConfig,
          this.thinkingHandlerValue,
          this.thinkingBudgetValue,
          this.skillGraphNextSkill,
          this.skillGraphReachable,
          this.skillGraphScoreEntries,
          this.checkInConfig,
          this.runConfigFn,
          this.windowStrategyValue,
          this.toolMiddlewareList,
          this.messageMiddlewareList,
          this.resolveOutputEnforcement(negativeSchema),
          this.skillGraphEdgeTargets,
          this.skillGraphExplainNextSkill,
          this.skillGraphIsTree,
          this.skillGraphSupersededEntries,
          this.skillGraphCascade,
          skillBrains,
          this.evidenceGate,
          this.limitsTravelValue,
          // Declaration order, and a COPY: the manifest reports what this build
          // applied, and a later `.recipe()` on the same builder (a second
          // `build()`) must not retroactively edit the agent already handed out.
          // Undefined rather than `[]` when none — the manifest's "absent means not
          // configured" law, and what keeps an agent with no recipes byte-identical.
          this.appliedRecipeList.length > 0 ? [...this.appliedRecipeList] : undefined,
          this.skillGraphDeclared,
          mapsPlan,
          claimContract,
          this.answerValidationConfig,
          this.systemPromptCacheExplicit,
          negativeClaims,
          this.scriptTravelValue,
          this.aroundTurnPort,
        ),
    );
  }
}

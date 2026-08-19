/**
 * AgentBuilder — fluent builder for Agent. Extracted from Agent.ts in
 * v2.11.2 as part of the core/agent decomposition. Same surface, same
 * behavior; just lives in its own file for readability.
 *
 * Re-exported by Agent.ts so external consumers importing
 * `AgentBuilder` from `'../core/Agent.js'` continue to work.
 */

import { isDevMode } from 'footprintjs';

import {
  buildDefaultInstruction,
  type OutputSchemaOptions,
  type OutputSchemaParser,
  type OutputSchemaStrategy,
} from '../outputSchema.js';
import {
  buildSchemaTool,
  resolveJsonSchema,
  SCHEMA_TOOL_NAME,
  type ResolvedOutputEnforcement,
} from './outputEnforcement.js';
import { resolveEvidenceGate } from './evidence/gate.js';
import { scopeToolsToActiveSkill } from './toolsFromActiveSkill.js';
import type { NamesAndNumbersOptions, ResolvedEvidenceGate } from './evidence/types.js';
import {
  validateCannedAgainstSchema,
  type OutputFallbackFn,
  type OutputFallbackOptions,
  type ResolvedOutputFallback,
} from '../outputFallback.js';
import type { CachePolicy, CacheStrategy } from '../../cache/types.js';
import type { Injection, InjectionContext } from '../../lib/injection-engine/types.js';
import {
  SKILL_GRAPH_DEFERRED_CONTRACT_KEY,
  type CursorMove,
  type DeferredBodyContract,
  type EntryScoring,
  type TurnRoutingPlan,
} from '../../lib/injection-engine/skillGraph.js';
import {
  foldSkillBrains,
  type EscalationPolicy,
  type FoldedSkillBrains,
  type ProviderChoice,
} from './skillBrains.js';
import {
  defineMenuHint,
  MENU_HINT_METADATA_KEY,
} from '../../lib/injection-engine/factories/defineMenuHint.js';
import {
  defineStepsHint,
  STEPS_HINT_METADATA_KEY,
} from '../../lib/injection-engine/factories/defineStepsHint.js';
import { foldStepPlans } from '../../lib/injection-engine/skillSteps.js';
import { checkSkillContracts, skillToolNames } from '../../lib/injection-engine/skillContract.js';
import { formatCheckup } from '../../lib/injection-engine/skillGraphCheckup.js';
import { checkArtifactVocabularies } from '../../lib/injection-engine/skillVocabulary.js';
import { toolOnlyDeliveryRefusal } from '../../lib/injection-engine/skillBodyDelivery.js';
import { defineInstruction } from '../../lib/injection-engine/factories/defineInstruction.js';
import { messagesToolRoleRefusal } from '../../lib/injection-engine/messagesSlotRefusal.js';
import { READS_ENTRY_SCORES_METADATA_KEY } from '../../lib/injection-engine/factories/defineRelevanceHint.js';
import { skillScopedToolsTarget } from '../../tool-providers/skillScopedTools.js';
import type { MemoryDefinition } from '../../memory/define.types.js';
import type { ReliabilityConfig } from '../../reliability/types.js';
import type { ThinkingHandler } from '../../thinking/types.js';
import type { Tool, ToolRegistryEntry } from '../tools.js';
import type { CheckInBuilderOptions } from '../checkin.js';
import type { ToolProvider } from '../../tool-providers/types.js';
import type { Watcher } from './watch.js';
import { defaultCommentaryTemplates } from '../../recorders/observability/commentary/commentaryTemplates.js';
import { defaultStatusTemplates } from '../../recorders/observability/status/statusTemplates.js';
import {
  buildSelfExplainSkill,
  buildSelfExplainToolProvider,
  SelfExplainBinding,
  type SelfExplainOptions,
} from '../../lib/trace-toolpack/selfExplain.js';
import {
  innerRunsOf,
  mergeInnerRuns,
  type InnerRunLookup,
} from '../../lib/trace-toolpack/innerRunRecords.js';
import { TRACE_TOOL_NAMES } from '../../lib/trace-toolpack/traceToolpack.js';
import { Agent } from '../Agent.js';
import { buildSkillGraphDeclared, type SkillGraphDeclaredMap } from './skillGraphDeclared.js';
import type { AgentOptions, RunConfigFn } from './types.js';
import type { CompactionOptions } from './window/types.js';
import type { WindowStrategy } from './window/strategy.js';
import type { LLMProvider } from '../../adapters/types.js';
import type { MessageMiddleware, ToolMiddleware } from './middleware/types.js';
import { resolveAct, type ActOptions } from './act.js';
import { resolveCompactionOptions } from './window/options.js';
import { summarizeOldest } from './window/strategies/summarizeOldest.js';
import { assertAgentRecipe } from '../../recipes/defineAgentRecipe.js';
import {
  asyncConfigureRefusal,
  duplicateRecipeRefusal,
  duplicateRegistrationRefusal,
  recursiveRecipeRefusal,
  resolveRecipeConflictPolicy,
} from '../../recipes/apply.js';
import { LOCAL_SOURCE, type RecipeSource } from '../../recipes/provenance.js';
import type { AgentRecipe, AppliedRecipe, RecipeOptions } from '../../recipes/types.js';

/**
 * Mount options for `.skillGraph(graph, options)` (SG-C, 9.17.0; brains
 * SG-D, 9.19.0). Every field is zero-cost when absent — an agent that passes
 * none is byte-identical in behavior AND events to one built before the
 * options existed.
 */
export interface SkillGraphOptions {
  /**
   * How much routing authority the model has. Default `'assist'` — today,
   * always: any REACHABLE `read_skill` pick is admitted, and a pick off an
   * offered menu is stamped on the record (`cursorMove.declinedOffer`)
   * rather than refused.
   *   • `'guard'` — a routing pick is admitted only while the turn's menu is
   *     outstanding AND names an offered id (the framework declared the
   *     ambiguity; the model resolves exactly that). Everything else gets a
   *     teaching refusal + `skill.rejected { posture: 'guard' }`.
   *   • `'rails'` — the model never routes: turn starts resolve by rule or
   *     scorer, transitions by declared routes. A menu verdict then proceeds
   *     on the base prompt with `turn_routed { by: 'none' }` recorded — the
   *     honest cost of rails without a resolver. OPEN skills
   *     (`.selfExplain()`, `.skill()` beside the graph) stay admitted from
   *     anywhere under every posture.
   */
  readonly strictness?: 'assist' | 'guard' | 'rails';
  /**
   * What the cursor spans. Default `'turn'` — today's per-run cursor,
   * unchanged. `'conversation'`: the turn's final cursor rides the
   * conversation checkpoint (`agent.checkpoint()` / the crash carrier) and
   * becomes the DEFAULT entry when that conversation is continued
   * (`followUp()` / `run({ continueFrom })`) — a sticky default the new
   * message can still decisively beat, never a lock. Without `continueFrom`
   * nothing carries: a bare second `run()` starts cold exactly as today —
   * this option changes what a CONTINUED conversation defaults to; it does
   * not invent persistence.
   */
  readonly continuity?: 'turn' | 'conversation';
  /**
   * Per-skill BRAINS (9.19.0) — "the cursor picks the brain": while the
   * graph's cursor is on a named skill, `callLLM` runs on its declared
   * provider/model instead of the agent's. Keys are skill ids; an id that
   * is not a graph node is refused at build, as is a foreign provider with
   * no model (the agent's model id belongs to another vendor's namespace).
   * The other declaration home is `defineSkill({ provider, model })` — the
   * same id in both homes with different choices is refused naming both.
   */
  readonly providers?: Readonly<Record<string, ProviderChoice>>;
  /**
   * Escalate-on-evidence (9.19.0): `afterRefusals` recorded gate refusals
   * (`skill.rejected` — reachability OR posture) in ONE turn flip the rest
   * of the turn onto this brain — `skill.escalated` goes on the record at
   * the flip, and the next turn's seed de-escalates. Never on vibes: only
   * real refusals count.
   */
  readonly escalation?: EscalationPolicy;
  /**
   * The tier-3 DECIDER (9.19.0): an out-of-band constrained pick over an
   * outstanding turn-start menu ∪ {stay} (the `llmClassifier` enum
   * machinery), resolved before the loop — `turn_routed { by: 'decider' }`.
   * The sanctioned resolver for `'rails'` menus: constrained, off-loop, and
   * recorded, i.e. a scorer in posture terms. Needs a graph that runs the
   * turn-start cascade (a classifier, or `continuity: 'conversation'`) —
   * refused at build otherwise, because no other graph ever has a menu for
   * it to resolve.
   */
  readonly decider?: ProviderChoice;
}

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
  private readonly memoryList: MemoryDefinition[] = [];
  /**
   * Optional terminal contract — see `outputSchema()`. Stored on the
   * builder, propagated to the Agent at `.build()` time.
   */
  private outputSchemaParser?: OutputSchemaParser<unknown>;
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

  private outputSchemaRetries = 0;
  private outputSchemaStrategy: OutputSchemaStrategy = 'instruct';
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
   *   - undefined (default): auto-wire by `provider.name` via
   *     `findThinkingHandler` from the registry
   *   - explicit handler: override the auto-wire
   *   - explicit `null`: opt out (no thinking handler mounted at all,
   *     even if the provider would auto-match)
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
    if (this.systemPromptSet) {
      throw new Error(
        'AgentBuilder.system: already set. Each agent has one base system prompt — a second ' +
          'call used to REPLACE the first silently, so the instructions you wrote first were ' +
          'never sent and nothing said so. For a second block of always-on system content, ' +
          'add it as an injection: .steering(defineSteering({ id, content })) composes into ' +
          'the same slot, is visible in the trace as its own entry, and can be cached ' +
          'separately. To decide the prompt PER RUN, use .configure(({ defaults }) => ' +
          '({ instructions: … })). To build one string from parts, join them yourself and ' +
          'pass the result once.',
      );
    }
    this.systemPromptSet = true;
    this.systemPromptValue = prompt;
    if (options?.cache !== undefined) {
      this.systemPromptCachePolicy = options.cache;
    }
    return this;
  }

  tool<TArgs, TResult>(tool: Tool<TArgs, TResult>): this {
    const name = tool.schema.name;
    if (this.registry.some((e) => e.name === name)) {
      throw new Error(this.duplicateRefusal('tool name', name, this.toolSources, 'Agent.tool()'));
    }
    this.registry.push({ name, tool: tool as unknown as Tool });
    this.toolSources.set(name, this.currentSource());
    return this;
  }

  /**
   * Who is registering right now: the app itself, or the recipe whose
   * `configure` is on the stack. A fresh object per call so a later push onto
   * the stack cannot rewrite what an earlier registration recorded.
   */
  private currentSource(): RecipeSource {
    return this.recipeStack.length === 0
      ? LOCAL_SOURCE
      : { kind: 'recipe', stack: [...this.recipeStack] };
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
    const existing = sources.get(name);
    const incoming = this.currentSource();
    if (existing?.kind === 'local' && incoming.kind === 'local') {
      return what === 'tool name'
        ? `Agent.tool(): duplicate tool name '${name}'`
        : `Agent.injection(): duplicate id '${name}'`;
    }
    return duplicateRegistrationRefusal({ what, name, existing, incoming, callSite });
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
    assertAgentRecipe(recipe, 'AgentBuilder.recipe');
    // Resolved before anything is applied: a policy this library does not have
    // must not half-apply a composition before it says so.
    resolveRecipeConflictPolicy(options?.conflict, 'AgentBuilder.recipe');
    const applied: AppliedRecipe = { id: recipe.id, version: recipe.version };
    // TWO different facts, two different refusals. On the STACK means the
    // composition is its own ancestor and `configure` would recurse forever; on
    // the LIST means the chain simply names one composition twice. Telling an
    // author their recursion is a duplicate sends them to the wrong line.
    const applying = this.recipeStack.find((r) => r.id === applied.id);
    if (applying) {
      throw new Error(
        recursiveRecipeRefusal({
          stack: [...this.recipeStack],
          incoming: applied,
          callSite: 'AgentBuilder.recipe',
        }),
      );
    }
    const already = this.appliedRecipeList.find((r) => r.id === applied.id);
    if (already) {
      throw new Error(
        duplicateRecipeRefusal({
          existing: already,
          incoming: applied,
          callSite: 'AgentBuilder.recipe',
        }),
      );
    }
    this.recipeStack.push(applied);
    try {
      const returned: unknown = recipe.configure(this);
      // `build()` is synchronous, so nothing would ever await this. Refused by
      // name rather than left to land on an agent that is already built.
      if (typeof (returned as { then?: unknown } | undefined)?.then === 'function') {
        throw new Error(asyncConfigureRefusal(applied, 'AgentBuilder.recipe'));
      }
    } finally {
      // `finally`, not the happy path: a refusal raised inside `configure`
      // (a duplicate tool, say) must not leave the stack claiming a recipe is
      // still applying — the next registration would be attributed to it.
      this.recipeStack.pop();
    }
    // The manifest row is recorded only once `configure` has run CLEANLY. A
    // recipe whose application was refused half-way has not produced this
    // agent, and a row claiming it did would be the manifest asserting
    // something that did not happen. (Recursion is caught by the stack above,
    // so nothing depends on the row being written early.)
    this.appliedRecipeList.push(applied);
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
    if (this.toolProviderRef) {
      throw new Error(
        'AgentBuilder.toolProvider: already set. Each agent has at most one external ToolProvider.',
      );
    }
    this.toolProviderRef = provider;
    return this;
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
    if (this.runConfigFn) {
      throw new Error(
        'AgentBuilder.configure: already set. One resolver per agent — a second one would ' +
          'silently override the first.',
      );
    }
    if (typeof fn !== 'function') {
      throw new Error(
        `AgentBuilder.configure: expected a function (ctx) => ({ model?, instructions? }), got ` +
          `${typeof fn}.`,
      );
    }
    this.runConfigFn = fn;
    return this;
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
    if (this.actCalled) {
      throw new Error(
        'AgentBuilder.act: already called. One posture block per agent — a second would put ' +
          'the answer to "what does this agent do at each moment of its loop?" in two places, ' +
          'with the later one silently winning. To ADD one rule to an agent that already has ' +
          'a posture, use the individual door for that moment (.toolMiddleware(), ' +
          '.messageMiddleware(), .window()); they compose incrementally by design.',
      );
    }
    // Resolved BEFORE anything is attached: a bundle with a bad key must
    // leave the builder exactly as it found it, not half-configured. Every
    // entry is validated inside `resolveAct`, and the window — the one key
    // whose validation lives on its own door — goes first for the same
    // reason.
    const resolved = resolveAct(options);
    if (resolved.window !== undefined) {
      this.assertNoWindowStrategy('act');
      // Noted BEFORE delegating: `.window()` is the setter both doors share,
      // and the refusal a later call meets should name the door this caller
      // actually wrote.
      this.noteWindowStrategyDoor('.act({ window })');
      this.window(resolved.window);
    }
    this.actCalled = true;
    if (resolved.message.length > 0) this.messageMiddleware(...resolved.message);
    if (resolved.tool.length > 0) this.toolMiddleware(...resolved.tool);
    return this;
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
    this.assertNoWindowStrategy('window');
    if (
      strategy === null ||
      typeof strategy !== 'object' ||
      typeof strategy.plan !== 'function' ||
      typeof strategy.name !== 'string' ||
      strategy.name.length === 0
    ) {
      throw new Error(
        `AgentBuilder.window: expected a WindowStrategy — an object with a non-empty \`name\` ` +
          `and a \`plan(input)\` method — got ${typeof strategy}. The shipped ones are ` +
          `summarizeOldest({ ... }), slidingWindow({ ... }) and tokenBudget({ ... }); call the ` +
          `factory, do not pass it.`,
      );
    }
    this.assertSummarizerIsNotTheAgentItself(strategy.billing, 'AgentBuilder.window');
    this.windowStrategyValue = strategy;
    // `.act({ window })` delegates here, and its own door was noted first —
    // do not overwrite a more specific attribution with this generic one.
    this.noteWindowStrategyDoor(this.windowStrategyDoor ?? '.window()');
    return this;
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
    if (billing === undefined) return;
    if (billing.provider !== this.opts.provider) return;
    if (billing.model !== this.opts.model) return;
    throw new Error(
      `${label}: the summarizer is the agent's own provider INSTANCE and the agent's own model ` +
        `('${billing.model}'). Those two calls now look identical and are not: the agent's call ` +
        `runs through reliability retries, any withRetry/withFallback/withCircuitBreaker ` +
        `decorator and the cache; the summarizer's call runs through none of them — one ` +
        `attempt, no fallback, no cache. A difference nobody typed is the kind this library ` +
        `refuses.\n` +
        `Fix, one word: give the summarizer its OWN instance — \`anthropic()\` written again ` +
        `(as \`summarizer\` on a window strategy, as \`llm\` on a summarize memory) rather than ` +
        `the variable you passed to Agent.create. That also stops the two roles sharing ` +
        `per-instance state. Or name a different (usually cheaper) model.`,
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
    this.assertNoWindowStrategy('compaction');
    // Validated here so the error names the door the caller actually used;
    // `summarizeOldest` re-runs the SAME validator under its own label, so the
    // two doors can never drift into accepting different things.
    const resolved = resolveCompactionOptions(options, 'AgentBuilder.compaction');
    this.assertSummarizerIsNotTheAgentItself(
      { provider: resolved.summarizer, model: resolved.model },
      'AgentBuilder.compaction',
    );
    this.windowStrategyValue = summarizeOldest(options);
    this.noteWindowStrategyDoor('.compaction()');
    return this;
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
    const existing = this.windowStrategyValue;
    if (existing === undefined) return;
    const setBy = this.windowStrategyDoor ?? '.window()';
    const law =
      'One window strategy per agent, whichever door set it — a second would silently ' +
      'override the first, and a window policy that quietly changed is a policy you cannot ' +
      'audit.';
    if (door === 'act') {
      throw new Error(
        `AgentBuilder.act: this agent already has a window strategy ('${existing.name}'), set ` +
          `by ${setBy}. ${law} Drop the \`window\` key here, or remove the ${setBy} call.`,
      );
    }
    if (door === 'compaction') {
      throw new Error(
        `AgentBuilder.compaction: this agent already has a window strategy ` +
          `('${existing.name}'), set by ${setBy}. ${law} \`.compaction()\`, \`.window()\` and ` +
          '`.act({ window })` are three doors into the same setting.',
      );
    }
    throw new Error(
      `AgentBuilder.window: this agent already has a window strategy ('${existing.name}'), set ` +
        `by ${setBy}. ${law} \`.compaction()\` is this same door with summarizeOldest already ` +
        'in it, and `.act({ window })` is it again inside the posture block.',
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
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`AgentBuilder.maxIterations: expected a positive integer, got ${n}.`);
    }
    this.maxIterationsOverride = n;
    return this;
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
   * REMOVED in 9.0.0 — use {@link AgentBuilder.watch} instead.
   *
   * This is a one-release grace error, not a method. Deprecated in 8.0.0 in
   * favour of `.watch(...)` — same list, same order, same attachment, and
   * `.watch()` takes more than one observer. The body was deleted in 9.0.0;
   * the NAME is kept for one major so a call site that missed the deprecation
   * gets a sentence instead of `builder.recorder is not a function`.
   *
   * It throws at BUILD time, before any run, so the failure is deterministic
   * and lands in development rather than in a trace nobody is watching.
   *
   * @deprecated Removed in 9.0.0 — call `.watch(rec)`. This throwing stub is
   * deleted in 10.0.0.
   */
  recorder(_rec: Watcher): this {
    throw new Error(
      `AgentBuilder.recorder() was removed in 9.0.0 — call .watch(rec) instead. It is the ` +
        `same list, the same order and the same attachment (both replay through ` +
        `agent.attach() at the end of build()), under the name the agent loop already used ` +
        `for it, and .watch() is variadic: .watch(a, b, c). This name is kept only to say ` +
        `so, and is deleted in 10.0.0.`,
    );
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
    if (this.injectionList.some((i) => i.id === injection.id)) {
      throw new Error(
        this.duplicateRefusal(
          'injection id',
          injection.id,
          this.injectionSources,
          'Agent.injection()',
        ),
      );
    }
    for (const msg of injection.inject?.messages ?? []) {
      if (msg.role === 'tool') {
        throw new Error(messagesToolRoleRefusal(`Agent.injection('${injection.id}')`));
      }
    }
    assertReadSkillActivation(injection);
    this.injectionList.push(injection);
    this.injectionSources.set(injection.id, this.currentSource());
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
    // Classic ReAct caches the system-prompt and tools slots after turn 1 (the
    // Context selector's `includeStatic`), while the injection engine — the loop
    // target — keeps running every iteration. A graph mounted on that mode
    // ADVANCES: routes fire, the cursor moves, `context.evaluated` honestly
    // reports skills activating — and none of it ever reaches the model,
    // because the slots that would carry the activated body and unlocked tools
    // were composed once and never again. Config that lies. Refused at build
    // (9.16.0), like `.selfExplain()` under classic and for the same caching
    // reason; `reactMode` is fixed at `Agent.create`, so this check is
    // order-safe wherever `.skillGraph()` appears in the chain.
    if (this.opts.reactMode === 'classic') {
      throw new Error(
        "AgentBuilder.skillGraph: reactMode 'classic' cannot honor a skill graph. " +
          'Classic caches the system-prompt and tools slots after turn 1, so a route-driven ' +
          "activation moves the cursor and shows up in the trace but the activated skill's " +
          'body and tools never reach the model — the run would record routing that the wire ' +
          "never saw. Use the default 'dynamic' mode (or 'dynamic-grouped'), which recomposes " +
          'the slots every iteration. Classic remains fine WITHOUT a graph: a fixed system ' +
          'prompt, fixed tools, and always-on steering all compose on turn 1 and stay valid.',
      );
    }
    // One agent routes with ONE graph. The second call used to replace the cursor,
    // the reachable set and the entry scorer while the FIRST graph's skills stayed
    // registered and active — so graph 1's route targets could never activate again
    // (their ids are absent from graph 2's reachable set, so even a model pick is
    // refused) and only its unconditional entries survived, as always-on bodies with
    // dead wiring. Nothing about that is recoverable at runtime, so it is refused
    // here (8.4.0).
    if (this.skillGraphNextSkill !== undefined) {
      throw new Error(
        'Agent.skillGraph(): a skill graph is already mounted, and one agent routes with ' +
          'ONE graph. The second call replaces the cursor, the reachable set and the entry ' +
          "scorer — the first graph's skills stay registered and active, so its own routes " +
          'could never fire again. Merge the two graphs into one skillGraph(...) ' +
          'declaration, or build one agent per graph.',
      );
    }
    for (const skill of graph.skills) this.injection(skill);
    // Capture the cursor resolver so the Injection Engine can `from`-gate route
    // triggers against the persisted `currentSkillId`. `nextSkill` is REQUIRED
    // (every `skillGraph().build()` supplies it). Pass the full `build()` result
    // here; for a bare skill list use `.skills({ list })` instead.
    this.skillGraphNextSkill = graph.nextSkill;
    // The reachable-set resolver gates read_skill to in-graph jumps (optional for
    // forward-compat with graphs built before reachableSkills existed).
    this.skillGraphReachable = graph.reachableSkills;
    // The relevance entry scorer (present only with `.entryByRelevance()`).
    this.skillGraphScoreEntries = graph.scoreEntries;
    // Which skills the graph WIRES (any declared incoming edge, deterministic or
    // bare). The gate uses it to leave a bare model edge `A → M` from-gated while
    // opening skills the graph never mentions.
    this.skillGraphEdgeTargets = (graph.edges ?? []).map((e) => e.to);
    // The clause-reporting resolver (8.5.0) and the one fact the gate's refusal
    // needs beyond the reachable set: is this a tree?
    this.skillGraphExplainNextSkill = graph.explainNextSkill;
    // The suppression reporter (8.15.0) — what the cursor law kept off the wire.
    this.skillGraphSupersededEntries = graph.supersededEntries;
    this.skillGraphIsTree = (graph.nodes ?? []).some((n) => n.kind === 'predicate');
    // The node-id set (9.19.0) — the brains check-up's map. Captured on every
    // mount; undefined when the graph object carries no `nodes` (a
    // structurally-typed graph), in which case declaring brains is refused
    // at build rather than validated against a map that does not exist.
    if (graph.nodes !== undefined) {
      this.skillGraphNodeIds = new Set(
        graph.nodes.flatMap((n) => (typeof n.id === 'string' ? [n.id] : [])),
      );
    }
    // The DECLARED map (9.50.0) — nodes + edges verbatim, descriptions from the
    // compiled skills. Projected ONCE here (the graph object is in hand only at
    // mount) so `createExecutor` can file it per run without holding the graph.
    this.skillGraphDeclared = buildSkillGraphDeclared(graph, graph.skills);
    // The brains options (9.19.0) — captured verbatim; folded + validated at
    // build(), where the final injection list (the other home) exists.
    if (
      options?.providers !== undefined ||
      options?.escalation !== undefined ||
      options?.decider !== undefined
    ) {
      this.skillGraphBrainOptions = {
        ...(options.providers !== undefined && { providers: options.providers }),
        ...(options.escalation !== undefined && { escalation: options.escalation }),
        ...(options.decider !== undefined && { decider: options.decider }),
      };
    }
    // ── The mount options (SG-C): posture + cursor span ────────────────────
    const strictness = options?.strictness ?? 'assist';
    const continuity = options?.continuity ?? 'turn';
    if (!['assist', 'guard', 'rails'].includes(strictness)) {
      throw new Error(
        `Agent.skillGraph: strictness '${String(strictness)}' is not a posture this library ` +
          `has. The three are 'assist' (today's gate — reachable picks admitted, divergence ` +
          `recorded), 'guard' (picks only from an offered menu) and 'rails' (the model never ` +
          `routes; rules/scorer/routes do).`,
      );
    }
    if (!['turn', 'conversation'].includes(continuity)) {
      throw new Error(
        `Agent.skillGraph: continuity '${String(continuity)}' is not a span this library ` +
          `has. 'turn' (default) — the cursor is per-run, exactly as always; ` +
          `'conversation' — the turn's final cursor rides the conversation checkpoint and ` +
          `becomes the default entry when that conversation is continued.`,
      );
    }
    if (continuity === 'conversation' && this.skillGraphIsTree) {
      throw new Error(
        "Agent.skillGraph: continuity: 'conversation' cannot be honored by a decision " +
          '.tree() — a tree routes by predicate on every iteration and has no cursor to ' +
          "carry between turns. Use the flat entry/route form, or keep continuity: 'turn'.",
      );
    }
    if (strictness === 'rails' && graph.entrySelection === 'model-read') {
      throw new Error(
        "Agent.skillGraph: strictness: 'rails' cannot honor .entryByRead() — that mode's " +
          'entire entry mechanism IS a model pick, and rails refuses model routing. Rank the ' +
          'entries with .entryBy(keywordScorer()) / .classify(...), declare start rules, or ' +
          "drop to strictness: 'guard' (the model picks only from an offered menu).",
      );
    }
    // The cascade needs the graph's turn-routing plan — a graph built by this
    // version always carries one. A structurally-typed graph without it cannot
    // be judged, and accepting the option while wiring nothing would be config
    // that lies, so it is refused by name.
    const needsPlan = graph.entrySelection === 'classify' || continuity === 'conversation';
    if (needsPlan && graph.turnRouting === undefined) {
      throw new Error(
        `Agent.skillGraph: ${
          graph.entrySelection === 'classify'
            ? 'this graph declares a classifier'
            : "continuity: 'conversation' was declared"
        }, but the graph object carries no \`turnRouting\` plan — the turn-start cascade ` +
          `cannot run without it. Build the graph with this version's skillGraph() (every ` +
          `flat graph it builds carries the plan), or drop the option.`,
      );
    }
    if (strictness !== 'assist' || continuity !== 'turn' || graph.entrySelection === 'classify') {
      // Wired only when something NEW was asked for — a bare `.skillGraph(g)`
      // on a scorer/read/plain graph stores nothing and changes nothing.
      this.skillGraphCascade = {
        ...(graph.turnRouting !== undefined && { turnRouting: graph.turnRouting }),
        strictness,
        continuity,
        nodeIds: new Set(
          (graph.nodes ?? []).flatMap((n) => (typeof n.id === 'string' ? [n.id] : [])),
        ),
      };
    }
    // The deferred body-contract note: the graph built without `knownTools`, so its
    // typo-vs-baseline-tool checks wait for `build()`, where the registry is real.
    // Library-built graphs also stamp the note on each skill's metadata (that is
    // what serves the `.skills({ list })` door); this capture is the fallback for
    // a structurally-typed graph without the stamps — `build()` dedupes by id.
    if (graph.deferredBodyContract) {
      this.skillGraphDeferredBodyContract = {
        mode: graph.deferredBodyContract.mode,
        skills: graph.skills,
      };
    }
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
    // A memory that calls a model on your behalf — today that is the
    // `summarize` strategy — is held to the same separate-instance rule as
    // `.compaction()`. `defineMemory` cannot make this check: it has never
    // heard of an agent. It declares the billing, this reads it (9.14.0).
    this.assertSummarizerIsNotTheAgentItself(
      definition.billing,
      `Agent.memory('${definition.id}')`,
    );
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
   * ## What the DEFAULT buys you, and what it does not
   *
   * `.outputSchema(parser)` on its own means **judge, do not re-ask**: the
   * prompt gets the instruction, the answer is validated in the loop, and a
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
   *     fetch what it guessed). Survivors ship flagged. **This is the
   *     recommended posture for a weaker model.**
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
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .tool(showInterface)
   *     .namesAndNumbersFromEvidence({
   *       posture: 'guard',
   *       // The default extractor guesses from digits and punctuation; teach
   *       // it your domain's shapes and they are checked by name.
   *       shapes: [{ name: 'wwn', match: /(?:[0-9a-f]{2}:){7}[0-9a-f]{2}/ }],
   *       exempt: ['v9.35.0'],
   *     })
   *     .build();
   */
  namesAndNumbersFromEvidence(opts?: NamesAndNumbersOptions): this {
    if (this.evidenceGate) {
      throw new Error(
        'AgentBuilder.namesAndNumbersFromEvidence: already set. Each agent has at most one ' +
          'evidence gate — pass every shape and exemption in the one call.',
      );
    }
    // Resolved (and refused) HERE rather than at build: a posture typo is a
    // mistake in the line you just wrote, and the stack should say so.
    this.evidenceGate = resolveEvidenceGate(opts);
    return this;
  }

  /**
   * Make the limits of an answer travel WITH the answer (this release).
   *
   * A tool that returns `coverage(verdict, { checked, notChecked,
   * cannotCover })` — or `absent({ what, checked, … })` — declares the ground
   * its result stands on. With this on, the run's declarations are folded into
   * one block and appended to the final answer, so a reader learns whether
   * *"everything looks fine"* means **verified** or **unexamined**.
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
   * @example
   *   const agent = Agent.create({ provider, model })
   *     .tool(replicationHealth)   // returns coverage(verdict, { … })
   *     .limitsTravelWithTheAnswer()
   *     .build();
   */
  limitsTravelWithTheAnswer(): this {
    // Refused rather than shrugged at, like every other one-per-agent policy
    // (`toolsFromActiveSkill` verbatim): a second call means the author
    // believes there are two of these to set, and the honest answer is that
    // there is one boundary block per answer.
    if (this.limitsTravelValue) {
      throw new Error(
        'AgentBuilder.limitsTravelWithTheAnswer: already set. One agent appends one coverage ' +
          'block to one answer, folded from every declaration its tools made — so a second ' +
          'call has nothing left to say. Drop it.',
      );
    }
    this.limitsTravelValue = true;
    return this;
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
   * **Opt-in in 9.x.** The default is unchanged — an agent that never calls
   * this builds byte-identical bytes and emits byte-identical events. The
   * default flips in 10.0.0, the same ledger `skillGraph({ scopeTools })` is on.
   *
   * @example
   *   const skills = await skillsFromDir('./skills', { tools: [lookupOrder, issueRefund] });
   *   const agent = Agent.create({ provider, model })
   *     .skills({ list: () => skills })
   *     .toolsFromActiveSkill()   // billing's tools appear when billing does
   *     .build();
   */
  toolsFromActiveSkill(): this {
    // Refused rather than shrugged at, like every other one-per-agent policy:
    // a second call means the author believes there are two of these to set,
    // and the honest answer is that there is one.
    if (this.toolsFromActiveSkillValue) {
      throw new Error(
        'AgentBuilder.toolsFromActiveSkill: already set. It is one posture for the whole ' +
          "agent — every skill's tools follow that skill's activation — so a second call " +
          'has nothing left to say. Drop it.',
      );
    }
    this.toolsFromActiveSkillValue = true;
    return this;
  }

  outputSchema<T>(parser: OutputSchemaParser<T>, opts?: OutputSchemaOptions): this {
    if (this.outputSchemaParser) {
      throw new Error(
        'AgentBuilder.outputSchema: already set. Each agent has at most one terminal contract.',
      );
    }
    this.outputSchemaParser = parser as OutputSchemaParser<unknown>;
    this.outputSchemaRetries = resolveRetries(opts?.retries);
    this.outputSchemaStrategy = opts?.strategy ?? 'instruct';
    if (opts?.jsonSchema !== undefined) this.outputSchemaJson = opts.jsonSchema;
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
    // The SECOND door into the injection list (`.injection()` is the other), so
    // it records provenance too: without this the id would read as
    // "unattributed" in a later collision — an honest answer, but a worse one
    // than the true "the recipe/app that called .outputSchema() mounted it".
    this.injectionSources.set(id, this.currentSource());
    return this;
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
    if (this.outputFallbackCfg) {
      throw new Error(
        'AgentBuilder.outputFallback: already set. Each agent has at most one fallback chain.',
      );
    }
    this.outputFallbackCfg = {
      fallback: options.fallback as OutputFallbackFn<unknown>,
      ...(options.canned !== undefined && { canned: options.canned as unknown }),
      hasCanned: options.canned !== undefined,
    };
    // The coherence check moved to `build()` in 8.18.0 — see
    // `assertOutputFallbackCoherent`. What it needs (a parser) is a fact about
    // the FINISHED agent, and the builder is a bag of settings in whatever
    // order they were written.
    return this;
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
    const cfg = this.outputFallbackCfg;
    if (cfg === undefined) return;
    if (!this.outputSchemaParser) {
      throw new Error(
        'AgentBuilder.build: .outputFallback() is configured but .outputSchema(parser) is not. ' +
          'A fallback is what happens when the terminal contract is not met, so without a ' +
          'contract there is nothing for it to catch and its tiers can never run. Add ' +
          '.outputSchema(parser) — in either order, they are one setting made of two calls — ' +
          'or drop the fallback.',
      );
    }
    // The safety net must always validate; a `canned` value that does not is a
    // misconfiguration that would only surface AFTER the agent loop had
    // already failed, which is the one moment it exists to survive.
    if (cfg.hasCanned) {
      validateCannedAgainstSchema(
        cfg.canned,
        this.outputSchemaParser as OutputSchemaParser<unknown>,
      );
    }
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
   *   import { ReliabilityFailFastError } from 'agentfootprint/reliability';
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
   * Wire a thinking handler (v2.14+). Three usage patterns:
   *
   *   • OMITTED (default) — framework auto-wires by `provider.name` via
   *     `findThinkingHandler` from the registry. Most consumers using
   *     a shipped provider get thinking support for free.
   *
   *   • EXPLICIT handler — override the auto-wire. For custom providers
   *     or for swapping in a custom Anthropic/OpenAI handler with
   *     different normalization (e.g. redacting blocks before they
   *     land).
   *
   *   • EXPLICIT `null` — opt out entirely. The thinking subflow is NOT
   *     mounted even if the provider would auto-match. Use when you
   *     want to skip thinking parsing for this agent (cost / latency /
   *     UX reasons).
   *
   * Calling twice throws — same shape as `.reliability()` /
   * `.outputSchema()` to enforce single-source intent.
   *
   * @example
   *   // Default — auto-wire AnthropicThinkingHandler for anthropic provider
   *   Agent.create({ provider: anthropic({...}), model: '...' }).build();
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
   * `LLMRequest.thinking = { budget }`. The AnthropicProvider
   * translates to `thinking: { type: 'enabled', budget_tokens: N }`
   * on the wire. The model spends up to `budget` reasoning tokens
   * before producing the visible response.
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
   *   - Anthropic: requires claude-sonnet-4-5 / opus-4-5 (or newer).
   *     Older models reject with HTTP 400.
   *   - OpenAI: ignores. o1/o3 reasoning is selected at the model id
   *     level; this field is a no-op for OpenAIProvider.
   *
   * **Budget guidance:** Anthropic recommends 1024-32000 reasoning
   * tokens. `budget` MUST be less than the request's `max_tokens`
   * (defaults to 4096 in AnthropicProvider — bump via the request
   * `maxTokens` if budget > ~3000).
   *
   * Calling twice throws — same shape as `.reliability()` /
   * `.outputSchema()`.
   *
   * @example
   *   Agent.create({ provider: anthropic({...}), model: 'claude-sonnet-4-5' })
   *     .system('You are a careful reasoning agent.')
   *     .thinking({ budget: 5000 })   // ask Anthropic to think
   *     .build();
   */
  thinking(opts: { budget: number }): this {
    if (this.thinkingBudgetValue !== undefined) {
      throw new Error(
        'AgentBuilder.thinking: already set. Each agent has at most one thinking-budget choice.',
      );
    }
    if (!Number.isFinite(opts.budget) || opts.budget <= 0) {
      throw new Error(
        `AgentBuilder.thinking: budget must be a positive finite number, got ${String(
          opts.budget,
        )}.`,
      );
    }
    this.thinkingBudgetValue = opts.budget;
    return this;
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
    const shaped =
      mw !== null &&
      typeof mw === 'object' &&
      typeof (mw as { name?: unknown }).name === 'string' &&
      (mw as { name: string }).name.length > 0;
    const record = mw as Record<string, unknown> | null;
    const hooks =
      shaped &&
      (typeof record?.onToolCall === 'function' || typeof record?.onToolResult === 'function');
    if (!hooks) {
      throw new Error(
        `AgentBuilder.toolMiddleware: expected an object with a non-empty \`name\` and at ` +
          `least one of \`onToolCall(call)\` (decides about the call) or ` +
          `\`onToolResult(call)\` ` +
          `(decides about the result), got ${typeof mw}. The name is what every ledger row ` +
          `and event says decided the call, so it cannot be blank.`,
      );
    }
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
   * half runs where the final answer is captured, so the record and the caller
   * receive the same string.
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

  /** Shared shape check — a chain built from a typo fails at build time, not
   *  as a silent no-op on the one call that needed governing. */
  private assertMiddleware(mw: unknown, method: string, hook: string): void {
    if (
      mw === null ||
      typeof mw !== 'object' ||
      typeof (mw as { name?: unknown }).name !== 'string' ||
      (mw as { name: string }).name.length === 0 ||
      typeof (mw as Record<string, unknown>)[hook] !== 'function'
    ) {
      throw new Error(
        `AgentBuilder.${method}: expected an object with a non-empty \`name\` and a ` +
          `\`${hook}(...)\` method, got ${typeof mw}. The name is what every ledger row and ` +
          `event says decided the call, so it cannot be blank.`,
      );
    }
  }

  checkIn(opts: CheckInBuilderOptions = {}): this {
    if (this.checkInConfig !== undefined) {
      throw new Error('AgentBuilder.checkIn: already configured. Call it at most once.');
    }
    this.checkInConfig = opts;
    return this;
  }

  selfExplain(opts: SelfExplainOptions = {}): this {
    if (this.selfExplainConfig !== undefined) {
      throw new Error('AgentBuilder.selfExplain: already enabled.');
    }
    if (this.opts.reactMode === 'classic') {
      // Classic ReAct caches the tools slot on turn 1 — a mid-turn skill
      // activation could never surface the trace tools. Fail loud at
      // build-time rather than silently never answering why-questions.
      throw new Error(
        'AgentBuilder.selfExplain: requires per-iteration slot recomposition — ' +
          "reactMode 'classic' caches the tools slot, so the activated trace tools " +
          "would never reach the model. Use the default 'dynamic' mode (or " +
          "'dynamic-grouped'), or use traceDebugAgent() as a separate session instead.",
      );
    }
    this.selfExplainConfig = opts;
    return this;
  }

  /**
   * Resolve what the loop will enforce about the output — or `undefined` when
   * nothing is mounted, which is the default and the byte-identical path.
   *
   * Both refusals live here rather than in `.outputSchema()` because both
   * depend on the WHOLE agent: the tools are registered by other calls that
   * may come after, and `.selfExplain()` attaches its own.
   */
  private resolveOutputEnforcement(): ResolvedOutputEnforcement | undefined {
    const parser = this.outputSchemaParser;
    if (!parser) return undefined;

    let schemaTool;
    if (this.outputSchemaStrategy === 'tool-forced') {
      // Refusal 1 — the strategy and the agent's tools cannot both be true.
      // Forcing the choice BY NAME is what makes the shape a guarantee, and
      // it also means no other tool can be called on any turn: a tool-using
      // agent would quietly become single-shot. That is config that lies in
      // the other direction, so it is refused rather than allowed to happen.
      const toolNames = this.registry.map((entry) => entry.name);
      const skillCount = this.injectionList.filter((i) => i.flavor === 'skill').length;
      const reasons: string[] = [];
      if (toolNames.length > 0)
        reasons.push(`registers ${toolNames.length} tool(s) (${toolNames.join(', ')})`);
      if (this.toolProviderRef !== undefined) reasons.push('has a .toolProvider()');
      if (skillCount > 0)
        reasons.push(`has ${skillCount} skill(s), which reach the model as tools`);
      if (this.selfExplainConfig !== undefined)
        reasons.push('has .selfExplain(), which attaches trace tools');
      if (reasons.length > 0) {
        throw new Error(
          `AgentBuilder.outputSchema: strategy 'tool-forced' forces every answer through ` +
            `the '${SCHEMA_TOOL_NAME}' tool by name, so NO other tool can be called on any ` +
            `turn — and this agent ${reasons.join('; ')}. Rather than let those tools go ` +
            `silently unusable, two honest paths: drop the tools and keep the forced shape, ` +
            `or keep the tools and use { strategy: 'instruct', retries: N } — the corrective ` +
            `loop works on every provider and leaves the agent an agent.`,
        );
      }

      // Refusal 2 — a tool needs its shape, and the library will not invent one.
      const jsonSchema = resolveJsonSchema(parser, this.outputSchemaJson);
      if (jsonSchema === undefined) {
        throw new Error(
          `AgentBuilder.outputSchema: strategy 'tool-forced' puts the schema on the wire as ` +
            `a tool, and a tool carries its shape as JSON Schema. This parser does not offer ` +
            `one (no \`toJsonSchema()\` method), and a \`parse()\` function is not something ` +
            `the library gets to guess a shape from. Pass it: .outputSchema(parser, ` +
            `{ strategy: 'tool-forced', jsonSchema: { type: 'object', properties: { … } } }).`,
        );
      }
      schemaTool = buildSchemaTool(jsonSchema, parser.description);
    }

    // Mounted whenever a parser exists (8.18.0). Until then, `retries: 0` —
    // the DEFAULT, and what `.outputSchema(parser)` means on its own — returned
    // `undefined` here: no judging in the loop, no `outputAttempts` row, no
    // event, a chart byte-identical to an agent with no contract at all. The
    // declaration bought a prompt sentence and a `runTyped()` parse, and a
    // caller on `run()` could not tell from the record that a contract had ever
    // been declared, let alone missed.
    //
    // `0` still mounts no retry BRANCH (see buildAgentChart) and still spends
    // no extra turn. It means judge, do not re-ask.
    return {
      parser,
      retries: this.outputSchemaRetries,
      ...(schemaTool !== undefined && { schemaTool }),
      hasFallback: this.outputFallbackCfg !== undefined,
    };
  }

  build(): Agent {
    // Settings that are only coherent (or not) once the whole agent exists.
    this.assertOutputFallbackCoherent();
    // Resolve the voice config: bundled defaults + consumer overrides.
    // Templates flow through the same barrel exports the rest of the
    // library uses, so a future locale-pack swap is a single import.
    const voice = {
      appName: this.appNameValue,
      commentaryTemplates: { ...defaultCommentaryTemplates, ...this.commentaryOverrides },
      thinkingTemplates: { ...defaultStatusTemplates, ...this.thinkingOverrides },
    };
    const opts =
      this.maxIterationsOverride !== undefined
        ? { ...this.opts, maxIterations: this.maxIterationsOverride }
        : this.opts;
    // .selfExplain(): a fresh binding per build() — two built agents never
    // share evidence. One mounted skill (methodology body only) + the trace
    // tools on a skill-scoped ToolProvider composed with the consumer's own,
    // so the catalog gains them ONLY on the activated iteration.
    //
    // Name reservation (mirrors the read_skill rule): the tools slot dedupes
    // by name with first-occurrence-wins and the static registry merges
    // FIRST — a consumer tool named like a trace tool would silently shadow
    // it, and the skill body would instruct the model into the wrong tool.
    if (this.selfExplainConfig) {
      // Inline mode reserves whatever the pack can mount — read from
      // `TRACE_TOOL_NAMES` rather than retyped here, so a tool added to the
      // pack is reserved the same day it ships. Delegate mode mounts one
      // tool and reserves one name.
      const reserved: readonly string[] = this.selfExplainConfig.delegate
        ? ['explain_run']
        : TRACE_TOOL_NAMES;
      const clash = this.registry.find((entry) => reserved.includes(entry.name));
      if (clash) {
        throw new Error(
          `AgentBuilder.selfExplain: tool name '${clash.name}' is reserved by .selfExplain() ` +
            `(${this.selfExplainConfig.delegate ? 'delegate' : 'inline'} mode). The tools slot ` +
            `dedupes by name (first wins), so your tool would silently shadow the trace tool. ` +
            `Rename it, or reserved names: ${reserved.join(', ')}.`,
        );
      }
    }
    const selfExplainBinding = this.selfExplainConfig
      ? new SelfExplainBinding(this.selfExplainConfig.include, this.selfExplainConfig.maxEvents)
      : undefined;
    let injections = selfExplainBinding
      ? [...this.injectionList, buildSelfExplainSkill(this.selfExplainConfig!)]
      : this.injectionList;
    // The tier-3 menu envelope's system-prompt half (SG-C): auto-registered
    // whenever the mounted graph can produce a MENU verdict — a menu with no
    // envelope would be a decision the model was never told about, the
    // accepted-and-silently-wrong kind. Not under `'rails'` (the model may
    // not act on a menu there), and not when the consumer registered their
    // own (the metadata marker, never the id — a renamed hint still counts).
    // Zero cost when the trigger is false: it reads `ctx.turnRoute`, which
    // only cascade graphs ever write.
    const cascadeForHint = this.skillGraphCascade;
    if (
      cascadeForHint !== undefined &&
      cascadeForHint.strictness !== 'rails' &&
      cascadeForHint.turnRouting !== undefined &&
      (cascadeForHint.turnRouting.scorer !== undefined ||
        cascadeForHint.continuity === 'conversation') &&
      !injections.some(
        (i) => (i.metadata as Record<string, unknown> | undefined)?.[MENU_HINT_METADATA_KEY],
      )
    ) {
      injections = [...injections, defineMenuHint()];
    }
    // ── The tool posture (9.36.0) — `.toolsFromActiveSkill()` ──────────
    // Applied to the FINAL injection list, for the reason every fold on this
    // line uses: skills arrive through `.skill()`, `.skills()`, `.injection()`,
    // `.skillGraph()` and `.selfExplain()`, and only here is the whole agent
    // visible. From this point on there is exactly ONE list, so the registry,
    // the slots, the projection and every recorder read the same stamp.
    // Untouched when the posture was never asked for — the `false` branch does
    // not even walk the list.
    if (this.toolsFromActiveSkillValue) {
      injections = scopeToolsToActiveSkill(injections);
    }
    // ── Steps-as-data check-up + advisory (9.18.0) ─────────────────────
    // Judged on the FINAL injection list (the delivery-refusal reasoning:
    // skills arrive through `.skill()`, `.skillGraph()`, `.skills()` and
    // `.selfExplain()`, and only this line sees all of them). Nothing here
    // runs for an agent without a stepped skill.
    const stepPlans = foldStepPlans(injections);
    if (stepPlans.size > 0) {
      // Classic caches the tools slot after turn 1, so the per-step
      // narrowing and the banner would FREEZE at whatever step was current —
      // sequence enforcement that stops tracking the sequence. Refused, the
      // classic+graph sentence pattern (9.16.0).
      if (this.opts.reactMode === 'classic') {
        const ids = [...stepPlans.keys()].join("', '");
        throw new Error(
          `Agent.build(): reactMode 'classic' cannot honor \`steps\` (declared by '${ids}'). ` +
            `Classic composes the tools slot once on turn 1, so the per-step narrowing and ` +
            `the step banner would freeze at the first step while the procedure moved on — ` +
            `the offer would enforce a sequence it stopped tracking. Use the default ` +
            `'dynamic' mode (or 'dynamic-grouped'), which recomposes the slots every ` +
            `iteration, or drop \`steps\`.`,
        );
      }
      // A decision .tree() never writes a cursor (per-iteration predicate
      // routing — skillGraph's resolver stays the no-op there), and a step
      // procedure's tenure begins only under the cursor. A stepped tree
      // LEAF would slip past the wiring check below — its compiled trigger
      // is 'rule' and it has a predicate edge, so the open-skill clause
      // never fires — and then activate with its FULL toolset: no pointer,
      // no narrowing, no banner, no skip_step, no step event, nothing
      // saying why (accepted-and-silently-wrong, the cardinal sin). Same
      // fate for a stepped skill registered BESIDE the tree: no cursor
      // exists anywhere on a tree agent. Refused for all of them, the
      // continuity×tree sentence pattern (9.17.0).
      if (this.skillGraphIsTree) {
        const ids = [...stepPlans.keys()].join("', '");
        throw new Error(
          `Agent.build(): a decision .tree() cannot honor \`steps\` (declared by '${ids}'). ` +
            `A tree routes by predicate on every iteration and never writes a cursor, and ` +
            `a step procedure's tenure begins only under the cursor — the steps would ` +
            `never engage: no pointer, no narrowing, no banner, no step event. Use the ` +
            `flat entry/route form, register the skill on an agent without a graph, or ` +
            `drop \`steps\`.`,
        );
      }
      const edgeTargets = new Set(this.skillGraphEdgeTargets ?? []);
      for (const [skillId] of stepPlans) {
        const skill = injections.find((i) => i.id === skillId);
        if (!skill) continue;
        if (this.skillGraphNextSkill !== undefined) {
          // A graph is mounted: the tenant is the CURSOR, and the cursor
          // never lands on an OPEN skill (llm-activated + no incoming edge —
          // `Agent.openSkillIds`'s two clauses). Steps on one would activate
          // a body whose procedure never engages: no pointer, no narrowing,
          // no banner, no event, nothing saying why. Refused instead
          // (accepted-and-silently-wrong is the cardinal sin).
          const isOpen = skill.trigger.kind === 'llm-activated' && !edgeTargets.has(skillId);
          if (isOpen) {
            throw new Error(
              `Agent.build(): skill '${skillId}' declares \`steps\`, but the mounted skill ` +
                `graph does not wire it (no entry, no route edge) — it is an OPEN skill, ` +
                `activated by read_skill without ever receiving the cursor, and a step ` +
                `procedure's tenure begins only under the cursor. Its steps would never ` +
                `engage. Wire it into the graph (an entry or a route), register it on an ` +
                `agent without a graph, or drop \`steps\`.`,
            );
          }
        } else if (skill.trigger.kind !== 'llm-activated') {
          // No graph: the tenant is the most recent read_skill activation
          // (the tail of activatedInjectionIds), and ONLY read_skill writes
          // that array — a rule/always-triggered skill would never tenure.
          throw new Error(
            `Agent.build(): skill '${skillId}' declares \`steps\`, but its trigger is ` +
              `'${skill.trigger.kind}' and this agent mounts no skill graph — without a ` +
              `cursor, a procedure's tenure begins at a read_skill activation, which only ` +
              `an 'llm-activated' skill ever gets. Use defineSkill (its trigger is ` +
              `llm-activated), mount a graph that routes to it, or drop \`steps\`.`,
          );
        }
      }
      // Two dev-mode warnings about wiring that is inert rather than wrong.
      if (isDevMode()) {
        const effectiveMax = opts.maxIterations ?? 10;
        for (const plan of stepPlans.values()) {
          // Warn, not refuse: adjacent same-tool steps can advance twice in
          // one batch, so a tight budget CAN still complete a procedure.
          if (plan.steps.length + 1 > effectiveMax) {
            // eslint-disable-next-line no-console
            console.warn(
              `agentfootprint Agent: skill '${plan.skillId}' declares ${plan.steps.length} ` +
                `steps but maxIterations is ${effectiveMax} — the procedure cannot complete ` +
                `in one turn unless steps share a batch. Raise maxIterations, or expect ` +
                `steps_unfinished { action: 'cut-short' } on the record.`,
            );
          }
          const withRefresh = injections.find(
            (i) =>
              i.id === plan.skillId &&
              (i.metadata as { refreshPolicy?: unknown } | undefined)?.refreshPolicy !== undefined,
          );
          if (withRefresh) {
            // eslint-disable-next-line no-console
            console.warn(
              `agentfootprint Agent: skill '${plan.skillId}' sets both \`refreshPolicy\` ` +
                `(deprecated, never read) and \`steps\` — steps supersede it: the banner is ` +
                `re-sent every request and every boundary result names the current step, so ` +
                `re-delivery happens by construction. Drop refreshPolicy.`,
            );
          }
        }
      }
      // The steps advisory (the menu-hint pattern, one block up): a narrowed
      // offer with no explanation would be sequence enforcement the model was
      // never told about. Marker-detected, so a consumer's own hint (any id)
      // stands the default down.
      if (
        !injections.some(
          (i) => (i.metadata as Record<string, unknown> | undefined)?.[STEPS_HINT_METADATA_KEY],
        )
      ) {
        injections = [...injections, defineStepsHint()];
      }
    }
    const toolProvider = selfExplainBinding
      ? buildSelfExplainToolProvider(
          selfExplainBinding,
          this.selfExplainConfig!,
          this.toolProviderRef,
        )
      : this.toolProviderRef;
    // A skill may claim the `read_skill` delivery channel only if `read_skill` is
    // what activates it — otherwise its body reaches the model through no channel at
    // all (8.5.0). Checked HERE, on the final list, for the same reason
    // `resolveOutputEnforcement` lives here: the answer depends on the WHOLE agent.
    // `.skillGraph()` compiles the triggers, `.skill()` may add more after it, and
    // `.selfExplain()` adds one right above — only this line sees all of them.
    const deliveryRefusal = toolOnlyDeliveryRefusal(injections);
    if (deliveryRefusal) throw new Error(deliveryRefusal);
    // Two governance refusals that need the WHOLE agent (8.13.0), for the same
    // reason `resolveOutputEnforcement` and the delivery refusal live here:
    // observers arrive across many `.watch()` calls, and a `checkIn` demand can
    // come from `.tool()` OR from a skill's own tools, which only this line sees
    // assembled.
    assertNoCollidingObserverIds(this.recorderList);
    assertCheckInHasADeclaringTool(
      this.checkInConfig !== undefined,
      this.registry,
      injections,
      toolProvider,
    );
    // Two dev-mode warnings about wiring that is inert rather than wrong (8.7.0).
    // Both need the WHOLE agent — one asks whether a scorer exists, the other pairs a
    // provider against an injection — so both live here, beside the refusal above.
    warnInertRelevanceHint(injections, this.skillGraphScoreEntries !== undefined);
    warnRedundantSkillScopedTools(this.toolProviderRef, injections);
    // The skill graph's DEFERRED body-contract checks run HERE — the one build point
    // that can see the full tool registry. At graph build (without `knownTools`) a
    // body's `lookup_order(id)` is indistinguishable from a typo, because `.tool()`
    // has not run yet; the graph said nothing it could not prove and left its note.
    // The note is collected from the FINAL injection list (each deferred graph skill
    // carries it in its metadata), so the checks run whichever door the skills came
    // through — `.skillGraph(graph)` or `.skills({ list: () => graph.skills })`.
    // The `.skillGraph()` capture is folded in as a fallback for a structurally-typed
    // graph without per-skill stamps; skills found by both are deduped by id, so one
    // problem is reported once. The known set checked now: the agent's registered
    // tool names ∪ `read_skill` (auto-attached whenever a skill exists, so a hand-off
    // hint naming it is not a typo) ∪ every NON-deferred skill's tool names (they
    // exist on this agent; calling them nonexistent would be false) — plus, inside
    // checkSkillContracts, the checked skills' own tools. Runs at most once per built
    // agent, and never when the graph already ran its checks with an explicit
    // `knownTools`: one problem, one report. Baseline `ToolProvider` tools are
    // per-iteration and cannot be enumerated at build time — bodies naming only
    // provider-delivered tools should pass the names via the graph's `knownTools`.
    const deferredByMode = new Map<'throw' | 'warn', Injection[]>();
    const deferredIds = new Set<string>();
    const collectDeferred = (skill: Injection, mode: 'throw' | 'warn'): void => {
      if (deferredIds.has(skill.id)) return; // metadata + graph note = ONE check
      deferredIds.add(skill.id);
      const group = deferredByMode.get(mode);
      if (group) group.push(skill);
      else deferredByMode.set(mode, [skill]);
    };
    for (const i of injections) {
      const note = (i.metadata as { [SKILL_GRAPH_DEFERRED_CONTRACT_KEY]?: DeferredBodyContract })?.[
        SKILL_GRAPH_DEFERRED_CONTRACT_KEY
      ];
      if (note?.mode === 'throw' || note?.mode === 'warn') collectDeferred(i, note.mode);
    }
    if (this.skillGraphDeferredBodyContract) {
      const { mode, skills: graphSkills } = this.skillGraphDeferredBodyContract;
      for (const s of graphSkills) collectDeferred(s, mode);
    }
    if (deferredByMode.size > 0) {
      // Tools on skills OUTSIDE the deferred set exist on this agent — baseline,
      // not typos. Tools on deferred skills are added per group by
      // checkSkillContracts itself (own vs known matters for body-foreign-tool).
      const baseKnownTools = [
        ...this.registry.map((entry) => entry.name),
        'read_skill',
        ...injections
          .filter((i) => i.flavor === 'skill' && !deferredIds.has(i.id))
          .flatMap((s) => skillToolNames(s)),
      ];
      // One group per deferring graph's `check` mode — two graphs fed via
      // `.skills()` may disagree, and each is judged by its OWN declared severity.
      for (const [mode, group] of deferredByMode) {
        const groupIds = new Set(group.map((s) => s.id));
        const knownTools = [
          ...baseKnownTools,
          ...[...deferredByMode.values()]
            .flat()
            .filter((s) => !groupIds.has(s.id))
            .flatMap((s) => skillToolNames(s)),
        ];
        const problems = checkSkillContracts(group, { knownTools });
        if (problems.length === 0) continue;
        const report = { ok: !problems.some((p) => p.kind === 'error'), problems };
        // Severity per the GRAPH's own check mode. Both contract checks are
        // warnings today, so `'throw'` and `'warn'` both surface as a dev-mode
        // warning — but an error-kind problem, should one ever exist, honors
        // `'throw'` here exactly as it would have at graph build.
        if (mode === 'throw' && !report.ok) {
          throw new Error(
            `Agent.build(): skill-body ↔ tool-contract check-up failed ` +
              `(deferred from graph build; checked against this agent's full tool ` +
              `registry):\n${formatCheckup(report)}`,
          );
        }
        if (isDevMode()) {
          // eslint-disable-next-line no-console
          console.warn(
            `agentfootprint Agent: skill-graph body-contract check-up (deferred from ` +
              `graph build; checked here against the agent's full tool registry — pass ` +
              `knownTools to skillGraph to run it at graph build instead):\n` +
              formatCheckup(report),
          );
        }
      }
    }
    // ── The artifact vocabularies (SG-F, 9.25.0) ──────────────────────
    // Runs on the FINAL injection list, for the reason every check on this
    // line does: skills arrive through `.skill()`, `.skills()` AND
    // `.skillGraph()`, and only here is the whole agent visible — which is
    // exactly what the satisfiability rule needs ("does ANYTHING on this
    // agent declare it produces this kind?"). A graph that already ran its
    // own checkup re-reports here only if a producer outside the graph was
    // what silenced it, which is the answer the author wants either way.
    //
    // Always a dev-mode WARNING, never a throw, on ANY check mode: the rule
    // reads declarations only and cannot see a store seeded by another agent
    // or an earlier run (`skillVocabulary.ts` states the whole boundary), so
    // failing a build on it would be claiming more than it knows.
    const vocabularyProblems = checkArtifactVocabularies(injections);
    if (vocabularyProblems.length > 0 && isDevMode()) {
      // eslint-disable-next-line no-console
      console.warn(
        `agentfootprint Agent: artifact-vocabulary check-up:\n` +
          formatCheckup({ ok: true, problems: vocabularyProblems }),
      );
    }
    // ── The brains fold (9.19.0) — both declaration homes, one check-up ──
    // Runs on the FINAL injection list for the same reason the delivery
    // refusal does: `defineSkill({ provider })` can arrive through
    // `.skill()`, `.skills()` or `.skillGraph()`, and only this line sees
    // all of them. Undefined — nothing declared anywhere — and the Agent
    // wires nothing new.
    const skillBrains: FoldedSkillBrains | undefined = foldSkillBrains({
      injections,
      ...(this.skillGraphBrainOptions?.providers !== undefined && {
        providers: this.skillGraphBrainOptions.providers,
      }),
      ...(this.skillGraphBrainOptions?.escalation !== undefined && {
        escalation: this.skillGraphBrainOptions.escalation,
      }),
      ...(this.skillGraphBrainOptions?.decider !== undefined && {
        decider: this.skillGraphBrainOptions.decider,
      }),
      graphMounted: this.skillGraphNextSkill !== undefined,
      ...(this.skillGraphNodeIds !== undefined && { nodeIds: this.skillGraphNodeIds }),
      agentProviderName: opts.provider.name,
    });
    // A decider with no menu to resolve: only a graph that RUNS the
    // turn-start cascade (a classifier, or `continuity: 'conversation'`)
    // ever produces an outstanding menu, so a decider on any other mount
    // would be config that never runs — refused rather than silently inert.
    if (skillBrains?.decider !== undefined) {
      const cascade = this.skillGraphCascade;
      const runsCascade =
        cascade !== undefined &&
        cascade.turnRouting !== undefined &&
        (cascade.turnRouting.scorer !== undefined || cascade.continuity === 'conversation');
      if (!runsCascade) {
        throw new Error(
          `Agent.build(): a routing decider is declared, but this mount never runs the ` +
            `turn-start cascade — no menu can ever be outstanding, so the decider would ` +
            `never be consulted. Give the graph a classifier (.classify(...) / start rules ` +
            `with intents) or mount with continuity: 'conversation', or drop \`decider\`.`,
        );
      }
    }
    const agent = new Agent(
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
      this.resolveOutputEnforcement(),
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
    );
    // Attach the observers collected by `.watch()` so they receive events
    // from the very first run. Mirrors what consumers would do post-build
    // via `agent.attach(rec)`; the builder method is purely sugar over it,
    // which is what makes `.watch()` provably the same attachment.
    for (const observer of this.recorderList) {
      agent.attach(observer);
    }
    if (selfExplainBinding) {
      // Late binding: capture fires at each run's terminal flush, when
      // getLastSnapshot() IS the just-completed run (never in-flight).
      //
      // All THREE sources in one call, because a turn's evidence is three
      // things that a snapshot alone does not carry: what happened
      // (snapshot), how it read in English (narrative), and when each tool
      // call started and ended (events — the commit log has no clock).
      //
      // …plus a FOURTH when any mounted tool keeps a record of its own run
      // (`flowchartAsTool({ keepRecord: true })`). Collected here rather
      // than resolved per call because the store is a LIVE object owned by
      // the tool: the binding holds the lookup, and every record the tool
      // files after this point is visible through it.
      const innerRuns = collectInnerRuns(this.registry, injections);
      selfExplainBinding.bindTo({
        getSnapshot: () => agent.getLastSnapshot(),
        getNarrative: () => agent.getLastNarrativeEntries(),
        on: (type, listener) => agent.on(type, listener),
        ...(innerRuns !== undefined && { getInnerRuns: () => innerRuns }),
      });
      agent.attach(selfExplainBinding.recorder());
      // …and the agent holds the binding, so `agent.canExplain()` answers
      // from the SAME fact the trace tools answer from rather than from a
      // second guess about whether a turn has completed.
      agent.bindSelfExplain(selfExplainBinding);
    }
    return agent;
  }
}

/**
 * Refuse two DIFFERENT observers that share one id (8.13.0).
 *
 * footprintjs de-duplicates attached recorders by id — `attachScopeRecorder` and
 * `attachFlowRecorder` both `filter(r => r.id !== recorder.id)` before pushing —
 * so of two objects carrying one id, only the LAST ever fires. The first is
 * removed before the run starts and reports nothing at all, which is
 * indistinguishable from an observer whose events simply never happened.
 *
 * Keyed on OBJECT IDENTITY, not on the id alone. Handing the same reference to
 * `.watch()` twice is
 * harmless and stays one attachment — the fp dedupe is doing exactly what it is
 * for. It is two DIFFERENT observers under one name that loses a whole observer.
 *
 * Deliberately does NOT reserve the `agentfootprint.` id prefix: the factories in
 * `agentfootprint/observe` carry ids in that namespace and consumers are meant to
 * `.watch()` them.
 */
function assertNoCollidingObserverIds(observers: readonly Watcher[]): void {
  const byId = new Map<string, Watcher>();
  for (const observer of observers) {
    const id = observer.id;
    const seen = byId.get(id);
    if (seen === undefined) {
      byId.set(id, observer);
      continue;
    }
    if (seen === observer) continue; // same reference — one attachment, by design
    throw new Error(
      `AgentBuilder.watch: two different observers were given the id '${id}'. Only the LAST ` +
        `one ever fires — footprintjs de-duplicates attached recorders by id, so the earlier ` +
        `one is dropped before the first run and reports nothing. Rename one of them; passing ` +
        `the SAME object twice is fine (it stays one attachment).`,
    );
  }
}

/**
 * Refuse `.checkIn({...})` on an agent where no tool can ever trip the gate (8.13.0).
 *
 * `.checkIn()` configures HOW the ask is assembled — the evidence preset, the
 * drivers scorer. What MAKES an ask is a tool declaring `checkIn`. Resolution
 * already defaults (standard evidence + the lexical scorer), so a declaring tool
 * works with no `.checkIn()` call at all; the reverse — `.checkIn()` with nothing
 * that declares — configures the shape of a question that is never asked.
 *
 * Scans BOTH sources the dispatch map is built from (`buildToolRegistry`): the
 * `.tool()` registry and every skill's `inject.tools`, since a skill tool with a
 * `checkIn` demand is a real gate.
 *
 * NOT refused when a `.toolProvider()` is wired. Its tools are resolved per
 * iteration and may declare `checkIn`; build time cannot know, and refusing what
 * it cannot know would break a correct agent.
 */
function assertCheckInHasADeclaringTool(
  configured: boolean,
  registry: readonly ToolRegistryEntry[],
  injections: readonly Injection[],
  toolProvider: ToolProvider | undefined,
): void {
  if (!configured || toolProvider !== undefined) return;
  const declares = (tool: { readonly checkIn?: unknown }): boolean => tool.checkIn !== undefined;
  if (registry.some((entry) => declares(entry.tool))) return;
  for (const injection of injections) {
    for (const tool of injection.inject?.tools ?? []) {
      if (declares(tool as { readonly checkIn?: unknown })) return;
    }
  }
  throw new Error(
    'AgentBuilder.checkIn: configured, but no registered tool declares `checkIn` — so the gate ' +
      'is never consulted, this agent will never pause for consent, and the evidence settings ' +
      'here decide nothing. `.checkIn()` configures HOW the ask is assembled; a tool declaring ' +
      "`checkIn: 'always'` (or a predicate) is what MAKES the ask. Add it to the tool that " +
      "needs consent — defineTool({ …, checkIn: 'always' }) — or drop `.checkIn()`.",
  );
}

/**
 * Gather the inner-run stores of every tool that keeps one (8.17.0).
 *
 * A `flowchartAsTool({ keepRecord: true })` carries its store on the tool
 * object under a registry symbol. This finds them so `.selfExplain()` can
 * hand one merged lookup to the trace artifacts — the consumer wires
 * nothing; mounting the tool and calling `.selfExplain()` is the whole
 * configuration.
 *
 * Two sources, both known at build time: the static registry (`.tool()` /
 * `.tools()`) and skill-declared tools. A tool arriving from a
 * `.toolProvider()` is deliberately NOT collected — provider tools are
 * resolved per iteration against a live context, so there is no build-time
 * moment at which the list exists. `inspect_tool_run` then answers with the
 * honest-absence arm, which names `keepRecord`; a consumer in that position
 * should register the chart tool statically as well.
 */
function collectInnerRuns(
  registry: readonly ToolRegistryEntry[],
  injections: readonly Injection[],
): InnerRunLookup | undefined {
  const found: InnerRunLookup[] = [];
  const take = (candidate: unknown): void => {
    const store = innerRunsOf(candidate);
    if (store !== undefined && !found.includes(store)) found.push(store);
  };
  for (const entry of registry) take(entry.tool);
  for (const injection of injections) {
    for (const tool of injection.inject?.tools ?? []) take(tool);
  }
  return mergeInnerRuns(found);
}

/**
 * Refuse an `llm-activated` trigger whose `viaToolName` is not `'read_skill'` (8.7.0).
 *
 * `viaToolName` reads as a promise the library never kept: name a tool, and that tool
 * activates the skill. No such tool has ever been created. The one consumer of an
 * `llm-activated` trigger is the evaluator, which matches on
 * `ctx.activatedInjectionIds.includes(inj.id)` and never looks at the field
 * (`evaluator.ts`); the only writer of that array is `read_skill`. So a skill carrying
 * `viaToolName: 'open_playbook'` activated by `read_skill` exactly like every other
 * skill, and the declaration meant nothing at all — a configuration that was never
 * read is worse than one that is refused, because it looks like it worked.
 *
 * Refused HERE because `injection()` is the one funnel every flavor passes through:
 * `defineSkill`, `skillsFromDir`, `.skill()`, `.skills(registry)`, `.skillGraph()`
 * and a hand-built Injection all arrive at this line.
 *
 * 9.0.0 removed the `viaToolName` OPTION from `defineSkill` and `skillsFromDir`
 * (both now refuse it by name at the factory), but the TRIGGER field stays and so
 * does this check: a hand-built `Injection` literal can still carry an
 * `llm-activated` trigger with any string in it, and that is the one path with no
 * factory in front of it.
 */
function assertReadSkillActivation(injection: Injection): void {
  const trigger = injection.trigger;
  if (trigger.kind !== 'llm-activated') return;
  if (trigger.viaToolName === 'read_skill') return;
  throw new Error(
    `Agent.injection('${injection.id}'): viaToolName is '${trigger.viaToolName}', but ` +
      `'read_skill' is the only activation tool this library builds — nothing reads the field, ` +
      `and no tool named '${trigger.viaToolName}' is ever offered to the model. This skill would ` +
      `have activated through read_skill like every other one, so the name was decoration on a ` +
      `door that does not exist. Drop \`viaToolName\` (skills already share one activation tool ` +
      `and the model picks WHICH skill by id), or gate the skill on something the engine does ` +
      `read — a \`rule\` trigger, or a skillGraph() edge. The \`viaToolName\` OPTION on ` +
      `defineSkill()/skillsFromDir() was removed in 9.0.0; this trigger field is all that ` +
      `is left, and only a hand-built Injection can still set it.`,
  );
}

/**
 * Dev-warn a `defineRelevanceHint()` mounted where no scorer can feed it (8.7.0).
 *
 * The hint's trigger reads `ctx.entryScores`, and only the PickEntry stage writes it
 * — which runs only when the graph was built with `.entryBy()` / `.entryByRelevance()`
 * / `start: { entries, scoredBy | byRelevance }`. Without one, the injection mounts,
 * evaluates false on every iteration for the life of the agent, and reports nothing:
 * a feature that is configured and inert looks exactly like a feature that is working
 * and simply has not been needed yet.
 *
 * Keyed on the `readsEntryScores` metadata marker, not on the id — the id is the
 * caller's to rename.
 */
function warnInertRelevanceHint(injections: readonly Injection[], hasScorer: boolean): void {
  if (hasScorer || !isDevMode()) return;
  for (const inj of injections) {
    const meta = inj.metadata as Record<string, unknown> | undefined;
    if (meta?.[READS_ENTRY_SCORES_METADATA_KEY] !== true) continue;
    // eslint-disable-next-line no-console
    console.warn(
      `agentfootprint Agent: injection '${inj.id}' reads ctx.entryScores, which only an ENTRY ` +
        `SCORER produces — and this agent's skill graph has none, so the injection can never ` +
        `activate. Build the graph with .entryBy(keywordScorer()) or .entryByRelevance(embedder) ` +
        `(object form: start: { entries, scoredBy }), or drop the injection. Note .entryByRead() ` +
        `does NOT score — there the model picks, so there is no near-tie to report.`,
    );
  }
}

/**
 * Dev-warn a `skillScopedTools(id, …)` pointed at a skill that already scopes its own
 * tools (8.7.0).
 *
 * `defineSkill({ tools, autoActivate: 'currentSkill' })` already narrows the LLM's
 * tool list to the active skill, with no provider at all — that is what
 * `skillScopedTools`' own header means by "you probably don't need this". Wiring both
 * gives one skill two tool sources keyed on two DIFFERENT signals (the graph's active
 * set vs. the last `read_skill` call), which is how a tool ends up visible on
 * iterations nobody expected — and it is the exact pairing that put a shadowed tool
 * name into a field agent.
 */
function warnRedundantSkillScopedTools(
  provider: ToolProvider | undefined,
  injections: readonly Injection[],
): void {
  if (!isDevMode()) return;
  const target = skillScopedToolsTarget(provider?.id);
  if (target === undefined) return;
  const skill = injections.find((i) => i.id === target);
  if (!skill) return;
  const meta = skill.metadata as { autoActivate?: string } | undefined;
  if (meta?.autoActivate !== 'currentSkill') return;
  if ((skill.inject?.tools ?? []).length === 0) return;
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint Agent: skillScopedTools('${target}') is wired, but skill '${target}' already ` +
      `carries autoActivate: 'currentSkill' with its own tools:[] — which narrows the tool list ` +
      `to that skill on its own. The two gates key on DIFFERENT signals (the provider on the ` +
      `last read_skill call, the skill on the graph's active set), so a tool can appear on ` +
      `iterations you did not expect, and a name declared on both sides shadows (the model ` +
      `reads the provider's description and the skill's implementation runs). Keep one: the ` +
      `skill's tools:[] if the tools belong to the skill, the provider if they are assembled ` +
      `elsewhere.`,
  );
}

/**
 * Validate `.outputSchema(…, { retries })`.
 *
 * The ceiling is stated rather than left open: a model that has missed the
 * shape ten times in a row is not going to find it on the eleventh, and the
 * run would be spending real money and real iterations discovering that. When
 * ten is not enough the answer is a different schema or a different model,
 * not a longer loop.
 */
function resolveRetries(retries: number | undefined): number {
  if (retries === undefined) return 0;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new Error(
      `AgentBuilder.outputSchema: { retries } must be a non-negative integer, got ${String(
        retries,
      )}. It counts corrective re-asks — 0 (the default) means the first answer is the only one.`,
    );
  }
  if (retries > MAX_OUTPUT_RETRIES) {
    throw new Error(
      `AgentBuilder.outputSchema: { retries: ${retries} } exceeds the ceiling of ` +
        `${MAX_OUTPUT_RETRIES}. Each retry is a real turn — a real request, real tokens, real ` +
        `money — and a model that has missed the shape ${MAX_OUTPUT_RETRIES} times running is ` +
        `not about to find it. If that is genuinely not enough, the fix is a simpler schema, a ` +
        `clearer instruction, or a different model.`,
    );
  }
  return retries;
}

/** The stated ceiling on corrective re-asks. See {@link resolveRetries}. */
const MAX_OUTPUT_RETRIES = 10;

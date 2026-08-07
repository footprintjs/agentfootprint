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
import {
  validateCannedAgainstSchema,
  type OutputFallbackFn,
  type OutputFallbackOptions,
  type ResolvedOutputFallback,
} from '../outputFallback.js';
import type { CachePolicy, CacheStrategy } from '../../cache/types.js';
import type { Injection, InjectionContext } from '../../lib/injection-engine/types.js';
import type { CursorMove, EntryScoring } from '../../lib/injection-engine/skillGraph.js';
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
import { TRACE_TOOL_NAMES } from '../../lib/trace-toolpack/traceToolpack.js';
import { Agent } from '../Agent.js';
import type { AgentOptions, RunConfigFn } from './types.js';
import type { CompactionOptions } from './window/types.js';
import type { WindowStrategy } from './window/strategy.js';
import type { LLMProvider } from '../../adapters/types.js';
import type { MessageMiddleware, ToolMiddleware } from './middleware/types.js';
import { resolveAct, type ActOptions } from './act.js';
import { resolveCompactionOptions } from './window/options.js';
import { summarizeOldest } from './window/strategies/summarizeOldest.js';

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
  private readonly memoryList: MemoryDefinition[] = [];
  /**
   * Optional terminal contract — see `outputSchema()`. Stored on the
   * builder, propagated to the Agent at `.build()` time.
   */
  private outputSchemaParser?: OutputSchemaParser<unknown>;
  /** Corrective re-asks the loop may spend. `0` (the default) means the
   *  schema is judged once, at the caller's boundary, exactly as it always
   *  was — and no enforcement is mounted in the chart at all. */
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
   * Observers collected via `.watch()` (or its deprecated spelling
   * `.recorder()`). Attached to the built Agent before `build()` returns
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
  /** The tool-dispatch chain, in call order. Empty = no chain, no ledger. */
  private toolMiddlewareList: readonly ToolMiddleware[] = [];
  /** The message chain, in call order. Empty = no chain, no ledger. */
  private messageMiddlewareList: readonly MessageMiddleware[] = [];
  /** `.act()` is the posture block: one per agent. See the method. */
  private actCalled = false;

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
   * Checked at BOTH doors. `.compaction({...})` and `.window(summarizeOldest({...}))`
   * are the same policy, and a rule that only one of them enforces is advice.
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
        `Fix, one word: give the summarizer its OWN instance — \`summarizer: anthropic()\` ` +
        `rather than the variable you passed to Agent.create. That also stops the two roles ` +
        `sharing per-instance state. Or name a different (usually cheaper) model.`,
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
    return this;
  }

  /**
   * One window strategy per agent, whichever door set it — a second would
   * silently override the first, and a window policy that quietly changed is
   * a policy you cannot audit.
   */
  private assertNoWindowStrategy(door: 'window' | 'compaction' | 'act'): void {
    const existing = this.windowStrategyValue;
    if (existing === undefined) return;
    if (door === 'act') {
      throw new Error(
        `AgentBuilder.act: this agent already has a window strategy ('${existing.name}'), set ` +
          'by .window() or .compaction(). One window strategy per agent, whichever door set ' +
          'it — a second would silently override the first, and a window policy that quietly ' +
          'changed is a policy you cannot audit. Move it into the `window` key, or drop the key.',
      );
    }
    if (door === 'compaction') {
      throw new Error(
        'AgentBuilder.compaction: already set. One compaction policy per agent — a second ' +
          'one would silently override the first, and a budget that quietly changed is a ' +
          `budget you cannot audit. (This agent's window strategy is '${existing.name}'; ` +
          '`.compaction()` and `.window()` are the same door.)',
      );
    }
    throw new Error(
      `AgentBuilder.window: already set ('${existing.name}'). One window strategy per agent — ` +
        'a second one would silently override the first, and a window policy that quietly ' +
        'changed is a policy you cannot audit. `.compaction()` is the same door with ' +
        'summarizeOldest already in it.',
    );
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
   * Attach a footprintjs `CombinedRecorder` to the built Agent. Wired
   * via `agent.attach(rec)` immediately after construction, so the
   * recorder sees every event from the very first run.
   *
   * @deprecated Since 8.0.0 — use {@link AgentBuilder.watch} instead. Same
   * list, same order, same attachment: `.watch(rec)` is this method under the
   * name the loop already used for it (see `moments.ts` — "an observer
   * reports, a rule changes what happens next"), and it takes more than one.
   * This method keeps working for all of 8.x and is removed in 9.0.0.
   */
  recorder(rec: Watcher): this {
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
      throw new Error(`Agent.injection(): duplicate id '${injection.id}'`);
    }
    for (const msg of injection.inject?.messages ?? []) {
      if (msg.role === 'tool') {
        throw new Error(messagesToolRoleRefusal(`Agent.injection('${injection.id}')`));
      }
    }
    assertReadSkillActivation(injection);
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
   * Mount a declarative **skill graph** (proposal 002) — each skill carries a
   * graph-derived trigger (entry → always/rule, deterministic route → rule /
   * on-tool-return), so dynamic token-efficient loading becomes *declared* and
   * *drawable*. Pure sugar over `.injection()` — `graph.toMermaid()` renders the
   * topology.
   *
   * @example
   *   const graph = skillGraph()
   *     .entry(triage)
   *     .route(triage, sfp, { when: (r) => r.toolName === 'get_counters' && JSON.parse(r.result).crc > 0 })
   *     .build();
   *   Agent.create({ provider }).skillGraph(graph).build();
   */
  skillGraph(graph: {
    skills: readonly Injection[];
    nextSkill: (ctx: InjectionContext) => string | undefined;
    reachableSkills?: (currentSkillId?: string) => readonly string[];
    scoreEntries?: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>;
    /** The declared edges. Read for ONE thing: which skills the graph wires, so the
     *  read_skill gate can tell a skill the graph routes from one it never mentions
     *  (see `openSkillIds` in `build()`). Optional for forward-compat with graphs
     *  built before `edges` existed; absent → the graph wires nothing. */
    edges?: ReadonlyArray<{ readonly to: string }>;
    /** The same cursor resolver, reporting the clause that won (8.5.0). Optional for
     *  forward-compat; absent → no `cursorMove` on `context.evaluated`. */
    explainNextSkill?: (ctx: InjectionContext) => CursorMove;
    /** The entries the cursor law superseded this iteration (8.15.0). Optional for
     *  forward-compat; absent → no `supersededIds` on `context.evaluated`. */
    supersededEntries?: (ctx: InjectionContext) => readonly string[];
    /** The drawn nodes. Read for ONE thing: a `predicate` node means this graph is a
     *  decision `tree()`, which the gate's refusal has to say out loud. Derived here
     *  rather than added to `SkillGraph` as a mode field — the shape is already
     *  public, and one fact should not be declared twice. */
    nodes?: ReadonlyArray<{ readonly kind: string }>;
  }): this {
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

    // No retries and no forced shape → nothing for the loop to do, and no
    // enforcement is mounted. The chart, the events and the commit log are
    // the ones this agent had before the option existed.
    if (this.outputSchemaRetries === 0 && schemaTool === undefined) return undefined;
    return {
      parser,
      retries: this.outputSchemaRetries,
      ...(schemaTool !== undefined && { schemaTool }),
    };
  }

  build(): Agent {
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
    const injections = selfExplainBinding
      ? [...this.injectionList, buildSelfExplainSkill(this.selfExplainConfig!)]
      : this.injectionList;
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
      selfExplainBinding.bindTo({
        getSnapshot: () => agent.getLastSnapshot(),
        getNarrative: () => agent.getLastNarrativeEntries(),
        on: (type, listener) => agent.on(type, listener),
      });
      agent.attach(selfExplainBinding.recorder());
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
 * `.watch()` twice (or to `.watch()` and the deprecated `.recorder()`) is
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
        `the SAME object twice is fine (it stays one attachment). Both \`.watch()\` and the ` +
        `deprecated \`.recorder()\` feed this list.`,
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
 * `defineSkill`, `skillsFromDir({ viaToolName })`, `.skill()`, `.skills(registry)`,
 * `.skillGraph()` and a hand-built Injection all arrive at this line. The option
 * itself is removed in 9.0.0.
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
      `read — a \`rule\` trigger, or a skillGraph() edge. The option is removed in 9.0.0.`,
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

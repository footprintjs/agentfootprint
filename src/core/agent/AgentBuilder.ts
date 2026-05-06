/**
 * AgentBuilder — fluent builder for Agent. Extracted from Agent.ts in
 * v2.11.2 as part of the core/agent decomposition. Same surface, same
 * behavior; just lives in its own file for readability.
 *
 * Re-exported by Agent.ts so external consumers importing
 * `AgentBuilder` from `'../core/Agent.js'` continue to work.
 */

import {
  buildDefaultInstruction,
  type OutputSchemaOptions,
  type OutputSchemaParser,
} from '../outputSchema.js';
import {
  validateCannedAgainstSchema,
  type OutputFallbackFn,
  type OutputFallbackOptions,
  type ResolvedOutputFallback,
} from '../outputFallback.js';
import type { CachePolicy, CacheStrategy } from '../../cache/types.js';
import type { Injection } from '../../lib/injection-engine/types.js';
import { defineInstruction } from '../../lib/injection-engine/factories/defineInstruction.js';
import type { MemoryDefinition } from '../../memory/define.types.js';
import type { ReliabilityConfig } from '../../reliability/types.js';
import type { ThinkingHandler } from '../../thinking/types.js';
import type { Tool, ToolRegistryEntry } from '../tools.js';
import type { ToolProvider } from '../../tool-providers/types.js';
import { defaultCommentaryTemplates } from '../../recorders/observability/commentary/commentaryTemplates.js';
import { defaultThinkingTemplates } from '../../recorders/observability/thinking/thinkingTemplates.js';
import { Agent } from '../Agent.js';
import type { AgentOptions } from './types.js';

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
      this.reliabilityConfig,
      this.thinkingHandlerValue,
      this.thinkingBudgetValue,
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

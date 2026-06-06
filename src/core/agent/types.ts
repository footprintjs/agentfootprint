/**
 * Agent type definitions — both PUBLIC types (AgentOptions, AgentInput,
 * AgentOutput) consumed by `Agent.create({...}).run({...})` callers AND
 * the INTERNAL `AgentState` shape used by stage functions.
 *
 * These were originally inline in `core/Agent.ts`; extracted here as
 * part of the v2.11.1 decomposition. `core/Agent.ts` re-exports them
 * for back-compat (the 28+ existing import sites continue to work).
 */

import type { StructureRecorder } from 'footprintjs';
import type { GroupTranslator } from '../translator.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMToolSchema,
  PermissionChecker,
  PricingTable,
} from '../../adapters/types.js';
import type { CacheMarker, CacheStrategy } from '../../cache/types.js';
import type { ActiveInjection } from '../../lib/injection-engine/types.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import type { MemoryIdentity } from '../../memory/identity/types.js';
import type { ThinkingBlock } from '../../thinking/types.js';
import type { ReliabilityScope } from '../../reliability/types.js';

// ─── PUBLIC types (consumer-facing) ────────────────────────────────

export interface AgentOptions {
  readonly provider: LLMProvider;
  /** Human-friendly name shown in events/metrics. Default: 'Agent'. */
  readonly name?: string;
  /** Stable id used for topology + events. Default: 'agent'. */
  readonly id?: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Hard budget on ReAct iterations. Default: 10. Hard cap: 50. */
  readonly maxIterations?: number;
  /**
   * Pricing adapter. When set, Agent emits `agentfootprint.cost.tick`
   * after every LLM response (once per ReAct iteration) with per-call
   * and cumulative USD. Run-scoped — the cumulative resets each `.run()`.
   */
  readonly pricingTable?: PricingTable;
  /**
   * Cumulative USD budget per run. With `pricingTable`, Agent emits a
   * one-shot `agentfootprint.cost.limit_hit` (`action: 'warn'`) when
   * cumulative USD crosses this budget. Execution continues — consumers
   * choose whether to abort by listening to the event.
   */
  readonly costBudget?: number;
  /**
   * Permission adapter. When set, the Agent calls
   * `permissionChecker.check({capability: 'tool_call', ...})` BEFORE every
   * `tool.execute()`. Emits `agentfootprint.permission.check` with the
   * decision. On `deny`, the tool is skipped and its result is a
   * synthetic denial string; on `allow` / `gate_open`, execution proceeds
   * normally.
   */
  readonly permissionChecker?: PermissionChecker;
  /**
   * Global cache kill switch (v2.6+). `'off'` disables the cache
   * layer entirely — the CacheGate decider routes to `'no-markers'`
   * every iteration regardless of other rules. Default: caching
   * enabled (auto-resolved per provider via the strategy registry).
   *
   * Use `'off'` for low-frequency agents (cron jobs running once per
   * hour) where the cache TTL guarantees zero cache hits and the
   * cache-write penalty isn't worth paying.
   */
  readonly caching?: 'off';
  /**
   * Optional explicit CacheStrategy override (v2.6+). Defaults to
   * `getDefaultCacheStrategy(provider.name)` — so Anthropic/OpenAI/
   * Bedrock/Mock providers auto-resolve to their respective strategies
   * once those land in Phase 7+.
   */
  readonly cacheStrategy?: CacheStrategy;
  /**
   * Optional build-time recorders threaded into footprintjs's
   * `flowChart()` factory. Each recorder fires `onStageAdded` once per
   * node in the Agent's internal chart (Seed, CallLLM, Route, tool
   * handler, slot mounts, PrepareFinal, BreakFinal), and
   * `onSubflowMounted` once per mounted subflow. Recorders own their
   * own accumulators — agentfootprint just threads them through.
   *
   * Cascade: each slot subflow (system-prompt, messages, tools)
   * was built earlier with its OWN recorders (or none).
   * footprintjs does NOT propagate StructureRecorders into mounted
   * subflows — attach the same recorders to every nested composition
   * for full coverage.
   *
   * When omitted, no build-time observation is wired up.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
  /**
   * Optional per-COMPOSITION translator (UI-agnostic). See
   * `core/translator.ts`. When attached, `agent.getUIGroup()` invokes
   * it with the Agent's `GroupMetadata` (kind `'Agent'`, id, name,
   * empty `members[]`, plus `extra.slots` and `extra.toolNames`).
   * Tools are not `Runner` instances (they're function executors)
   * so they're conveyed by name in `extra`, not as group members.
   * Returns `undefined` when omitted.
   */
  readonly groupTranslator?: GroupTranslator;
  /**
   * Chart structure for the ReAct loop. Default `'flat'` keeps the
   * historical shape (`buildAgentChart`): the LLM call is a bare
   * `call-llm` STAGE with the slot subflows as its siblings.
   *
   * `'subflow'` wraps the whole LLM turn (injection engine + the 3
   * slots + cache + the call + thinking) in a single `sf-llm-call`
   * SUBFLOW — the SAME boundary the `LLMCall` primitive produces. This
   * is the structurally-correct shape: the LLM invocation IS a subflow,
   * so Lens (and any explainable-ui consumer) renders it as an LLM
   * group with its slots inside, with zero bespoke collapsing. Behaviour
   * is identical to `'flat'`; only the chart's nesting differs.
   *
   * Opt-in while the subflow shape proves out; will become the default
   * once verified end-to-end. See `agent/buildDynamicAgentChart.ts`.
   */
  readonly reactStructure?: 'flat' | 'subflow';

  /**
   * ReAct loop SEMANTICS — how much of the request is re-engineered each
   * iteration. Default `'dynamic'`.
   *
   * `'dynamic'` (default) — every iteration re-runs the InjectionEngine and
   * all three slots (system-prompt ‖ messages ‖ tools), because which
   * injections are active can change per turn (a skill activates, a rule
   * fires, a tool-return triggers something). The loop targets the
   * InjectionEngine. This is the right shape when the agent uses skills,
   * rule/on-tool-return triggers, or any per-turn context steering.
   *
   * `'classic'` — textbook ReAct: context is engineered ONCE. The
   * InjectionEngine, system-prompt and tools run a single time up front;
   * the loop targets only the Messages slot, so each iteration just appends
   * the new tool result and re-calls the LLM. Use this when the system
   * prompt and tool set are fixed for the whole run (the common case). The
   * chart then reads honestly — `ToolCalls → Messages` loops, the static
   * slots sit outside the loop.
   *
   * Both modes produce identical LLM requests for a static agent (no dynamic
   * triggers); `'classic'` just avoids re-computing fixed slots and shows in the
   * chart that only the messages re-run (after turn 1 only the Messages slot
   * lights up). Implementation-wise the chart is the SAME as Dynamic — the only
   * difference is that the Context selector stops re-selecting the system-prompt
   * and tools slots after the first turn, so their outputs are reused.
   *
   * CAVEAT: because the static slots are cached after turn 1, `'classic'` is for
   * agents whose system-prompt + tools are FIXED. If you register skills or
   * dynamic-trigger injections (rule / on-tool-return / llm-activated), an
   * activation that happens mid-run would NOT surface into the cached
   * system-prompt/tools — use `'dynamic'` (the default) for those. Currently
   * `'classic'` uses the flat chart shape (the `reactStructure: 'subflow'`
   * grouping re-seeds context every turn by design, so it stays dynamic-only).
   */
  readonly reactMode?: 'classic' | 'dynamic';
}

export interface AgentInput {
  readonly message: string;

  /**
   * Multi-tenant memory scope. Populated to `scope.identity` so memory
   * subflows registered via `.memory()` can isolate reads/writes per
   * tenant + principal + conversation.
   *
   * Defaults to `{ conversationId: '<runId>' }` when omitted, so agents
   * without memory work unchanged.
   */
  readonly identity?: MemoryIdentity;
}

export type AgentOutput = string;

// ─── INTERNAL state (stage functions) ──────────────────────────────

/**
 * Internal scope state for the Agent's flowchart. Recorders never read
 * this directly — they read the InjectionRecord convention keys + emit
 * events. Each stage function under `./stages/` receives a TypedScope
 * over this shape and reads/writes via typed properties.
 *
 * Mutability conventions (followed by every Agent stage):
 *   • Per-iteration scalars (iteration, finalContent, llmLatestContent,
 *     etc.) are OVERWRITTEN each pass; commitLog preserves history.
 *   • Cumulative scalars (cumTokensInput, totalInputTokens, turnNumber)
 *     accumulate monotonically across the run.
 *   • Arrays from slot subflows (systemPromptInjections,
 *     messagesInjections, toolsInjections, dynamicToolSchemas,
 *     cacheMarkers) use `arrayMerge: ArrayMergeMode.Replace` semantics —
 *     each iteration's value REPLACES the prior iteration's, not
 *     appends.
 */
export interface AgentState {
  userMessage: string;
  history: readonly LLMMessage[];
  iteration: number;
  maxIterations: number;
  finalContent: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnStartMs: number;
  // Multi-tenant memory scope. Defaulted in seed when AgentInput.identity
  // is omitted, so non-memory agents work unchanged. Field is named
  // `runIdentity` (not `identity`) so it doesn't collide with the
  // readonly `identity` input arg in scope's typed-args view.
  runIdentity: MemoryIdentity;
  // Set during the final branch — the (user, assistant) pair the
  // memory write subflows persist for cross-run recall.
  newMessages: readonly LLMMessage[];
  // Turn counter — incremented per agent.run(). Memory writes tag
  // entries with this so retrieval can show "recalled from turn 5".
  turnNumber: number;
  // Token-budget signal used by memory pickByBudget deciders. Defaults
  // to a permissive cap; consumers tune via PricingTable hooks later.
  contextTokensRemaining: number;
  // Populated by slot subflow outputMappers:
  systemPromptInjections: readonly InjectionRecord[];
  messagesInjections: readonly InjectionRecord[];
  toolsInjections: readonly InjectionRecord[];
  // Latest LLM response state:
  llmLatestContent: string;
  llmLatestToolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  }[];
  // Pause checkpoint — set when a tool calls `pauseHere()`, consumed on resume.
  pausedToolCallId: string;
  pausedToolName: string;
  pausedToolStartMs: number;
  // Cost accounting (only used when pricingTable is set).
  cumTokensInput: number;
  cumTokensOutput: number;
  cumEstimatedUsd: number;
  costBudgetHit: boolean;
  // Injection Engine state ─────────────────────────────────────
  /** Active set output by InjectionEngine subflow each iteration —
   *  POJO projections (no functions) suitable for scope round-trip. */
  activeInjections: readonly ActiveInjection[];
  /** IDs of LLM-activated Skills the LLM has activated this turn
   *  (via the `read_skill` tool). InjectionEngine matches by id. */
  activatedInjectionIds: readonly string[];
  /** Most recent tool result — drives `on-tool-return` triggers. */
  lastToolResult?: { toolName: string; result: string };
  /** Tool schemas resolved by the tools slot subflow each iteration
   *  (registry + injection-supplied). Used by callLLM. */
  dynamicToolSchemas: readonly LLMToolSchema[];
  // ── Cache layer state (v2.6) ────────────────────────────────
  /** Provider-agnostic cache markers emitted by CacheDecision subflow.
   *  Cleared each iteration by the SkipCaching branch when the
   *  CacheGate decides to skip (kill switch / hit-rate / churn). */
  cacheMarkers: readonly CacheMarker[];
  /** Global cache kill switch from `Agent.create({ caching: 'off' })`. */
  cachingDisabled: boolean;
  /** Running cache hit rate from recent iterations (0..1). Computed
   *  by cacheRecorder (Phase 9); `undefined` until first metrics. */
  recentHitRate: number | undefined;
  /** Rolling window of active-skill IDs across recent iterations.
   *  Maintained by the UpdateSkillHistory function stage; consumed
   *  by CacheGate's skill-churn rule. */
  skillHistory: readonly (string | undefined)[];

  // ── Policy halt state (v2.12) ───────────────────────────────
  /** Set when a `PermissionChecker` returns `{ result: 'halt', ... }`.
   *  `Agent.run()` reads these at the API boundary and throws a typed
   *  `PolicyHaltError` carrying the same context — the chart $break's
   *  graceful termination becomes a runtime signal callers can catch
   *  with `instanceof PolicyHaltError`. Telemetry tag from the rule. */
  policyHaltReason?: string;
  /** Content delivered to the LLM as the synthetic tool_result before
   *  termination — also surfaces on `PolicyHaltError.tellLLM` for
   *  audit / replay. */
  policyHaltTellLLM?: string;
  /** The proposed tool call that triggered the halt (NOT executed). */
  policyHaltTarget?: string;
  policyHaltArgs?: Readonly<Record<string, unknown>>;
  /** ReAct iteration the halt fired on. */
  policyHaltIteration?: number;
  /** Identifier of the PermissionChecker that returned `'halt'`. */
  policyHaltCheckerId?: string;

  // ── Thinking state (v2.14) ─────────────────────────────────
  /** Provider-specific raw thinking data, set by callLLM after the
   *  LLM response lands. The NormalizeThinking sub-subflow reads this
   *  and feeds it to the configured `ThinkingHandler.normalize()`.
   *  Undefined when the provider has no thinking content for this call. */
  rawThinking?: unknown;
  /** Normalized thinking blocks from the most recent LLM response.
   *  Written by the NormalizeThinking sub-subflow; read by toolCalls.ts
   *  + prepareFinal.ts when constructing the assistant message for
   *  `scope.history` (ensures Anthropic signature round-trip). Empty
   *  array when no thinking present. */
  thinkingBlocks: readonly ThinkingBlock[];

  // ── Reliability fail-fast state (v2.11.5) ──────────────────
  /** Set when the rules-based reliability loop takes the fail-fast path.
   *  `Agent.run()` reads these from the post-run snapshot and throws a
   *  typed `ReliabilityFailFastError`. Mirrors `policyHalt*` — because the
   *  loop stops the chart with `$break` (not a throw), durable scope is the
   *  only courier of the structured fail context across the break to the
   *  API boundary. (Telemetry ALSO fires via the `reliability.fail_fast`
   *  emit event; these scope fields are the business-logic control signal.) */
  reliabilityFailKind?: string;
  reliabilityFailPayload?: ReliabilityScope['failPayload'];
  reliabilityFailReason?: string;
  /** Originating error message/name — stringified because Error objects
   *  don't survive footprintjs's `structuredClone` of scope. */
  reliabilityFailCauseMessage?: string;
  reliabilityFailCauseName?: string;
}

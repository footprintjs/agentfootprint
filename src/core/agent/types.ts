/**
 * Agent type definitions — both PUBLIC types (AgentOptions, AgentInput,
 * AgentOutput) consumed by `Agent.create({...}).run({...})` callers AND
 * the INTERNAL `AgentState` shape used by stage functions.
 *
 * These were originally inline in `core/Agent.ts`; extracted here as
 * part of the v2.11.1 decomposition. `core/Agent.ts` re-exports them
 * for back-compat (the 28+ existing import sites continue to work).
 */

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
}

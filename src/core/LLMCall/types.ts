import type { StructureRecorder } from 'footprintjs';
import type { GroupTranslator } from '../translator.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import type { LLMProvider, PricingTable } from '../../provider-contract/types.js';
import type { Receipt } from '.././agent/receipt/receipt.js';
import type { ThinkingBlock } from '../../thinking/types.js';

export interface LLMCallOptions {
  readonly provider: LLMProvider;
  /** Human-friendly name shown in events/metrics. Default: 'LLMCall'. */
  readonly name?: string;
  /** Stable id used for topology + events. Default: 'llm-call'. */
  readonly id?: string;
  /** Model to request from the provider. */
  readonly model: string;
  /** Optional sampling temperature. */
  readonly temperature?: number;
  /** Optional max output tokens. */
  readonly maxTokens?: number;
  /**
   * Per-slot context budgets, in characters (8.11.0). The LLMCall twin of
   * `AgentOptions.contextBudget` — two slots here, since an LLMCall has no
   * tools slot.
   *
   * Each slot warns (and emits `agentfootprint.context.budget_pressure`) when
   * it composes over its budget. **Nothing is truncated** — the full content
   * still reaches the LLM; the budget is a signal, not a limiter. Defaults:
   * `systemPrompt` 4000, `messages` 10000.
   */
  readonly contextBudget?: {
    readonly systemPrompt?: number;
    readonly messages?: number;
  };
  /**
   * Record the ASSEMBLED system prompt on the LLM call (9.50.0). The LLMCall
   * twin of `AgentOptions.recordSystemPrompt` — same field, same contract,
   * same default. **Opt-in, default OFF**: when `true`,
   * `agentfootprint.stream.llm_start` carries `systemPromptText`, the joined
   * prompt verbatim as sent. PRIVACY: with the dial on, the full prompt rides
   * into every recorder, sink and persisted recording — off, only
   * `systemPromptChars` (the length) is on the record.
   */
  readonly recordSystemPrompt?: boolean;
  /**
   * Mint a receipt on the call (9.91.0). Default ON — the LLMCall twin of
   * `AgentOptions.recordReceipt`, same field, same contract, same default.
   *
   * A receipt is the fingerprint of what the model was actually handed,
   * committed at the call so a reader can check the rebuilt view against it.
   * `false` declines it, for the reason the agent's switch exists: the mint is
   * a SHA-256 per system piece, per message and per tool schema, plus one
   * commit-log value. Declining does not make the log unreadable — `servedAt`
   * still rebuilds the view; what is gone is the witness, and `servedAt` says
   * so with the same gap a pre-9.88 recording raises.
   *
   * @example decline the receipt in a bulk eval loop
   *   new LLMCall({ provider, model, recordReceipt: false })
   */
  readonly recordReceipt?: boolean;
  /**
   * Pricing adapter. When set, LLMCall emits `agentfootprint.cost.tick`
   * after every LLM response with per-call and cumulative USD. Run-scoped
   * — the cumulative resets on each `.run()`.
   */
  readonly pricingTable?: PricingTable;
  /**
   * Cumulative USD budget per run. When provided along with `pricingTable`,
   * LLMCall emits `agentfootprint.cost.limit_hit` with `action: 'warn'`
   * the first time cumulative USD crosses the budget. Execution continues
   * — consumers choose whether to abort by listening to the event.
   *
   * The object form `{ usd, onExceed }` is accepted for symmetry with `Agent`,
   * but `onExceed` must be `'warn'` here: halting means "stop at the next
   * iteration boundary", and one call has no next boundary. `'halt'` is
   * refused at build rather than silently ignored.
   */
  readonly costBudget?: number | { readonly usd: number; readonly onExceed: 'warn' | 'halt' };
  /**
   * Optional build-time recorders threaded into footprintjs's
   * `flowChart()` factory. Each recorder observes per-node build
   * events (`onStageAdded` / `onSubflowMounted` / etc.) for this
   * LLMCall's internal chart (Initialize + slot mounts + CallLLM). When
   * omitted, no build-time observation is wired up.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
  /**
   * Optional per-COMPOSITION translator (UI-agnostic). See
   * `core/translator.ts`. When attached, `runner.getUIGroup()` invokes
   * it with the LLMCall's `GroupMetadata` (kind `'LLMCall'`, id, name,
   * empty `members[]`, plus `extra.slots` with the three slot ids —
   * `system-prompt`, `messages`, `tools` — so Lens can render the slot
   * cards inside an LLMCall card without inspecting `buildTimeStructure`).
   * Returns `undefined` when omitted.
   */
  readonly groupTranslator?: GroupTranslator;
}

export interface LLMCallInput {
  readonly message: string;
}

export type LLMCallOutput = string;

/**
 * Internal state shape — what flows through the scope during execution.
 * Not exported; all observation is via events.
 *
 * Note: the OUTER `client` stage carries a subset of these (userMessage,
 * answer, cumulative cost counters). The INNER `sf-llm-call` subflow
 * carries the per-call working fields (injection arrays, rawThinking,
 * thinkingBlocks). inputMapper/outputMapper bridge the two scopes —
 * see `buildChart()` for the exact contract.
 */
export interface LLMCallState {
  userMessage: string;
  /** Set by extract-final once the LLM has responded. Bubbled to the
   *  outer Client scope via outputMapper; Client's break path returns
   *  it as the chart's TraversalResult. */
  answer?: string;
  systemPromptInjections: readonly InjectionRecord[];
  messagesInjections: readonly InjectionRecord[];
  iteration: number;
  /** Raw provider-specific thinking payload set by callLLM, consumed
   *  by sf-thinking when a ThinkingHandler is configured. */
  rawThinking?: unknown;
  /** Normalized thinking blocks written by sf-thinking (when mounted). */
  thinkingBlocks?: readonly ThinkingBlock[];
  /** The receipt minted at the call (9.91.0) — the same key, the same shape
   *  and the same mint the agent's `call-llm` commits, so `receiptAt` reads
   *  one chart's record exactly as it reads the other's. */
  receipt?: Receipt;
  // Cost accounting (only populated when pricingTable is set).
  cumTokensInput: number;
  cumTokensOutput: number;
  cumEstimatedUsd: number;
  costBudgetHit: boolean;
}

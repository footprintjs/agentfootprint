/**
 * window/types — what each window strategy accepts, and what it writes into
 * the ledger.
 *
 * Pattern: Value objects (no behavior) + resolved-config types.
 * Role:    core/ layer. The law this whole folder exists to keep is stated
 *          once, here, because every other file implements a piece of it:
 *          **a window strategy edits the WINDOW, never the LEDGER.**
 * Emits:   N/A (types only).
 *
 * The window is `scope.history` — the array `call-llm` hands the provider.
 * The ledger is footprintjs's commit log, which is append-only: the turns a
 * strategy removes from the window were committed by `seed#0` /
 * `tool-calls#N` BEFORE the removal and stay in those bundles byte-identical
 * forever. A strategy therefore cannot destroy history even in principle; it
 * can only stop re-sending it. A summary is a CLAIM about the past, so it is
 * filed as a claim — its own recorded step, naming every `runtimeStageId` it
 * folded. A drop is an ABSENCE, and it is filed the same way: the record and
 * the eviction events name what left, by id.
 */

import type { LLMProvider } from '../../../adapters/types.js';

// ─────────────────────────────────────────────────────────────────
// Refusals — shared by every strategy
// ─────────────────────────────────────────────────────────────────

/**
 * Why a turn refused to leave the window. Every one of these is NAMED in the
 * commit — a removal that took less than it could have has to say why, or the
 * next person debugging an oversized window has to guess.
 *
 * The set is closed and shared: the same reason means the same thing under
 * every strategy, because every strategy resolves it through the same
 * function (`refusalFor`, bound into `WindowStrategyInput.planRemoval`).
 */
export type WindowRefusalReason =
  /** The turn holds a `role: 'system'` message. The envelope never leaves. */
  | 'system-envelope'
  /**
   * An assistant `tool_use` in this turn has no matching `tool_result` in the
   * window. Removing an unanswered question destroys the answer's referent —
   * and the referent may still arrive (a paused run resumes).
   */
  | 'unresolved-tool-call'
  /** The turn holds the tool call this run is currently paused on. */
  | 'paused-tool'
  /** The turn holds a tool call waiting on a human check-in decision. */
  | 'pending-check-in'
  /** Inside `keepRecentTurns` — the recent window is never a candidate. */
  | 'inside-keep-window'
  /**
   * The only removable candidate is a summary a previous fold wrote. Folding
   * a summary of a summary with nothing new to add spends a call to lose
   * detail. Only `summarizeOldest` can report this: a drop spends nothing.
   */
  | 'only-existing-summary'
  /** The summarizer threw. No fold this iteration; the window stays big. */
  | 'summarizer-failed'
  /**
   * The REPLACEMENT came back no smaller than the span it would replace, so
   * the removal was abandoned. Both sides are measured in chars — the same
   * unit, an exact comparison, not a token guess.
   *
   * For `summarizeOldest` the replacement is the summary message: folding
   * here would spend a call to make the window BIGGER and lose the detail as
   * well. For the drop strategies it is the authored drop notice that has to
   * take the window's head position (see `DROP_NOTICE_PREFIX`): dropping two
   * tiny turns to insert a longer notice is pure loss, so it does not happen.
   */
  | 'summary-not-smaller';

/** One named refusal, positioned so a reader can find the turn. */
export interface WindowRefusal {
  readonly reason: WindowRefusalReason;
  /** Index of the turn in this iteration's turn segmentation. */
  readonly turnIndex: number;
  /** Index of the turn's first message in the pre-removal window. */
  readonly messageIndex: number;
}

/**
 * @deprecated Renamed to {@link WindowRefusal} in 7.17 — refusals are shared
 * by every window strategy, and only one of them folds. This alias is the
 * same type and is not going away in 7.x.
 */
export type FoldRefusal = WindowRefusal;

/**
 * @deprecated Renamed to {@link WindowRefusalReason} in 7.17. Same values,
 * same meanings; kept as an alias for code written against 7.16.
 */
export type FoldRefusalReason = WindowRefusalReason;

// ─────────────────────────────────────────────────────────────────
// Records — one per visit that engaged, whatever the strategy
// ─────────────────────────────────────────────────────────────────

/**
 * What one visit to the window stage put in the ledger.
 *
 * Every strategy files one of these — including the visits that removed
 * NOTHING, which are the interesting ones. They are appended to
 * `scope.compactions`, so the run's whole window story is one array in the
 * commit log.
 *
 * (`compactions` is the key `.compaction()` shipped with in 7.16 and the key
 * every strategy still writes: it is committed state, which is public surface
 * for anyone reading a run, and renaming it for a better word would break
 * those readers for nothing. It is named for the family's first member.)
 *
 * On `windowChars*` vs tokens: the char counts are EXACT and measured here.
 * There is deliberately no `tokensAfter` — nothing can count the tokens of a
 * window that has not been sent yet, and inventing one would be exactly the
 * guess this family exists to refuse. The honest "after" is the NEXT call's
 * `stream.llm_end` usage.
 */
export interface WindowRecord {
  /**
   * `WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
   * `'sliding-window'`, `'token-budget'`, or your own. Narrow on it.
   */
  readonly strategy: string;
  /** ReAct iteration this visit belongs to. */
  readonly iteration: number;
  /** `runtimeStageId`s of the stages that appended the messages that left. */
  readonly removedStageIds: readonly string[];
  /** How many messages left the window. */
  readonly removedMessageCount: number;
  /** Window size in chars before / after this visit. Exact, and not tokens. */
  readonly windowCharsBefore: number;
  readonly windowCharsAfter: number;
  /** Every turn that refused to leave, named. */
  readonly refusals: readonly WindowRefusal[];
}

/**
 * What one OVER-BUDGET visit to `summarizeOldest` (what `.compaction()`
 * configures) put in the ledger.
 */
export interface CompactionRecord extends WindowRecord {
  /** Adapter-reported input tokens of the last call — what tripped the check. */
  readonly measuredTokens: number;
  /** The budget it was compared against. */
  readonly thresholdTokens: number;
  /** True when the measurement was over budget (a fold was attempted). */
  readonly overBudget: boolean;
  /**
   * @deprecated Use {@link WindowRecord.removedStageIds} — the family name for
   * the same value, published alongside it since 7.17. Both are written.
   */
  readonly foldedStageIds: readonly string[];
  /**
   * @deprecated Use {@link WindowRecord.removedMessageCount} — the family name
   * for the same value, published alongside it since 7.17. Both are written.
   */
  readonly foldedMessageCount: number;
  /** Length of the summary text the summarizer produced (0 when none). */
  readonly summaryChars: number;
  /** What the summarizer call itself cost, when it reported usage. */
  readonly summarizerTokens?: { readonly input: number; readonly output: number };
}

/** What one visit to `slidingWindow` put in the ledger. */
export interface SlidingWindowRecord extends WindowRecord {
  readonly strategy: 'sliding-window';
  /** The configured keep depth this visit measured against. */
  readonly keepRecentTurns: number;
  /** Turns in the window before / after this visit. Counted, not estimated. */
  readonly turnsBefore: number;
  readonly turnsAfter: number;
}

/** What one OVER-BUDGET visit to `tokenBudget` put in the ledger. */
export interface TokenBudgetRecord extends WindowRecord {
  readonly strategy: 'token-budget';
  /** Adapter-reported input tokens of the last call — what tripped the check. */
  readonly measuredTokens: number;
  /** The budget it was compared against. */
  readonly thresholdTokens: number;
  /** True when the measurement was over budget (a drop was attempted). */
  readonly overBudget: boolean;
  /** How many recent turns were off-limits to this visit. */
  readonly keepRecentTurns: number;
}

// ─────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────

/**
 * What `.compaction({...})` — and `summarizeOldest({...})` — accepts.
 *
 * @example
 * ```ts
 * const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
 *   .compaction({
 *     thresholdTokens: 120_000,
 *     summarizer: anthropic(),          // usually the cheap one
 *     model: 'claude-haiku-4-5',
 *     keepRecentTurns: 6,
 *   })
 *   .build();
 * ```
 */
export interface CompactionOptions {
  /**
   * Fold when the LAST call's adapter-reported input tokens exceed this.
   *
   * REQUIRED, with no default. A default budget here would be a number the
   * library invented for a window whose size only the consumer's model and
   * wallet know — and every run would silently inherit it.
   */
  readonly thresholdTokens: number;
  /**
   * How many of the most recent turns are never folded. Default 6.
   *
   * The recent turns are what the model is actually reasoning over; folding
   * them is how a compacting agent loses the thread.
   */
  readonly keepRecentTurns?: number;
  /**
   * The provider that writes the summary. Explicitly chosen — the library
   * never quietly bills your main model for compaction.
   */
  readonly summarizer: LLMProvider;
  /**
   * Model id for the summarizer call. Defaults to the agent's own model, so
   * `summarizer: anthropic()` alone works; name a cheap model to spend less.
   */
  readonly model?: string;
}

/** Resolved form — defaults applied at build time, validated once. */
export interface ResolvedCompaction {
  readonly thresholdTokens: number;
  readonly keepRecentTurns: number;
  readonly summarizer: LLMProvider;
  readonly model: string | undefined;
}

/**
 * What `slidingWindow({...})` accepts.
 *
 * @example
 * ```ts
 * const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
 *   .window(slidingWindow({ keepRecentTurns: 12 }))
 *   .build();
 * ```
 */
export interface SlidingWindowOptions {
  /**
   * How many of the most recent turns stay in the window. Everything older is
   * dropped — unless it refuses by name.
   *
   * REQUIRED, with no default. It *is* the policy: how much past this agent
   * needs is a fact about your agent, not about this library.
   */
  readonly keepRecentTurns: number;
}

/**
 * What `tokenBudget({...})` accepts.
 *
 * @example
 * ```ts
 * const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
 *   .window(tokenBudget({ thresholdTokens: 120_000 }))
 *   .build();
 * ```
 */
export interface TokenBudgetOptions {
  /**
   * Drop when the LAST call's adapter-reported input tokens exceed this.
   *
   * REQUIRED, with no default — the same reason as `.compaction()`: only your
   * model and your bill know the right number.
   */
  readonly thresholdTokens: number;
  /**
   * How many of the most recent turns are never dropped. Default 6.
   */
  readonly keepRecentTurns?: number;
}

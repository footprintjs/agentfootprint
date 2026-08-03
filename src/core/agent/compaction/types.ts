/**
 * compaction/types — the public shape of `.compaction()` and the record it
 * writes into the ledger.
 *
 * Pattern: Value objects (no behavior) + one resolved-config type.
 * Role:    core/ layer. The law this feature exists to keep is stated once,
 *          here, because every other file in this folder implements a piece
 *          of it: **compaction edits the WINDOW, never the LEDGER.**
 * Emits:   N/A (types only).
 *
 * The window is `scope.history` — the array `call-llm` hands the provider.
 * The ledger is footprintjs's commit log, which is append-only: the turns a
 * fold removes from the window were committed by `seed#0` / `tool-calls#N`
 * BEFORE the fold and stay in those bundles byte-identical forever. A fold
 * therefore cannot destroy history even in principle; it can only stop
 * re-sending it. The summary is a CLAIM about the past, so it is filed as a
 * claim — its own recorded step, naming every `runtimeStageId` it folded.
 */

import type { LLMProvider } from '../../../adapters/types.js';

/**
 * What `.compaction({...})` accepts.
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
 * Why a turn refused to fold. Every one of these is NAMED in the commit —
 * a fold that took less than it could have has to say why, or the next
 * person debugging an over-budget window has to guess.
 */
export type FoldRefusalReason =
  /** The turn holds a `role: 'system'` message. The envelope never folds. */
  | 'system-envelope'
  /**
   * An assistant `tool_use` in this turn has no matching `tool_result` in the
   * window. Folding an unanswered question destroys the answer's referent —
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
   * The only foldable candidate is a summary a previous fold wrote. Folding a
   * summary of a summary with nothing new to add spends a call to lose detail.
   */
  | 'only-existing-summary'
  /** The summarizer threw. No fold this iteration; the window stays big. */
  | 'summarizer-failed'
  /**
   * The summary came back no smaller than the span it would replace, so the
   * fold was abandoned. Measured in chars on both sides — the same unit, an
   * exact comparison, not a token guess. Folding here would spend a call to
   * make the window BIGGER and lose the detail as well.
   */
  | 'summary-not-smaller';

/** One named refusal, positioned so a reader can find the turn. */
export interface FoldRefusal {
  readonly reason: FoldRefusalReason;
  /** Index of the turn in this iteration's turn segmentation. */
  readonly turnIndex: number;
  /** Index of the turn's first message in the pre-fold window. */
  readonly messageIndex: number;
}

/**
 * What one visit to the compaction stage put in the ledger. Appended to
 * `scope.compactions`, so the run's whole compaction story is one array in
 * the commit log — including the visits that folded NOTHING, which are the
 * interesting ones.
 *
 * On `windowChars*` vs tokens: the char counts are EXACT and measured here.
 * There is deliberately no `tokensAfter` — nothing can count the tokens of a
 * window that has not been sent yet, and inventing one would be exactly the
 * guess this feature exists to refuse. The honest "after" is the NEXT call's
 * `stream.llm_end` usage.
 */
export interface CompactionRecord {
  /** ReAct iteration this visit belongs to. */
  readonly iteration: number;
  /** Adapter-reported input tokens of the last call — what tripped the check. */
  readonly measuredTokens: number;
  /** The budget it was compared against. */
  readonly thresholdTokens: number;
  /** True when the measurement was over budget (a fold was attempted). */
  readonly overBudget: boolean;
  /** `runtimeStageId`s of the stages that appended the folded messages. */
  readonly foldedStageIds: readonly string[];
  /** How many messages left the window. */
  readonly foldedMessageCount: number;
  /** Window size in chars before / after this visit. Exact, and not tokens. */
  readonly windowCharsBefore: number;
  readonly windowCharsAfter: number;
  /** Length of the summary text the summarizer produced (0 when none). */
  readonly summaryChars: number;
  /** What the summarizer call itself cost, when it reported usage. */
  readonly summarizerTokens?: { readonly input: number; readonly output: number };
  /** Every turn that refused to fold, named. */
  readonly refusals: readonly FoldRefusal[];
}

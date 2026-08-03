/**
 * compaction/strategy — INTERNAL. How a window strategy is shaped.
 *
 * Pattern: Strategy (GoF), deliberately kept private for now.
 * Role:    core/ layer. The compaction stage does the wiring — read the
 *          meter, write the window, emit, record, cost — and delegates the
 *          one interesting question to a strategy:
 *
 *              given the segmented turns, the meter readings, and the
 *              options → what should the window become, and what does the
 *              ledger need to be told about it?
 *
 * Emits:   N/A. A strategy is pure decision + (optionally) its own LLM call;
 *          it never touches scope, never emits, and never writes. That is
 *          what makes it testable without a chart, and what keeps the
 *          "record everything you did" duty in ONE place (the stage) rather
 *          than duplicated per strategy.
 *
 * **Not exported from any barrel, and not part of the public API.** The only
 * shipped implementation is `summarizeOldestStrategy` (what `.compaction()`
 * configures). The interface lives here so that the day a second window
 * strategy is warranted it is an added file rather than a rewrite of the
 * stage — but a seam nobody has used twice is a guess, so it stays private
 * until it has a second implementation to be right about.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import type { MessageOrigin } from '../../../recorders/core/CompactionMeter.js';
import { buildSummaryMessage, isCompactedSummary, runSummarizer } from './summarize.js';
import { planFold, windowChars, type FoldabilityContext, type Turn } from './turns.js';
import type { CompactionRecord, FoldRefusal, ResolvedCompaction } from './types.js';

/** Everything a strategy is allowed to look at. */
export interface WindowStrategyInput {
  /** The window as it stands, detached. */
  readonly history: readonly LLMMessage[];
  /** The same window, segmented into turns. */
  readonly turns: readonly Turn[];
  /** Per-message provenance, aligned index-for-index with `history`. */
  readonly origins: readonly MessageOrigin[];
  /** What the provider REPORTED for the last call. Counted, never guessed. */
  readonly measuredTokens: number;
  /** What must not fold: unanswered calls, the paused tool, a pending check-in. */
  readonly foldability: FoldabilityContext;
  /** The ReAct iteration this decision belongs to. */
  readonly iteration: number;
  /** The run's cancellation signal, when there is one. */
  readonly signal: AbortSignal | undefined;
  /** Wall clock, injectable so a caller can pin `survivalMs`. */
  readonly now: () => number;
}

/** One message leaving the window, with the facts an eviction event needs. */
export interface WindowEviction {
  /** Index in the PRE-change window — the index the content hash was built on. */
  readonly index: number;
  /** How long it lived in the window. Exact; 0 when its birth is unknown. */
  readonly survivalMs: number;
}

/** What the stage should do next. Everything is optional except the record. */
export interface WindowStrategyResult {
  /** The new window. Absent = leave the window alone. */
  readonly window?: readonly LLMMessage[];
  /**
   * How the meter must re-align its provenance to the new window, which is
   * `[...head, <one new message>, ...tail]`. Present exactly when `window` is.
   */
  readonly rebase?: { readonly headCount: number; readonly keptTailCount: number };
  /** What the ledger is told. Always present — a visit always explains itself. */
  readonly record: CompactionRecord;
  /** Messages that left the window, for `context.evicted`. */
  readonly evictions: readonly WindowEviction[];
  /** `planAction` for `context.budget_pressure`. */
  readonly planAction: 'summarize' | 'none';
  /** A billed call the strategy made, for the cost channel. */
  readonly spend?: {
    readonly model: string;
    readonly usage: { readonly input: number; readonly output: number };
  };
  /** A one-per-run dev warning the stage should print. */
  readonly warning?: string;
}

/**
 * A window strategy: what the live window should become when it is over
 * budget, and what the record must say about the change.
 */
export interface WindowStrategy {
  /** Stable name — goes nowhere public yet; used in messages and tests. */
  readonly name: string;
  plan(input: WindowStrategyInput): Promise<WindowStrategyResult>;
}

/**
 * The shipped strategy: fold the oldest contiguous run of foldable turns into
 * one summary message, keeping the recent turns and stepping over anything
 * unresolved.
 *
 * Everything it decides, it explains. Every path returns a record — including
 * the paths that change nothing, which are the ones a person debugging an
 * over-budget window actually needs.
 */
export function summarizeOldestStrategy(
  config: ResolvedCompaction,
  defaultModel: string,
): WindowStrategy {
  const model = config.model ?? defaultModel;

  return {
    name: 'summarize-oldest',

    async plan(input: WindowStrategyInput): Promise<WindowStrategyResult> {
      const { history, turns, origins, iteration } = input;
      const charsBefore = windowChars(history);
      const base = {
        iteration,
        measuredTokens: input.measuredTokens,
        thresholdTokens: config.thresholdTokens,
        overBudget: true,
        windowCharsBefore: charsBefore,
      } as const;
      const unchanged = (
        refusals: readonly FoldRefusal[],
        extra: Partial<CompactionRecord> = {},
      ): WindowStrategyResult => ({
        record: {
          ...base,
          foldedStageIds: [],
          foldedMessageCount: 0,
          windowCharsAfter: charsBefore,
          summaryChars: 0,
          refusals,
          ...extra,
        },
        evictions: [],
        planAction: 'none',
      });

      const plan = planFold(turns, config.keepRecentTurns, input.foldability, (turn) =>
        isCompactedSummary(turn.messages[0]),
      );
      if (plan.from === -1) {
        // Nothing foldable. The window stays over budget and the run proceeds
        // — reported, not silently truncated.
        return unchanged(plan.refusals);
      }

      const spanStart = turns[plan.from]!.start;
      const spanEnd = turns[plan.to]!.start + turns[plan.to]!.length;
      const head = history.slice(0, spanStart);
      const span = history.slice(spanStart, spanEnd);
      const tail = history.slice(spanEnd);

      // A broken summarizer must not take down the run.
      let summary: { text: string; usage: { input: number; output: number } };
      try {
        const result = await runSummarizer(config.summarizer, model, span, input.signal);
        summary = {
          text: result.text,
          usage: { input: result.usage.input, output: result.usage.output },
        };
      } catch (err) {
        return {
          ...unchanged([
            { reason: 'summarizer-failed', turnIndex: plan.from, messageIndex: spanStart },
            ...plan.refusals,
          ]),
          warning:
            `the summarizer threw, so nothing was folded this iteration and the window ` +
            `stays over budget (${input.measuredTokens} tokens vs a threshold of ` +
            `${config.thresholdTokens}). The run continues. Cause: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const summaryMessage = buildSummaryMessage(summary.text, {
        foldedMessageCount: span.length,
        iteration,
        model,
      });
      const spend = { model, usage: summary.usage };

      // Would the fold actually help? A summary plus its authored frame can be
      // LONGER than a handful of short turns; folding then spends a call to
      // grow the window and lose detail at the same time. Both sides are
      // measured in chars — one unit, an exact comparison, not a token guess.
      if (summaryMessage.content.length >= windowChars(span)) {
        return {
          ...unchanged(
            [
              { reason: 'summary-not-smaller', turnIndex: plan.from, messageIndex: spanStart },
              ...plan.refusals,
            ],
            { summaryChars: summaryMessage.content.length, summarizerTokens: summary.usage },
          ),
          spend, // the call still happened, so it still counts
        };
      }

      const foldedAtMs = input.now();
      const foldedStageIds: string[] = [];
      const evictions: WindowEviction[] = [];
      for (let i = spanStart; i < spanEnd; i++) {
        const origin = origins[i];
        if (origin !== undefined && !foldedStageIds.includes(origin.stageId)) {
          foldedStageIds.push(origin.stageId);
        }
        evictions.push({
          index: i,
          survivalMs: origin === undefined ? 0 : Math.max(0, foldedAtMs - origin.bornAtMs),
        });
      }

      const window: readonly LLMMessage[] = [...head, summaryMessage, ...tail];
      return {
        window,
        rebase: { headCount: head.length, keptTailCount: tail.length },
        record: {
          ...base,
          foldedStageIds,
          foldedMessageCount: span.length,
          windowCharsAfter: windowChars(window),
          summaryChars: summaryMessage.content.length,
          summarizerTokens: summary.usage,
          refusals: plan.refusals,
        },
        evictions,
        planAction: 'summarize',
        spend,
      };
    },
  };
}

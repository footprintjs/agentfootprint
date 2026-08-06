/**
 * summarizeOldest — fold the oldest foldable turns into one summary message.
 *
 * Pattern: WindowStrategy implementation. Its own module, importing nothing
 *          that registers anything, so a bundle that never mentions it never
 *          carries it (and never carries the summarizer machinery either).
 * Role:    core/ layer.
 * Emits:   N/A — the stage emits, records and costs; this file decides.
 *
 * This is what `.compaction({...})` configures, and the market's familiar
 * move (Claude Code / the Claude Agent SDK call it compaction). What is
 * different here is not the fold — it is that the fold is filed as a claim:
 * a summary is a claim ABOUT the past, and the past itself stays. In the
 * commit log for as long as the process lives, and — since 8.2, under
 * `retain: 'conversation'` — on the conversation checkpoint for as long as
 * the conversation does, which is the half a standing agent actually needs.
 *
 * Everything it decides, it explains. Every engaged path returns a record —
 * including the paths that change nothing, which are the ones a person
 * debugging an over-budget window actually needs.
 */

import { CompactionUnmeasurableError } from '../errors.js';
import { summaryFingerprint } from '../folded.js';
import { resolveCompactionOptions } from '../options.js';
import { indexRange } from '../removal.js';
import type { WindowStrategy, WindowStrategyInput, WindowStrategyResult } from '../strategy.js';
import { buildSummaryMessage, isCompactedSummary, runSummarizer } from '../summarize.js';
import { windowChars } from '../turns.js';
import type { CompactionOptions, CompactionRecord, FoldedSpan, WindowRefusal } from '../types.js';

/** `WindowRecord.strategy` written by every record this strategy files. */
export const SUMMARIZE_OLDEST = 'summarize-oldest';

/**
 * Fold the oldest contiguous run of foldable turns into one summary message,
 * keeping the recent turns and stepping over anything unresolved.
 *
 * Triggered by COUNTED tokens: the last call's adapter-reported input tokens
 * against `thresholdTokens`. A provider that reports no usage gets
 * `CompactionUnmeasurableError` rather than an invented number.
 *
 * @example
 * ```ts
 * import { Agent, summarizeOldest } from 'agentfootprint';
 *
 * const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
 *   .window(summarizeOldest({ thresholdTokens: 120_000, summarizer: anthropic() }))
 *   .build();
 * // `.compaction({ ... })` is this exact line, spelled shorter.
 * ```
 */
export function summarizeOldest(options: CompactionOptions): WindowStrategy {
  const config = resolveCompactionOptions(options, 'summarizeOldest');

  return {
    name: SUMMARIZE_OLDEST,

    async plan(input: WindowStrategyInput): Promise<WindowStrategyResult | undefined> {
      const { history, turns, iteration, measured } = input;

      // Iteration 1: nothing has been sent, so nothing has been counted. A
      // compactor that acted here would be guessing.
      if (measured === undefined) return undefined;
      if (measured.input === 0 && measured.output === 0) {
        throw new CompactionUnmeasurableError(input.providerName);
      }
      if (measured.input <= config.thresholdTokens) return undefined;

      const model = config.model ?? input.agentModel;
      const charsBefore = windowChars(history);
      const base = {
        strategy: SUMMARIZE_OLDEST,
        iteration,
        measuredTokens: measured.input,
        thresholdTokens: config.thresholdTokens,
        overBudget: true,
        windowCharsBefore: charsBefore,
      } as const;
      const unchanged = (
        refusals: readonly WindowRefusal[],
        extra: Partial<CompactionRecord> = {},
      ): WindowStrategyResult => ({
        record: {
          ...base,
          removedStageIds: [],
          removedMessageCount: 0,
          foldedStageIds: [],
          foldedMessageCount: 0,
          windowCharsAfter: charsBefore,
          summaryChars: 0,
          refusals,
          ...extra,
        },
        evictions: [],
        budgetPressure: {
          capTokens: config.thresholdTokens,
          projectedTokens: measured.input,
          planAction: 'none',
        },
      });

      const plan = input.planRemoval(config.keepRecentTurns, (turn) =>
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
            `stays over budget (${measured.input} tokens vs a threshold of ` +
            `${config.thresholdTokens}). The run continues. Cause: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const summaryMessage = buildSummaryMessage(summary.text, {
        foldedMessageCount: span.length,
        iteration,
        model,
        retain: config.retain,
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
      const facts = input.removalFacts(indexRange(spanStart, spanEnd), foldedAtMs);
      const window = [...head, summaryMessage, ...tail];

      // The durable half. It rides the SAME result the window change rides,
      // so the stage commits both together — there is no ordering in which
      // the messages leave and the record of what they were does not follow.
      // Under 'discard' the span is still filed: a discard is an absence, and
      // this family files absences the same way it files claims.
      const foldedSpan: FoldedSpan = {
        summaryFingerprint: summaryFingerprint(summaryMessage.content),
        runId: input.runId,
        iteration,
        foldedAtMs,
        model,
        messageCount: span.length,
        removedStageIds: facts.removedStageIds,
        retained: config.retain,
        // Detached before it is handed on: `history` came off a live scope and
        // a stored conversation must never hold a reference into the heap.
        ...(config.retain === 'conversation' && { messages: span.map((m) => ({ ...m })) }),
      };

      const record: CompactionRecord = {
        ...base,
        removedStageIds: facts.removedStageIds,
        removedMessageCount: span.length,
        // The 7.16 names for the two values above, kept and deprecated.
        foldedStageIds: facts.removedStageIds,
        foldedMessageCount: span.length,
        windowCharsAfter: windowChars(window),
        summaryChars: summaryMessage.content.length,
        summarizerTokens: summary.usage,
        refusals: plan.refusals,
      };

      return {
        window,
        rebase: {
          headCount: head.length,
          keptTailCount: tail.length,
          insertedAtMs: foldedAtMs,
        },
        record,
        evictions: facts.evictions,
        folded: [foldedSpan],
        budgetPressure: {
          capTokens: config.thresholdTokens,
          projectedTokens: measured.input,
          planAction: 'summarize',
        },
        spend,
      };
    },
  };
}

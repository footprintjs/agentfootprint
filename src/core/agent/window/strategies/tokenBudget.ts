/**
 * tokenBudget — compaction's trigger discipline, without the summarizer.
 *
 * Pattern: WindowStrategy implementation. Its own module, registering
 *          nothing at import.
 * Role:    core/ layer.
 * Emits:   N/A — the stage emits, records and costs; this file decides.
 *
 * The market's other familiar policy: cap the window at a token budget
 * (Mastra's `TokenLimiter` is the closest sibling). What is different here is
 * the same thing that is different about compaction — the number is COUNTED,
 * never guessed:
 *
 *   • the trigger reads the input tokens the PROVIDER reported for the last
 *     call, not a character estimate and not a divide-by-four heuristic;
 *   • a provider that reports no usage gets `CompactionUnmeasurableError` by
 *     name, the same refusal `.compaction()` makes, rather than an invented
 *     window size or a configured budget that silently never applies.
 *
 * When over budget it drops the oldest contiguous removable span — the same
 * span compaction would have folded, chosen by the same refusal engine — and
 * writes no summary at all. Nothing is claimed about what left, because
 * nothing was read: the record and the eviction events name it, and the
 * commit log still has it verbatim.
 *
 * Use it over `summarizeOldest` when you would rather lose the old turns than
 * pay a summarizer to paraphrase them, and over `slidingWindow` when the
 * thing you are actually defending is a token bill rather than a turn depth.
 */

import { dropOldestSpan } from './drop.js';
import { CompactionUnmeasurableError } from '../errors.js';
import { resolveTokenBudgetOptions } from '../options.js';
import type { WindowStrategy, WindowStrategyInput, WindowStrategyResult } from '../strategy.js';
import type { TokenBudgetOptions, TokenBudgetRecord } from '../types.js';

/** `WindowRecord.strategy` written by every record this strategy files. */
export const TOKEN_BUDGET = 'token-budget';

/**
 * Drop the oldest turns whenever the last call's adapter-reported input
 * tokens exceed `thresholdTokens`.
 *
 * @example
 * ```ts
 * import { Agent, tokenBudget } from 'agentfootprint';
 *
 * const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
 *   .window(tokenBudget({ thresholdTokens: 120_000 }))
 *   .build();
 * ```
 */
export function tokenBudget(options: TokenBudgetOptions): WindowStrategy {
  const config = resolveTokenBudgetOptions(options, 'tokenBudget');

  return {
    name: TOKEN_BUDGET,

    async plan(input: WindowStrategyInput): Promise<WindowStrategyResult | undefined> {
      const { measured } = input;

      // Iteration 1: nothing has been sent, so nothing has been counted.
      if (measured === undefined) return undefined;
      // Counted, not guessed — the same wall compaction hits, by the same name.
      if (measured.input === 0 && measured.output === 0) {
        throw new CompactionUnmeasurableError(input.providerName);
      }
      if (measured.input <= config.thresholdTokens) return undefined;

      const outcome = dropOldestSpan(input, config.keepRecentTurns, TOKEN_BUDGET);
      const record: TokenBudgetRecord = {
        strategy: TOKEN_BUDGET,
        iteration: input.iteration,
        measuredTokens: measured.input,
        thresholdTokens: config.thresholdTokens,
        overBudget: true,
        keepRecentTurns: config.keepRecentTurns,
        removedStageIds: outcome.removedStageIds,
        removedMessageCount: outcome.removedMessageCount,
        windowCharsBefore: outcome.windowCharsBefore,
        windowCharsAfter: outcome.windowCharsAfter,
        refusals: outcome.refusals,
      };

      return {
        ...(outcome.window !== undefined && { window: outcome.window }),
        ...(outcome.rebase !== undefined && { rebase: outcome.rebase }),
        record,
        evictions: outcome.evictions,
        budgetPressure: {
          capTokens: config.thresholdTokens,
          projectedTokens: measured.input,
          planAction: outcome.removedMessageCount > 0 ? 'evict' : 'none',
        },
      };
    },
  };
}

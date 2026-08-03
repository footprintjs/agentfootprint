/**
 * slidingWindow — keep the last N turns, drop what is older.
 *
 * Pattern: WindowStrategy implementation. Its own module, registering
 *          nothing at import.
 * Role:    core/ layer.
 * Emits:   N/A — the stage emits, records and costs; this file decides.
 *
 * The market's simplest window policy (LangChain's `trim_messages`, the
 * "last N messages" every framework ships). Two things are different here:
 *
 *   1. **It refuses by name.** It goes through the SAME turn segmentation and
 *      the SAME refusal engine as compaction, so it will not drop half of a
 *      `tool_use` / `tool_result` pair, will not drop an unanswered tool call
 *      whose answer may still arrive, will not drop the tool a paused run is
 *      waiting on or a pending check-in, and cannot touch the system
 *      envelope. Message-counting trimmers split those pairs and the vendor
 *      rejects the request; this one steps over them and says so in the
 *      record.
 *   2. **It says what it dropped.** Every dropped message is an eviction
 *      event with its measured lifetime, and the record names the stage ids
 *      the messages came from. The turns themselves stay in the commit log,
 *      byte for byte.
 *
 * It triggers on turn COUNT, not tokens — so it needs no summarizer, makes no
 * LLM call, and runs on ANY provider, including the ones that report no usage
 * at all. Nothing here is unmeasurable, so nothing here throws.
 */

import { dropOldestSpan } from './drop.js';
import { resolveSlidingWindowOptions } from '../options.js';
import type { WindowStrategy, WindowStrategyInput, WindowStrategyResult } from '../strategy.js';
import type { SlidingWindowOptions, SlidingWindowRecord } from '../types.js';

/** `WindowRecord.strategy` written by every record this strategy files. */
export const SLIDING_WINDOW = 'sliding-window';

/**
 * Keep the most recent `keepRecentTurns` turns in the live window and drop
 * the older ones — except anything that refuses.
 *
 * @example
 * ```ts
 * import { Agent, slidingWindow } from 'agentfootprint';
 * import { ollama } from 'agentfootprint/llm-providers';
 *
 * // Works on a provider that reports no usage at all: the trigger is turns.
 * const agent = Agent.create({ provider: ollama(), model: 'llama3' })
 *   .window(slidingWindow({ keepRecentTurns: 12 }))
 *   .build();
 * ```
 */
export function slidingWindow(options: SlidingWindowOptions): WindowStrategy {
  const config = resolveSlidingWindowOptions(options, 'slidingWindow');

  return {
    name: SLIDING_WINDOW,

    async plan(input: WindowStrategyInput): Promise<WindowStrategyResult | undefined> {
      // Did not engage: the window is already within its target depth. No
      // record — the ledger tracks what this strategy DID, not every time it
      // looked and there was nothing to do.
      if (input.turns.length <= config.keepRecentTurns) return undefined;

      const outcome = dropOldestSpan(input, config.keepRecentTurns, SLIDING_WINDOW);
      const record: SlidingWindowRecord = {
        strategy: SLIDING_WINDOW,
        iteration: input.iteration,
        keepRecentTurns: config.keepRecentTurns,
        removedStageIds: outcome.removedStageIds,
        removedMessageCount: outcome.removedMessageCount,
        windowCharsBefore: outcome.windowCharsBefore,
        windowCharsAfter: outcome.windowCharsAfter,
        turnsBefore: outcome.turnsBefore,
        turnsAfter: outcome.turnsAfter,
        refusals: outcome.refusals,
      };

      // No `budgetPressure`: this strategy has no token budget. Reporting a
      // cap nobody configured would be the invented number the family exists
      // to refuse — so it reports evictions and stays quiet about budgets.
      return {
        ...(outcome.window !== undefined && { window: outcome.window }),
        ...(outcome.rebase !== undefined && { rebase: outcome.rebase }),
        record,
        evictions: outcome.evictions,
      };
    },
  };
}

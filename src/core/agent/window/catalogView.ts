import { matchesPreparedData } from '../../../lib/matchesPreparedData.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { foldedSkillListingOf } from '../../../security/skillListingHistory.js';
import type { WindowStrategy, WindowStrategyResult } from './strategy.js';

const frameworkPlans = new WeakSet<WindowStrategy['plan']>();

/** Only the shipped implementations can certify the provenance of their own replacements. */
export function frameworkWindowStrategy(strategy: WindowStrategy): WindowStrategy {
  frameworkPlans.add(strategy.plan);
  return strategy;
}

/** Restore retained originals by the existing head/tail contract, after the view has been used. */
export function restoreCatalogWindow(
  plan: WindowStrategy['plan'],
  original: readonly LLMMessage[],
  view: readonly LLMMessage[],
  result: WindowStrategyResult,
): WindowStrategyResult {
  const { window, rebase } = result;
  if (window === undefined || rebase === undefined) return result;
  const { headCount, keptTailCount } = rebase;
  const sourceTail = original.length - keptTailCount;
  const returnedTail = window.length - keptTailCount;
  const customLineage = frameworkPlans.has(plan) ? undefined : foldedSkillListingOf(view);
  const restored = window.map((entry, index) => {
    const source =
      index < headCount ? index : index >= returnedTail ? sourceTail + index - returnedTail : -1;
    if (source >= 0 && matchesPreparedData(view[source], entry)) return original[source] ?? entry;
    // Custom strategies may derive a replacement from any value in the supplied view.
    return customLineage === undefined ? entry : { ...entry, skillListing: customLineage };
  });
  const folded = result.folded?.map((span) => {
    if (!matchesPreparedData(view.slice(headCount, sourceTail), span.messages)) return span;
    return { ...span, messages: original.slice(headCount, sourceTail) };
  });
  return { ...result, window: restored, ...(folded === undefined ? {} : { folded }) };
}

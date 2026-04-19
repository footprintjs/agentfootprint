/**
 * pickByBudget — decider stage that selects which loaded entries fit in
 * the context-token budget.
 *
 * Reads from scope:  `loaded`, `contextTokensRemaining`
 * Writes to scope:   `selected` (array of entries that fit)
 *
 * Uses footprintjs's `decide()` so the selection rationale appears in
 * the narrative as evidence, not just output:
 *
 *   "Picker evaluated: 12 loaded, budget 2048 tokens, reserved 200 for
 *    prompt headers. Included 8 entries (most recent first) totaling
 *    1847 tokens. Skipped 4 (would exceed budget)."
 *
 * Why a decider, not a plain function?
 *   "Which memories went into the prompt?" is a question we want to be
 *   able to answer post-hoc via `decide()` evidence + narrative. Using
 *   a decider makes the selection first-class in the commit log —
 *   `causalChain` can trace any recalled fact back to this pick.
 *
 * Selection algorithm (intentionally simple):
 *   1. Sort entries by `updatedAt` descending (newest first). The
 *      recency heuristic is robust across domains and matches how users
 *      typically expect chat history to behave.
 *   2. Greedily include entries while the running token total stays
 *      under `contextTokensRemaining - reserveTokens`.
 *   3. Preserve the original chronological order in the output (oldest
 *      first) so the LLM reads them in natural time sequence.
 *
 * More sophisticated strategies (relevance-weighted, decay-weighted,
 * ILP-optimal) can replace this stage without touching consumers.
 */
import type { TypedScope } from 'footprintjs';
import { decide } from 'footprintjs';
import type { MemoryEntry } from '../entry';
import type { Message } from '../../types/messages';
import type { MemoryState } from './types';
import { approximateTokenCounter, countMessageTokens, type TokenCounter } from './tokenize';

export interface PickByBudgetConfig {
  /**
   * Tokens to keep in reserve — not used for memory. Default 256.
   * Covers system-prompt overhead, new user message headroom, and safety
   * margin against token-counter approximation error. Tune per model.
   */
  readonly reserveTokens?: number;

  /**
   * Hard floor on memory tokens. If the budget minus reserve is less than
   * this, NO memory is injected (better to skip than inject a fragment).
   * Default 100 — under 100 tokens of memory is usually worse than none.
   */
  readonly minimumTokens?: number;

  /**
   * Pluggable token counter — defaults to `approximateTokenCounter`
   * (1 token ≈ 4 chars). Swap for a real tokenizer when accuracy matters.
   */
  readonly countTokens?: TokenCounter;

  /**
   * Optional cap on the NUMBER of entries, independent of tokens.
   * Useful when the budget is large enough to include hundreds of
   * entries but the LLM's "lost-in-the-middle" effect degrades quality
   * past ~20. Default: no cap (budget is the only limit).
   */
  readonly maxEntries?: number;
}

const DEFAULT_RESERVE = 256;
const DEFAULT_MINIMUM = 100;

export function pickByBudget(config: PickByBudgetConfig = {}) {
  const reserveTokens = config.reserveTokens ?? DEFAULT_RESERVE;
  const minimumTokens = config.minimumTokens ?? DEFAULT_MINIMUM;
  const countTokens = config.countTokens ?? approximateTokenCounter;
  const maxEntries = config.maxEntries;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const loaded = scope.loaded ?? [];
    const remaining = scope.contextTokensRemaining;
    const budget = remaining - reserveTokens;

    // Decider structure — decide() captures the chosen branch + evidence.
    // Each branch is a pure "when" predicate over scope state. The picker
    // writes `selected` as a side effect based on the chosen branch; the
    // narrative shows WHICH branch fired and why.
    // decide<S extends object> is parameterized on scope type; the branch
    // id it returns is always a string. We match on string values, not a
    // narrowed literal union.
    const outcome = decide(
      scope,
      [
        {
          when: () => loaded.length === 0,
          then: 'skip-empty',
          label: 'no entries loaded',
        },
        {
          when: () => budget < minimumTokens,
          then: 'skip-no-budget',
          label: 'budget below minimum threshold',
        },
      ],
      'pick',
    );

    if (outcome.branch === 'skip-empty' || outcome.branch === 'skip-no-budget') {
      scope.selected = [];
      return;
    }

    // Greedy selection — newest first, preserve chronological output.
    const byNewest = [...loaded].sort((a, b) => b.updatedAt - a.updatedAt);
    const picked: MemoryEntry<Message>[] = [];
    let used = 0;

    for (const entry of byNewest) {
      if (maxEntries !== undefined && picked.length >= maxEntries) break;

      const cost = countMessageTokens(entry.value, countTokens);
      if (used + cost > budget) continue; // skip this entry, try smaller ones
      picked.push(entry);
      used += cost;
    }

    // Emit in chronological order so the LLM reads them as time moves
    // forward. `picked` is newest-first; reverse to oldest-first.
    scope.selected = picked.reverse();
  };
}

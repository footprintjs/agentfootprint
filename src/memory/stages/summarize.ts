/**
 * summarize — stage that compresses old loaded entries into a single
 * summary entry, preserving the most-recent N verbatim.
 *
 * Reads from scope:  `loaded`
 * Writes to scope:   `loaded` (mutated: oldest entries replaced by one
 *                     synthetic summary entry)
 *
 * Where this fits in the pipeline:
 *
 *   loadRecent → summarize → pickByBudget → formatDefault
 *
 * After `summarize` runs, `loaded` is smaller (fewer entries, one of
 * which is a synthetic summary). The picker then selects from this
 * reduced set using the standard budget logic.
 *
 * ## Determinism contract (Anthropic-reviewer ask)
 *
 * For prompt caching to stay stable across runs, the summary content
 * MUST be the same each time for the same input. This requires:
 *
 *   1. Temperature = 0 on the provided LLM.
 *   2. A stable seed if the provider supports it (Anthropic: omit;
 *      OpenAI: pass a fixed `seed` in the request).
 *   3. Same system prompt + message set produces same output.
 *
 * The stage CANNOT enforce this — it just calls the caller-supplied
 * `llm` function. Callers are responsible for configuring determinism.
 * Non-deterministic summarizers still work but invalidate prompt caches
 * on every turn (~5× token-cost increase on cache-enabled providers).
 *
 * ## When summarize does NOT fire
 *
 * - `loaded.length < triggerMinEntries` → no-op (not enough history).
 * - `loaded.length <= preserveRecent` → no-op (nothing to summarize; all
 *    entries would be preserved verbatim anyway).
 * - LLM call throws → error propagates to the pipeline's executor
 *    (fail-loud, per loadRecent / writeMessages convention).
 *
 * ## Config guidance
 *
 * Choose `triggerMinEntries - preserveRecent >= 2`. Below that, a firing
 * summarizer would compress just one entry — wasted LLM call with no
 * real compression. Defaults (trigger 20, preserve 5) summarize 15
 * entries when firing, which is a meaningful compression ratio.
 *
 * ## Summary entry shape
 *
 * The synthetic entry replaces the summarized range. It has:
 *   - `id`: `summary-{earliest_turn}-to-{latest_turn}`
 *   - `value`: a `{role: 'system', content: summaryText}` message
 *   - `source.turn`: the LATEST turn that was summarized (for sorting)
 *   - `tier`: 'cold' (marks it as "condensed, may not be recent")
 *   - `source.identity`: carried over from the summarized range's first entry
 */
import type { TypedScope } from 'footprintjs';
import type { MemoryEntry } from '../entry';
import type { Message } from '../../types/messages';
import type { MemoryState } from './types';

export interface SummarizeConfig {
  /**
   * LLM callback. Receives the chronological messages to summarize;
   * must return the summary text. Caller is responsible for configuring
   * the underlying model (temperature=0, seed, system prompt, etc.) to
   * keep the output deterministic — see "Determinism contract" above.
   */
  readonly llm: (messages: readonly Message[]) => Promise<string>;

  /**
   * Minimum `loaded.length` before summarization triggers. Below this,
   * no-op — the conversation is short enough to keep verbatim. Default 20.
   */
  readonly triggerMinEntries?: number;

  /**
   * Number of most-recent entries to preserve verbatim (NOT summarized).
   * The oldest `loaded.length - preserveRecent` entries become a single
   * summary entry. Default 5 — keeps recent turns intact so the agent
   * can reference specific phrasing.
   */
  readonly preserveRecent?: number;

  /**
   * Optional custom system prompt for the summarizer. Default is a
   * neutral "summarize the following conversation..." instruction.
   * Override for domain-specific summaries (e.g., "preserve all
   * refund-related details").
   */
  readonly systemPrompt?: string;
}

const DEFAULT_TRIGGER = 20;
const DEFAULT_PRESERVE = 5;
const DEFAULT_SYSTEM_PROMPT =
  'Summarize the following conversation concisely, preserving facts, ' +
  'names, numbers, decisions, and user preferences. Omit conversational ' +
  'filler. Output plain text under 500 tokens.';

export function summarize(config: SummarizeConfig) {
  const triggerMinEntries = config.triggerMinEntries ?? DEFAULT_TRIGGER;
  const preserveRecent = config.preserveRecent ?? DEFAULT_PRESERVE;
  const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const loaded = scope.loaded ?? [];
    if (loaded.length < triggerMinEntries) return;
    if (loaded.length <= preserveRecent) return;

    // Split: older entries become the summary; newer stay verbatim.
    // `loaded` from loadRecent is oldest-first, so we take a prefix for
    // summary and a suffix for preservation.
    const splitAt = loaded.length - preserveRecent;
    const toSummarize = loaded.slice(0, splitAt);
    const toPreserve = loaded.slice(splitAt);

    // Build LLM input: system prompt + the messages verbatim.
    const llmInput: Message[] = [
      { role: 'system', content: systemPrompt },
      ...toSummarize.map((e) => e.value),
    ];

    const summaryText = await config.llm(llmInput);

    const first = toSummarize[0];
    const last = toSummarize[toSummarize.length - 1];
    const earliestTurn = first.source?.turn ?? 0;
    const latestTurn = last.source?.turn ?? 0;
    const now = Date.now();

    const summaryEntry: MemoryEntry<Message> = {
      id: `summary-${earliestTurn}-to-${latestTurn}`,
      value: { role: 'system', content: summaryText },
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      tier: 'cold',
      source: {
        turn: latestTurn,
        // Carry over identity from the summarized range for cross-session
        // provenance (caller can see "this summary came from this user's
        // earlier sessions").
        ...(first.source?.identity && { identity: first.source.identity }),
      },
    };

    // Replace the summarized range with the single summary entry.
    scope.loaded = [summaryEntry, ...toPreserve];
  };
}

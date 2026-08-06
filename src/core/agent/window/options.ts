/**
 * window/options — validate a window strategy's options ONCE, at build time.
 *
 * Pattern: Guard functions returning a resolved config.
 * Role:    core/ layer. Every message here takes a `label`, because the same
 *          option bag arrives through two doors — `.compaction({...})` and
 *          `summarizeOldest({...})` — and an error should name the door the
 *          caller actually used. One implementation, so the two doors can
 *          never drift into validating differently.
 * Emits:   N/A.
 *
 * Everything fails at `.build()`, never mid-run. A window policy that turns
 * out to be nonsense on iteration 40 of a paid run is a policy that cost you
 * money to discover.
 */

import type {
  CompactionOptions,
  CompactionRetention,
  ResolvedCompaction,
  SlidingWindowOptions,
  TokenBudgetOptions,
} from './types.js';

/** Default depth of the "never touch this" recent window. */
export const DEFAULT_KEEP_RECENT_TURNS = 6;

/**
 * What happens to folded messages when nobody said. The originals ride with
 * the conversation: losing them has to be a choice somebody typed, not a
 * default they inherited.
 */
export const DEFAULT_RETENTION: CompactionRetention = 'conversation';

const RETENTIONS: readonly CompactionRetention[] = ['conversation', 'discard'];

function requireObject(options: unknown, label: string, shape: string): void {
  if (options === null || typeof options !== 'object') {
    throw new Error(`${label}: expected an options object (${shape}), got ${typeof options}.`);
  }
}

function requireThreshold(thresholdTokens: unknown, label: string): void {
  if (
    typeof thresholdTokens !== 'number' ||
    !Number.isFinite(thresholdTokens) ||
    thresholdTokens <= 0
  ) {
    throw new Error(
      `${label}: thresholdTokens must be a positive number of tokens, got ` +
        `${String(thresholdTokens)}. There is no default: the right budget depends on your ` +
        `model and your bill, and a number this library invented would be inherited silently ` +
        `by every run.`,
    );
  }
}

function requireKeepRecentTurns(keepRecentTurns: unknown, label: string): void {
  if (!Number.isInteger(keepRecentTurns) || (keepRecentTurns as number) < 1) {
    throw new Error(
      `${label}: keepRecentTurns must be an integer >= 1, got ${String(keepRecentTurns)}. ` +
        `Keeping zero recent turns would remove the turn the model is reasoning over right now.`,
    );
  }
}

/**
 * Validate `.compaction()` / `summarizeOldest()` options.
 *
 * @param label the door being used, so the error names it
 */
export function resolveCompactionOptions(
  options: CompactionOptions,
  label: string,
): ResolvedCompaction {
  requireObject(options, label, '{ thresholdTokens, summarizer, ... }');
  const { thresholdTokens, summarizer, keepRecentTurns, model, retain } = options;
  requireThreshold(thresholdTokens, label);
  if (
    summarizer === null ||
    typeof summarizer !== 'object' ||
    typeof summarizer.complete !== 'function'
  ) {
    throw new Error(
      `${label}: summarizer must be an LLMProvider (an object with a ` +
        'complete() method). It is explicit on purpose — the library will not quietly bill ' +
        'your main model for compaction. Pass a cheap provider/model here.',
    );
  }
  if (keepRecentTurns !== undefined) requireKeepRecentTurns(keepRecentTurns, label);
  if (model !== undefined && (typeof model !== 'string' || model.length === 0)) {
    throw new Error(`${label}: model must be a non-empty model id, got ${String(model)}.`);
  }
  if (retain !== undefined && !RETENTIONS.includes(retain)) {
    throw new Error(
      `${label}: retain must be ${RETENTIONS.map((r) => `'${r}'`).join(' or ')}, got ` +
        `${String(retain)}. It decides what happens to the messages a fold removes: ` +
        `'conversation' (the default) carries them on the conversation checkpoint so a ` +
        `restart can still produce them, and 'discard' does not. A value this library does ` +
        `not recognise is refused rather than treated as one of them — guessing here would ` +
        `mean guessing whether to keep somebody's transcript.`,
    );
  }
  return {
    thresholdTokens,
    keepRecentTurns: keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS,
    summarizer,
    model,
    retain: retain ?? DEFAULT_RETENTION,
  };
}

/** Validate `slidingWindow()` options. */
export function resolveSlidingWindowOptions(
  options: SlidingWindowOptions,
  label: string,
): { readonly keepRecentTurns: number } {
  requireObject(options, label, '{ keepRecentTurns }');
  const { keepRecentTurns } = options;
  if (keepRecentTurns === undefined) {
    throw new Error(
      `${label}: keepRecentTurns is required and has no default. It IS the policy — how much ` +
        `past your agent needs is a fact about your agent, not about this library.`,
    );
  }
  requireKeepRecentTurns(keepRecentTurns, label);
  return { keepRecentTurns };
}

/** Validate `tokenBudget()` options. */
export function resolveTokenBudgetOptions(
  options: TokenBudgetOptions,
  label: string,
): { readonly thresholdTokens: number; readonly keepRecentTurns: number } {
  requireObject(options, label, '{ thresholdTokens, keepRecentTurns? }');
  const { thresholdTokens, keepRecentTurns } = options;
  requireThreshold(thresholdTokens, label);
  if (keepRecentTurns !== undefined) requireKeepRecentTurns(keepRecentTurns, label);
  return { thresholdTokens, keepRecentTurns: keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS };
}

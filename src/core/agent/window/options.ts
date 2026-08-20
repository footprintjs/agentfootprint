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
 * How many tools' most recent results the window holds beyond
 * `keepRecentTurns` when nobody said (9.57.0). ON by default, at 2.
 *
 * On by default for the same reason 9.55.0's anchor is: the counterfactual to
 * a pinned 5,800-character tool result is not 5,800 bytes saved, it is a
 * fabricated id, a refusal, a wasted action out of a small budget, and the
 * same 5,800 bytes fetched again. That is a correctness failure the framework
 * caused, and those are fixed on by default.
 *
 * TWO rather than one because the ceiling is spent newest-first among STALE
 * candidates: a one-word acknowledgement from an actuator the model has
 * stopped using can occupy a slot ahead of an older load-bearing observation.
 * Two slots absorb that. `false` or `0` switches the pin off entirely.
 */
export const DEFAULT_KEEP_LAST_TOOL_RESULTS = 2;

/**
 * Validate the `keepLastToolResults` dial. Refused at construction, never
 * mid-run — the house rule for every window option.
 */
export function requireKeepLastToolResults(value: unknown, label: string): void {
  if (value === false) return;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(
      `${label}: keepLastToolResults must be a whole number >= 0, or false, got ` +
        `${String(value)}. It is how many tools' most recent results stay in the window ` +
        `beyond keepRecentTurns; 0 and false both switch the pin off.`,
    );
  }
}

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
  if (model === undefined) {
    throw new Error(
      `${label}: model is required whenever you pass a summarizer. It used to default to the ` +
        `agent's own model, and that default had no correct case:\n` +
        `  • same provider family — it quietly billed your MAIN model for every fold, which is ` +
        `the one thing the summarizer option exists to prevent;\n` +
        `  • a different provider — it sent your agent's model id to a vendor that has never ` +
        `heard of it, and the fold died mid-run, on a paid run.\n` +
        `Name the model: \`model: 'claude-haiku-4-5'\` (or whatever your summarizer's cheap ` +
        `model is called). Two words, and the invoice stops being a surprise.`,
    );
  }
  if (typeof model !== 'string' || model.length === 0) {
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

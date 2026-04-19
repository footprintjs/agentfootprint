/**
 * pickByBudget — a composable **decider + branches** that selects which
 * loaded entries fit in the context-token budget.
 *
 * Reads from scope:  `loaded`, `contextTokensRemaining`
 * Writes to scope:   `selected` (array of entries that fit)
 *
 * Shape:
 *   PickDecider (decider stage)
 *     ├─ skip-empty     → fn: scope.selected = []
 *     ├─ skip-no-budget → fn: scope.selected = []
 *     └─ pick           → fn: greedy budget-aware selection
 *
 * `pickByBudget(config)` returns a **builder-extension function** —
 * call it with your `FlowChartBuilder` and it appends the decider +
 * branches to your pipeline:
 *
 * ```ts
 * let b = flowChart<MemoryState>('LoadRecent', loadRecent(...), 'load-recent');
 * b = pickByBudget(config)(b);
 * b = b.addFunction('Format', formatDefault(...), 'format-default');
 * ```
 *
 * Why a real decider stage (not a single function stage)?
 *   The "which memories went into the prompt?" decision is first-class —
 *   we want its evidence on `FlowRecorder.onDecision` so audit trails
 *   (causalChain, explainable UI, compliance logs) can answer "why was
 *   X recalled / skipped?" without scraping emit-channel events. A
 *   single function stage using `decide()` inline leaves the evidence
 *   buried in a local variable; a real decider stage surfaces it
 *   structurally.
 *
 * Selection algorithm (pick branch, intentionally simple):
 *   1. Sort entries by `updatedAt` descending (newest first).
 *   2. Greedily include entries while the running token total stays
 *      under `contextTokensRemaining - reserveTokens`.
 *   3. Preserve the original chronological order in the output (oldest
 *      first) so the LLM reads them in natural time sequence.
 *
 * More sophisticated strategies (relevance-weighted, decay-weighted,
 * ILP-optimal) can replace the `pick` branch without touching the
 * decider or the skip branches.
 */
import type { TypedScope } from 'footprintjs';
import { decide } from 'footprintjs';
import type { FlowChartBuilder } from 'footprintjs';
import type { MemoryEntry } from '../entry';
import type { Message } from '../../types/messages';
import type { MemoryState } from './types';
import { approximateTokenCounter, countMessageTokens, type TokenCounter } from './tokenize';

/**
 * Reusable shape for a **composable pipeline segment** — a function that
 * appends one or more stages to a builder and returns the builder. This
 * is the memory layer's convention for packaging multi-stage work
 * (decider + branches, multi-stage sub-pipelines) as a single unit that
 * consumers can drop into any flowchart:
 *
 * ```ts
 * let b = flowChart<MyState>('Seed', seed, 'seed');
 * b = pickByBudget(config)(b);          // appends a decider + 3 branches
 * b = b.addFunction('Format', fmt, ...);
 * ```
 *
 * Generic in `T` so segments targeting the memory layer can be composed
 * into host flowcharts whose state extends `MemoryState`. Future
 * segments (NarrativeMemory, SemanticRetrieval, FactExtraction) follow
 * the same shape for uniform composition ergonomics.
 */
export type PipelineSegment<T extends object> = (
  builder: FlowChartBuilder<T>,
) => FlowChartBuilder<T>;

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

/**
 * Build the decider function. Returns the full `DecisionResult` so
 * DeciderHandler recognizes the DECISION_RESULT brand and attaches
 * evidence to `FlowRecorder.onDecision`. Predicates read from `scope`
 * (not closed-over locals) so the temp recorder captures the values
 * that drove the choice.
 */
function buildPickDecider(config: PickByBudgetConfig) {
  const reserveTokens = config.reserveTokens ?? DEFAULT_RESERVE;
  const minimumTokens = config.minimumTokens ?? DEFAULT_MINIMUM;
  return (scope: TypedScope<MemoryState>) =>
    decide(
      scope,
      [
        {
          when: (s) => (s.loaded ?? []).length === 0,
          then: 'skip-empty',
          label: 'no entries loaded — nothing to pick',
        },
        {
          when: (s) => (s.contextTokensRemaining ?? 0) - reserveTokens < minimumTokens,
          then: 'skip-no-budget',
          label: 'budget below minimum threshold — skip injection',
        },
      ],
      'pick',
    );
}

/** Both skip branches share the same body — no entries survive. */
const skipStage = (scope: TypedScope<MemoryState>): void => {
  scope.selected = [];
};

/** The `pick` branch: greedy newest-first selection within budget. */
function buildPickStage(config: PickByBudgetConfig) {
  const reserveTokens = config.reserveTokens ?? DEFAULT_RESERVE;
  const countTokens = config.countTokens ?? approximateTokenCounter;
  const maxEntries = config.maxEntries;

  return (scope: TypedScope<MemoryState>): void => {
    const loaded = scope.loaded ?? [];
    const budget = (scope.contextTokensRemaining ?? 0) - reserveTokens;

    // Sort newest-first. Secondary key on `id` guarantees deterministic
    // ordering when entries share `updatedAt` (batch writes, low-resolution
    // clocks) — without it, ties resolve to implementation-defined order
    // which breaks trace replay and A/B eval comparisons.
    const byNewest = [...loaded].sort((a, b) => {
      const byTime = b.updatedAt - a.updatedAt;
      if (byTime !== 0) return byTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const picked: MemoryEntry<Message>[] = [];
    let used = 0;

    for (const entry of byNewest) {
      if (maxEntries !== undefined && picked.length >= maxEntries) break;

      const cost = countMessageTokens(entry.value, countTokens);
      if (used + cost > budget) continue; // skip this entry, try smaller ones
      picked.push(entry);
      used += cost;
    }

    // Emit in chronological order — `picked` is newest-first; reverse.
    scope.selected = picked.reverse();
  };
}

/**
 * Append the pick-by-budget decider + branches to `builder`. Returns
 * the builder so calls chain naturally:
 *
 * ```ts
 * let b = flowChart<MemoryState>('LoadRecent', loadRecent(config), 'load-recent');
 * b = pickByBudget(pickConfig)(b);
 * b = b.addFunction('Format', formatDefault(formatConfig), 'format-default');
 * ```
 *
 * Generic in `T` so consumers whose scope extends `MemoryState` (e.g.,
 * an AgentLoopState that embeds memory fields) can compose this into
 * their own pipeline without casting.
 */
export function pickByBudget<T extends MemoryState = MemoryState>(
  config: PickByBudgetConfig = {},
): PipelineSegment<T> {
  const decider = buildPickDecider(config);
  const pickStage = buildPickStage(config);

  return (builder) => {
    return builder
      .addDeciderFunction(
        'PickDecider',
        decider as never,
        'pick-decider',
        'Decide whether to pick entries, skip (empty), or skip (no budget)',
      )
      .addFunctionBranch(
        'skip-empty',
        'SkipEmpty',
        skipStage as never,
        'Mark selected as [] — no entries loaded',
      )
      .addFunctionBranch(
        'skip-no-budget',
        'SkipNoBudget',
        skipStage as never,
        'Mark selected as [] — budget below minimum',
      )
      .addFunctionBranch(
        'pick',
        'Pick',
        pickStage as never,
        'Greedy newest-first selection within token budget',
      )
      .end() as unknown as FlowChartBuilder<T>;
  };
}

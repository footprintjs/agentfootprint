/**
 * window/strategy — PUBLIC. How a window strategy is shaped.
 *
 * Pattern: Strategy (GoF), with the dangerous half of the decision handed in
 *          pre-bound rather than left to the implementer to re-derive.
 * Role:    core/ layer. The window stage does the wiring — read the meter,
 *          write the window, emit, record, cost — and delegates the one
 *          interesting question to a strategy:
 *
 *              given the segmented turns and what the provider actually
 *              counted → what should the window become, and what does the
 *              ledger need to be told about it?
 *
 * Emits:   N/A. A strategy is pure decision + (optionally) its own LLM call;
 *          it never touches scope, never emits, and never writes. That is
 *          what makes it testable without a chart, and what keeps the
 *          "record everything you did" duty in ONE place (the stage) rather
 *          than duplicated per strategy.
 *
 * Three strategies ship — `summarizeOldest` (what `.compaction()`
 * configures), `slidingWindow`, `tokenBudget` — and `.window(...)` takes any
 * object that satisfies `WindowStrategy`.
 *
 * Two things are deliberately NOT left to the implementer:
 *
 *   1. **The refusal rules.** `planRemoval` arrives already bound to this
 *      iteration's turns and guards. A strategy cannot forget that an
 *      unanswered tool call must not leave the window, because it never gets
 *      the chance to decide that for itself — it asks, and it is told, with
 *      every refusal named. That is safety by construction, not by docs.
 *   2. **Provenance.** `removalFacts` turns "these indices left" into the
 *      stage ids that wrote them and how long each lived. A strategy cannot
 *      file a removal it cannot name.
 *
 * The TRIGGER, by contrast, is entirely the strategy's own: `plan` is called
 * at every ReAct iteration boundary and answers `undefined` when it did not
 * engage. That is why `slidingWindow` can run on a provider that reports no
 * usage at all while `summarizeOldest` and `tokenBudget` refuse by name.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import type { Turn, RemovalPlan } from './turns.js';
import type { FoldedSpan, WindowRecord } from './types.js';

/** One message leaving the window, with the facts an eviction event needs. */
export interface WindowEviction {
  /** Index in the PRE-change window — the index the content hash was built on. */
  readonly index: number;
  /** How long it lived in the window. Exact; 0 when its birth is unknown. */
  readonly survivalMs: number;
}

/** The provenance of a set of removed messages, as the ledger needs it. */
export interface RemovalFacts {
  /** `runtimeStageId`s of the stages that appended those messages, in order. */
  readonly removedStageIds: readonly string[];
  /** One eviction per message, with its measured lifetime. */
  readonly evictions: readonly WindowEviction[];
}

/** Everything a strategy is allowed to look at. */
export interface WindowStrategyInput {
  /** The window as it stands, detached. */
  readonly history: readonly LLMMessage[];
  /** The same window, segmented into turns. */
  readonly turns: readonly Turn[];
  /**
   * What the provider REPORTED for the last completed call. Counted, never
   * guessed. `undefined` before the first call of the run — a strategy that
   * acted on that would be guessing, which is the one thing this family
   * refuses to do.
   *
   * `{ input: 0, output: 0 }` is a provider that reported NOTHING, not a call
   * that cost nothing. A token-triggered strategy should throw
   * `CompactionUnmeasurableError` there rather than invent a size.
   */
  readonly measured: { readonly input: number; readonly output: number } | undefined;
  /** The ReAct iteration this decision belongs to. */
  readonly iteration: number;
  /**
   * The run this decision belongs to.
   *
   * A strategy that retains what it removed has to name the run whose commit
   * log held it — that is the honest answer to "where else could I have found
   * this?", and the answer is "nowhere, once that process ended", which is the
   * whole reason retention exists. `'unknown'` when the runtime could not name
   * the run, never a fabricated id.
   */
  readonly runId: string;
  /** The agent's own model — the sensible default for a strategy that bills. */
  readonly agentModel: string;
  /** `provider.name` of the MAIN provider, for a refusal that names it. */
  readonly providerName: string;
  /** The run's cancellation signal, when there is one. */
  readonly signal: AbortSignal | undefined;
  /** Wall clock, injectable so a caller can pin `survivalMs`. */
  readonly now: () => number;
  /**
   * THE shared refusal engine, bound to this iteration.
   *
   * Answers: which contiguous span of turns may leave, and every turn that
   * refused, named. Never removes the system envelope, the last
   * `keepRecentTurns` turns, an unanswered tool call, the paused tool, or a
   * pending check-in.
   *
   * @param keepRecentTurns   how many trailing turns are off-limits
   * @param isExistingSummary optional predicate marking a turn that is a
   *   summary a previous fold wrote; when the whole span is one of those, the
   *   plan refuses with `only-existing-summary`. Pass it only if your strategy
   *   spends an LLM call — a drop has nothing to protect against.
   */
  readonly planRemoval: (
    keepRecentTurns: number,
    isExistingSummary?: (turn: Turn) => boolean,
  ) => RemovalPlan;
  /**
   * Turn removed message indices into the facts the ledger needs: which
   * stages wrote them, and how long each lived in the window.
   *
   * @param indices indices in the PRE-change window that are leaving
   * @param atMs    the moment they leave (usually `input.now()`)
   */
  readonly removalFacts: (indices: readonly number[], atMs: number) => RemovalFacts;
}

/** What the stage should do next. */
export interface WindowStrategyResult {
  /** The new window. Absent = leave the window alone. */
  readonly window?: readonly LLMMessage[];
  /**
   * How the meter must re-align its provenance to the new window, which is
   * `[...head, (one new message)?, ...tail]`. Present exactly when `window`
   * is. `insertedAtMs` is the birth of the message the strategy put in the
   * span's place — omit it when the strategy removed messages and inserted
   * nothing.
   */
  readonly rebase?: {
    readonly headCount: number;
    readonly keptTailCount: number;
    readonly insertedAtMs?: number;
  };
  /** What the ledger is told. Always present — an engaged visit explains itself. */
  readonly record: WindowRecord;
  /** Messages that left the window, for `context.evicted`. */
  readonly evictions: readonly WindowEviction[];
  /**
   * Spans this visit removed, in the form that OUTLIVES the process: appended
   * to the conversation checkpoint, so a restart can still say what a summary
   * stands for — and, under `retain: 'conversation'`, produce it verbatim.
   *
   * OMIT IT unless your strategy replaced messages with something that stands
   * for them. `summarizeOldest` fills it because a summary is a claim that
   * needs its evidence; the drop strategies do not, because a drop replaces
   * nothing and its authored notice claims nothing.
   *
   * The stage writes these in the SAME commit as the window change, so there
   * is no state in which messages left the window and the record of what they
   * were did not follow them.
   */
  readonly folded?: readonly FoldedSpan[];
  /**
   * The budget reading to report on `agentfootprint.context.budget_pressure`.
   *
   * OMIT IT when the strategy has no token budget. `slidingWindow` does: it
   * triggers on turn count, and filling `capTokens` with a number nobody
   * configured would be the invented figure this family refuses. No budget,
   * no budget_pressure event.
   */
  readonly budgetPressure?: {
    readonly capTokens: number;
    readonly projectedTokens: number;
    readonly planAction: 'evict' | 'summarize' | 'none';
  };
  /** A billed call the strategy made, for the cost channel. */
  readonly spend?: {
    readonly model: string;
    readonly usage: { readonly input: number; readonly output: number };
  };
  /** A one-per-run dev warning the stage should print. */
  readonly warning?: string;
}

/**
 * A window strategy: what the live window should become at this iteration
 * boundary, and what the record must say about the change.
 *
 * Pass one to `AgentBuilder.window(...)`. Exactly one per agent —
 * `.compaction(...)` is the same door with `summarizeOldest` already in it.
 */
export interface WindowStrategy {
  /**
   * Stable name — it is written onto every record this strategy files
   * (`WindowRecord.strategy`), so a reader can tell which policy produced a
   * window, and it names the strategy on the chart's `compact` stage.
   */
  readonly name: string;
  /**
   * Decide. Called at EVERY ReAct iteration boundary.
   *
   * Return `undefined` when this strategy did not engage — nothing was over
   * budget, nothing was old enough, nothing has been counted yet. The ledger
   * stays untouched and the run proceeds.
   *
   * Return a result for anything else, INCLUDING a visit that changed
   * nothing because every candidate refused. Those are the visits a person
   * debugging an oversized window actually needs.
   */
  plan(input: WindowStrategyInput): Promise<WindowStrategyResult | undefined>;
}

/**
 * context-ledger/types.ts — the bookkeeper's vocabulary.
 *
 * WHY THIS LIBRARY EXISTS: context engineering fails in one predictable
 * direction — "include everything to be safe". Every injection, skill and
 * tool schema costs tokens EVERY turn, whether or not it ever mattered. The
 * ledger keeps score across runs: which pieces EARNED their tokens (were
 * called, activated, or sat on the answer's dependency slice) and which
 * never did. Its rows feed the L2 gates (gatedTools predicate, skill-graph
 * EntryScorer, injection demotion) so future turns include less — the
 * mechanism that makes lesser models viable.
 *
 * HONESTY (the discipline everything here inherits):
 * - Every counter is a STRUCTURAL fact from the run's own commit log —
 *   offers are recorded commits, uses are recorded calls/activations/slice
 *   membership. Nothing is inferred from model internals.
 * - Each kind's `used` definition is explicit ({@link UsedSignal}) and rides
 *   every count — a consumer can always see WHY a piece counted as used.
 * - Slice membership is slot-granular (all injections sharing a slot share
 *   its write) — the signal name says so: `'answer-slice(slot)'`.
 * - `approxTokens*` is a serialized-length estimate (JSON chars ÷ 4), named
 *   so nobody mistakes it for a tokenizer count.
 * - The ledger never claims causation. `earnRate` is bookkeeping;
 *   ablation (context-bisect) can upgrade individual claims when you pay
 *   for it.
 */

/** What kind of context piece a row tracks. Skills are injections with
 *  flavor 'skill' — split out because their `used` signal differs. */
export type PieceKind = 'injection' | 'skill' | 'tool';

/**
 * The per-kind structural definition of "used" — explicit, never blended:
 * - `'tool-called'`        — an assistant message actually called the tool.
 * - `'skill-activated'`    — the run activated the skill
 *                            (`activatedInjectionIds`).
 * - `'answer-slice(slot)'` — the injection's SLOT write sits on the final
 *                            answer's backward dependency slice
 *                            (slot-granular by construction).
 */
export type UsedSignal = 'tool-called' | 'skill-activated' | 'answer-slice(slot)';

/** One context piece's accumulated bookkeeping across recorded runs. */
export interface LedgerRow {
  /** Injection/skill id, or tool name. Unique within its kind. */
  readonly id: string;
  readonly kind: PieceKind;
  /** Offer events — once per iteration the piece was in context, across runs. */
  readonly offered: number;
  /** Serialized-length token ESTIMATE spent on those offers (chars ÷ 4). */
  readonly approxTokensSpent: number;
  /** Structural uses (per-kind definition — see breakdown in usedVia). */
  readonly used: number;
  /** Which signal(s) produced the `used` count, and how many each. */
  readonly usedVia: Readonly<Partial<Record<UsedSignal, number>>>;
  /** Distinct recorded runs in which the piece was offered at least once. */
  readonly runsSeen: number;
  /**
   * Outcome labels of runs where the piece was OFFERED (label → run count).
   * Labels are consumer-supplied via {@link ContextLedger.recordOutcome}
   * (thumbs, eval scores bucketed by the consumer, triage verdicts).
   * Presence-correlation bookkeeping — NOT a causal claim.
   */
  readonly outcomes: Readonly<Record<string, number>>;
  /** used ÷ offered (0 when never offered). THE headline number. */
  readonly earnRate: number;
}

/** What `recordRun` extracted from one run — returned for inspection/tests. */
export interface RecordedRun {
  /** Handle for {@link ContextLedger.recordOutcome}. */
  readonly runRef: string;
  /** Piece ids offered in this run (kind-qualified internal keys). */
  readonly offeredPieces: readonly string[];
  /** True when the answer slice could be computed (finalContent + reads). */
  readonly sliceAvailable: boolean;
}

/** JSON-safe persisted shape (consumer owns storage). */
export interface LedgerJSON {
  readonly version: 1;
  readonly rows: readonly LedgerRow[];
  readonly runsRecorded: number;
}

/** Minimal runner surface the ledger reads (any agentfootprint Runner). */
export interface RunnerLike {
  getLastSnapshot(): unknown;
}

export interface ContextLedger {
  /**
   * Ingest one FINISHED run: walk its commit log for offers (activeInjections
   * / dynamicToolSchemas per iteration), uses (assistant tool calls,
   * activatedInjectionIds, the final answer's dependency slice), and
   * accumulate. Accepts a runner (reads `getLastSnapshot()`) or a snapshot.
   */
  recordRun(source: RunnerLike | unknown): RecordedRun | undefined;
  /**
   * Label a recorded run's outcome ('good'/'bad'/any consumer label —
   * thumbs, bucketed eval score, triage verdict). Defaults to the most
   * recently recorded run. Increments the label for every piece OFFERED in
   * that run.
   */
  recordOutcome(label: string, runRef?: string): boolean;
  /** All rows, worst earnRate first (the review order that matters). */
  rows(): readonly LedgerRow[];
  /** One row (by kind + id). */
  row(kind: PieceKind, id: string): LedgerRow | undefined;
  /** JSON-safe export (consumer persists). */
  exportJSON(): LedgerJSON;
  /** Merge a previously exported ledger in (counts add). */
  importJSON(json: LedgerJSON): void;
}

/**
 * Context-error finders — the plain, pluggable public surface for context-bug
 * localization. A `Finder` answers one question: "which piece of context made the
 * agent's answer wrong?" Each finder is a thin, named adapter over the engines in
 * `src/lib/context-bisect` + `src/lib/influence-core`; the academic method + citation
 * live in `meta`, never in the import name.
 *
 * Taxonomy (area / category / thing): observability / contextError / finders.
 * Tree-shakeable: one finder = one file = one named export; import only what you use.
 */
import type { Embedder } from '../../../lib/influence-core/index.js';

/** How sure the finder is. `guessed` = ranked by a similarity proxy only;
 *  `proven` = a removal/re-run actually flipped the outcome (counterfactual). */
export type Evidence = 'guessed' | 'proven';

/** What the finder points at. `piece` = a context element; `step` = an agent step. */
export type Granularity = 'piece' | 'step';

/** A removable piece of context the finder can suspect. */
export interface ContextPiece {
  readonly id: string;
  readonly text: string;
}

/** One agent step (a tool-call), for finders that work at step granularity. */
export interface StepInput {
  readonly id: string;
  /** Human-readable label, e.g. `get_promo@L1`. */
  readonly label: string;
  readonly text: string;
}

/** Everything a finder may need. Light finders use `embedder`; counterfactual
 *  finders use `rerun`; step finders use `steps`. A finder throws if a field it
 *  needs is missing. */
export interface FindInput {
  /** The removable context pieces to consider. */
  readonly suspects: readonly ContextPiece[];
  /** The wrong answer to explain. */
  readonly wrongOutput: string;
  /** Embedder for similarity-ranking finders. */
  readonly embedder?: Embedder;
  /** Re-run with the given pieces removed; `recovered` = the outcome flipped back. */
  readonly rerun?: (removedIds: readonly string[]) => Promise<{ recovered: boolean; outcome?: string }>;
  /** The agent's steps, for step-granularity finders. */
  readonly steps?: readonly StepInput[];
  /** For testManyCombos: how many on/off combinations to sample (default ~4×#suspects). */
  readonly samples?: number;
}

/** One suspect in the finder's ranked output. */
export interface ScoredSuspect {
  readonly id: string;
  /** Higher = more suspicious. Absent for finders that don't score. */
  readonly score?: number;
}

/** What a finder returns. Plain fields, namespace-independent. */
export interface FindResult {
  /** Which finder produced this. */
  readonly finder: string;
  /** Suspects, most-to-least suspicious. */
  readonly suspects: readonly ScoredSuspect[];
  /** The single top suspect, if any. */
  readonly lead?: string;
  /** The small set worth confirming when there is no clear single winner. */
  readonly shortlist: readonly string[];
  /** `guessed` (proxy) vs `proven` (counterfactual). */
  readonly evidence: Evidence;
  /** `piece` vs `step`. */
  readonly granularity: Granularity;
  /** How many times the finder re-ran the agent (the honest cost). 0 = free. */
  readonly checks: number;
  /** A self-explaining narrative of how the finder reached its answer. */
  readonly explanation: string;
}

/** Attribution — kept off the import name, surfaced in docs / leaderboards. */
export interface FinderMeta {
  /** Plain one-liner for a leaderboard row. */
  readonly label: string;
  /** The precise technique, for experts. */
  readonly method: string;
  /** Citation, if the finder reimplements a published method. */
  readonly paper?: string;
}

/** A pluggable context-error finder. */
export interface Finder {
  readonly name: string;
  readonly meta: FinderMeta;
  find(input: FindInput): Promise<FindResult>;
}

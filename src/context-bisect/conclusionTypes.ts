/**
 * The types of a report's overall reading. See `conclusion.ts`.
 */

import type { AblationRunStats, RestoredCandidate, Suspect } from './types.js';

/** One executed probe: what was removed together, and what happened. */
export interface BisectionProbe {
  /** Labels of the suspects ablated together ([] = the baseline probe). */
  readonly ablated: readonly string[];
  readonly stats: AblationRunStats;
  /** Majority-of-N outcome flip. */
  readonly flipped: boolean;
}

/**
 * What the removals add up to:
 *
 * - `'one-cause'`: removing one item flipped the answer, and no other tested item
 *   flipped a majority of its reruns.
 * - `'one-path'`: several items flipped it, and the record shows they lie on one path.
 * - `'needed-together'`: removing any one of a few separate items flipped the answer.
 * - `'redundant-pair'`: no item flipped it alone, and exactly one pair did together.
 * - `'missing-context'`: no removal flipped it, and restoring a dropped unit did.
 * - `'no-single-cause'`: too many items or pairs flip it to single one out.
 * - `'none-found'`: nothing tested flipped it. This isn't proof that no cause exists.
 * - `'inconclusive'`: the reruns can't support a reading, or nothing was tested.
 */
export type ContextBugConclusionKind =
  | 'one-cause'
  | 'one-path'
  | 'needed-together'
  | 'redundant-pair'
  | 'missing-context'
  | 'no-single-cause'
  | 'none-found'
  | 'inconclusive';

/**
 * Two items that both flipped the answer, where the record shows one comes after the
 * other, so they may be one path rather than two causes.
 */
export interface ContextBugLink {
  readonly earlier: Suspect;
  readonly later: Suspect;
  /**
   * `'code'`: only steps whose output is fixed by their inputs lie between them, so
   * the record shows `later` came from `earlier`. `'model-or-tool'`: a model or tool
   * call lies between them, so `later` came after a step that read `earlier`, which
   * shows it could have depended on it, not that it did.
   */
  readonly via: 'code' | 'model-or-tool';
}

/** The evidence behind a conclusion that needed the pair search. */
export interface ContextBugPairSearch {
  /** How many top-ranked items were paired. */
  readonly top: number;
  /** Every pair tried, in rank order. */
  readonly probes: readonly BisectionProbe[];
  /** Runner calls the search spent. */
  readonly runsUsed: number;
}

/**
 * The report's overall reading of its verdicts. A named item was needed in this
 * context, which doesn't by itself show that it's wrong or that it's the root
 * cause. The rule was chosen on development cases and can be tuned with
 * `rerun.maxNamedFlips` and `rerun.pairSearchTop`.
 */
export interface ContextBugConclusion {
  readonly kind: ContextBugConclusionKind;
  /** The items this conclusion names, earliest on a path first, then highest ranked. */
  readonly named: readonly Suspect[];
  /** Flipped items the record links. Present when any are linked. */
  readonly links?: readonly ContextBugLink[];
  /** Dropped units whose restoration flipped the answer. */
  readonly restored: readonly RestoredCandidate[];
  /** Tested items whose removal flipped the answer alone. An item found twice counts once. */
  readonly flippedAlone: number;
  /** Items that were removed and re-run. An item found twice counts once. */
  readonly tested: number;
  /** Items that could be removed, tested or not. An item found twice counts once. */
  readonly removable: number;
  /** Present when the pair search ran. */
  readonly pairSearch?: ContextBugPairSearch;
  /** The conclusion in a plain sentence or two, including what wasn't tested. */
  readonly statement: string;
}

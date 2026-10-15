/**
 * cost — the SECOND score of two-score localization (proposal 004).
 *
 * A context bug costs you twice: a wrong ANSWER (the flip `verdict`, the strong
 * causal tier) OR extra COST — loops/tokens — even when a capable model recovers
 * and answers correctly. This module reads the cost score from the SAME ablation
 * reruns (`AblationRunStats.cost`, captured in `runAblationProbe`) and attaches a
 * `CostVerdict` to each suspect, then classifies each on the 2×2.
 *
 * HONEST TIER (the two-lens review): the cost score is a WEAKER, gated tier than
 * the flip. Removing a piece reducing cost shows **necessity for the cost, NOT
 * that the work was "wasted"** (the piece could be load-bearing scaffolding). So:
 *   - PLACEBO control — a cost cause must beat the loops-saved of pieces whose
 *     removal did NOT flip the answer (benign path variance), leave-one-out;
 *     (v1 limitation: the placebo population is the non-flipping suspects, which
 *     may themselves include real cost causes — so the band's MAX is CONSERVATIVE
 *     and UNDER-detects when several pieces reduce cost by similar amounts. Safe
 *     direction for a causal-ish claim. A dedicated neutral-filler placebo is v2.)
 *   - STABILITY — every ablated rerun used no MORE loops than baseline
 *     (consistent reduction; an integer ±1 delta is brittle — determinism ≠
 *     robustness), AND a placebo band existed to clear.
 */
import type { AblationRunStats, CostVerdict, Suspect, SuspectClass } from './types.js';

/** Minimum loops saved (over the placebo band) to call a piece a cost cause. */
export const MIN_LOOPS_SAVED = 1;

interface Effect {
  readonly loopsSaved: number;
  readonly tokensSaved: number;
  /** No ablated rerun used MORE loops than the baseline median (consistent). */
  readonly consistent: boolean;
}

function effectOf(suspect: Suspect, baseline: AblationRunStats): Effect | undefined {
  const c = suspect.runs?.cost;
  if (c === undefined) return undefined;
  const baseLoops = baseline.cost?.loops?.median;
  const baseTokens = baseline.cost?.tokens?.median;
  const loopsSaved =
    baseLoops !== undefined && c.loops !== undefined ? baseLoops - c.loops.median : 0;
  const tokensSaved =
    baseTokens !== undefined && c.tokens !== undefined ? baseTokens - c.tokens.median : 0;
  const consistent =
    baseLoops !== undefined && c.loops !== undefined ? c.loops.max <= baseLoops : false;
  return { loopsSaved, tokensSaved, consistent };
}

/**
 * Attach a `CostVerdict` to each suspect from the ablation reruns + a
 * leave-one-out placebo control. Suspects without cost data are returned
 * unchanged (quality-only). See the module honesty note.
 */
export function assignCostVerdicts(
  suspects: readonly Suspect[],
  baseline: AblationRunStats,
): Suspect[] {
  // The placebo population: non-flipping suspects (removal didn't change the
  // answer) with cost data. Their loops-saved is benign path variance.
  const nonFlip = suspects
    .filter((s) => s.verdict?.verdict !== 'confirmed')
    .map((s) => ({ id: s.source, e: effectOf(s, baseline) }))
    .filter((x): x is { id: string; e: Effect } => x.e !== undefined);

  return suspects.map((suspect) => {
    const e = effectOf(suspect, baseline);
    if (e === undefined) return suspect; // no cost data → unchanged

    // Leave-one-out placebo: exclude the suspect itself from its own band.
    const band = nonFlip.filter((x) => x.id !== suspect.source).map((x) => x.e.loopsSaved);
    const placeboExists = band.length > 0;
    const placeboMax = placeboExists ? Math.max(...band) : 0;

    const stable = placeboExists && e.consistent;
    const reducedCostOnRemoval =
      stable && e.loopsSaved >= MIN_LOOPS_SAVED && e.loopsSaved > placeboMax;
    const cost: CostVerdict = {
      reducedCostOnRemoval,
      loopsSaved: e.loopsSaved,
      tokensSaved: e.tokensSaved,
      stable,
    };
    return { ...suspect, cost };
  });
}

/**
 * Derive the 2×2 class from the flip verdict (quality) and the cost verdict.
 * The no-bug cell is `'no-detected-effect'` — never "innocent" (a piece can
 * matter in ways neither axis sees: overdetermination, same-loops-different-path).
 */
export function classifySuspect(suspect: Suspect): SuspectClass {
  const flips = suspect.verdict?.verdict === 'confirmed';
  const costCause = suspect.cost?.reducedCostOnRemoval === true && suspect.cost.stable;
  if (flips && costCause) return 'both';
  if (flips) return 'content-bug';
  if (costCause) return 'cost-cause';
  return 'no-detected-effect';
}

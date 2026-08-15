/**
 * The arm verdict — the same three tiers, phrased for a substitution.
 *
 * ## Why not widen `verdictFor`
 *
 * `verdictFor` already carries an `action` word (`'ablating'` | `'restoring'`)
 * and a third would have been one line. It ends its NOT-CONFIRMED sentence with
 * "its ranking remains a correlational proxy only" — true of a suspect, which
 * was RANKED before it was probed, and meaningless for an arm, which was never
 * ranked at all. Widening the union would have forced that sentence onto the
 * new tier or edited a string three existing tests pin byte-for-byte. So the
 * tier LOGIC is shared (`probeFlipped`, the majority rule, the zero-tolerance
 * baseline gate) and only the prose is new.
 *
 * ## The tiers, in refusal order
 *
 * 1. **Unstable baseline** → inconclusive. The incumbent could not reproduce
 *    the reference answer across its own seeds, so a difference measured
 *    against it is measuring the scenario, not the arm. Zero tolerance, exactly
 *    as `bisect.ts` and `localize.ts` apply it: ONE un-intervened flip is
 *    enough, because the majority rule would let a 1-in-3 flaky scenario reach
 *    a causal verdict.
 * 2. **Arm did not take effect** → inconclusive. The run manifest contradicted
 *    what the arm declared. Any difference here is evidence about a
 *    configuration nobody meant to test.
 * 3. **Inside the null band** → inconclusive. A majority flip whose mean
 *    similarity still sits within the baseline arm's own seed-to-seed spread is
 *    not separable from noise. Only applied when the flip comparator and the
 *    band are the same instrument (see `NullBand.gates`).
 * 4. **Majority flip, outside the band, stable baseline** → confirmed. This is
 *    a causal claim of the same tier an ablation verdict makes: a
 *    counterfactual intervention, seeded reruns, variance reported, and a
 *    baseline that held.
 * 5. **Minority flips** → inconclusive. 6. **No flips** → not-confirmed.
 *
 * Every claim is bounded by the scenario and the comparator, and says so — an
 * arm confirmed on one question has been confirmed on one question.
 */

import { probeFlipped } from '../ablation.js';
import type { AblationRunStats, AblationVerdict } from '../types.js';
import type { ArmApplication, NullBand } from './types.js';

/** Everything the verdict needs beyond the arm's own numbers. */
export interface ArmVerdictContext {
  readonly baselineArmId: string;
  /** The baseline arm reproduced the reference on EVERY seed. */
  readonly baselineStable: boolean;
  readonly baselineStats: AblationRunStats;
  readonly band: NullBand;
  /** Mean similarity fell below the band's floor. */
  readonly outsideNullBand: boolean;
  readonly application: ArmApplication;
}

/** Translate one arm's probe evidence into its verdict. See module docs. */
export function verdictForArm(
  armId: string,
  stats: AblationRunStats,
  context: ArmVerdictContext,
): AblationVerdict {
  const { baselineArmId, band } = context;

  // 1. An unstable incumbent invalidates every comparison against it.
  if (!context.baselineStable) {
    return {
      verdict: 'inconclusive',
      claim:
        `INCONCLUSIVE: the baseline arm '${baselineArmId}' did not reproduce the reference answer ` +
        `across its own seeded reruns (${context.baselineStats.flips}/${context.baselineStats.samples} ` +
        `changed) — no arm-comparison verdict for '${armId}' is trustworthy on an unstable scenario.`,
    };
  }

  // 2. The run manifest says this arm is not the arm that ran.
  if (context.application.checked && !context.application.applied) {
    const first = context.application.mismatches[0];
    const observed = first?.observed ?? 'nothing (the manifest does not name it)';
    return {
      verdict: 'inconclusive',
      claim:
        `INCONCLUSIVE: arm '${armId}' declared ${first?.facet ?? 'a facet'}=${
          first?.declared ?? '?'
        } but the run manifest reported ${observed} — the arm did not take effect, so any ` +
        `difference measured here is not evidence about it.`,
    };
  }

  const flipped = probeFlipped(stats);
  const mean = stats.similarity.mean.toFixed(3);

  // 3. Flipped, but not further than the incumbent drifts from itself.
  if (flipped && band.gates && !context.outsideNullBand) {
    return {
      verdict: 'inconclusive',
      claim:
        `INCONCLUSIVE: switching to arm '${armId}' changed the answer in ${stats.flips}/${stats.samples} ` +
        `seeded reruns, but its mean similarity to the reference (${mean}) sits INSIDE the baseline ` +
        `arm's own seed-to-seed band (floor ${band.floor.toFixed(
          3,
        )}) — not separable from run-to-run ` +
        `noise. Raise samples, or compare on a domain comparator.`,
    };
  }

  // 4. The causal tier.
  if (flipped) {
    const bandClause = band.gates
      ? `, outside the baseline arm's own band (floor ${band.floor.toFixed(3)})`
      : '';
    return {
      verdict: 'confirmed',
      claim:
        `CAUSAL: switching from baseline arm '${baselineArmId}' to '${armId}' changed the answer in ` +
        `${stats.flips}/${stats.samples} seeded reruns (mean similarity to the reference ${mean} ± ` +
        `${stats.similarity.stdev.toFixed(
          3,
        )})${bandClause}, on a baseline that reproduced. Bounded ` +
        `by this scenario and this comparator.`,
    };
  }

  // 5. Minority — real movement, not a majority.
  if (stats.flips > 0) {
    return {
      verdict: 'inconclusive',
      claim:
        `INCONCLUSIVE: switching to arm '${armId}' changed the answer in only ${stats.flips}/${stats.samples} ` +
        `seeded reruns — below majority; raise samples or check scenario stability.`,
    };
  }

  // 6. No movement at all.
  return {
    verdict: 'not-confirmed',
    claim:
      `NOT CONFIRMED: switching to arm '${armId}' did not change the answer in ${stats.samples} seeded ` +
      `reruns — on this scenario, by this comparator, it is not distinguishable from baseline arm ` +
      `'${baselineArmId}'. That is a finding about this scenario, not about the strategies.`,
  };
}

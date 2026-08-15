/**
 * `compareStrategyArms` — the substitution counterfactual as ONE call.
 *
 * Take two or more named configurations, run each of them N seeded times
 * through the consumer's factory, and say — honestly — which ones answer
 * differently from the incumbent. The product loop over `probe.ts` +
 * `verdict.ts`, the way `rerunWithoutSources` is the product loop over the
 * ablation machinery.
 *
 * ## The order of operations, and why it is this order
 *
 * 1. VALIDATE first (`validate.ts`): every refusal that can be known from the
 *    declaration fires before a single model call.
 * 2. RUN the baseline arm. Its answers are needed before the reference can be
 *    chosen, because a caller with no prior run gets the baseline arm's own
 *    seed-0 answer as the reference.
 * 3. SCORE the baseline against the reference. This one probe does three jobs
 *    at once and pays for none of them twice: the STABILITY gate (zero flips),
 *    the NULL BAND (its similarity spread), and the baseline's own row in the
 *    readout.
 * 4. RUN + SCORE each challenger, check its manifest, issue its verdict.
 *
 * Cost is exactly `samples × arms` runner calls, reported as `runsUsed`. There
 * is no hidden extra probe: the incumbent is one of the arms, not a surcharge.
 */

import { defaultOutcomeComparator, resolveSamples } from '../ablation.js';
import { CONTEXT_BISECT_DEFAULTS } from '../types.js';
import type { AblationRunStats, OutcomeComparator } from '../types.js';
import {
  checkArmApplication,
  collectArmRuns,
  nullBandFrom,
  scoreArmRuns,
  type ArmRuns,
} from './probe.js';
import type {
  ArmOutcome,
  CompareStrategyArmsOptions,
  StrategyArm,
  StrategyComparison,
} from './types.js';
import { validateStrategyArms } from './validate.js';
import { verdictForArm } from './verdict.js';

export async function compareStrategyArms(
  options: CompareStrategyArmsOptions,
): Promise<StrategyComparison> {
  const baselineArmId = validateStrategyArms(options.arms, options.baselineArmId);
  const samples = resolveSamples(options.samples);
  const flipThreshold = options.flipThreshold ?? CONTEXT_BISECT_DEFAULTS.flipThreshold;
  // The band gates the verdict ONLY when the flip comparator IS the similarity
  // comparator — the one instrument, two readouts rule (see NullBand).
  const usesDefaultComparator = options.answerChanged === undefined;
  const outcomeChanged: OutcomeComparator =
    options.answerChanged ?? defaultOutcomeComparator(options.embedder, flipThreshold);

  const baselineArm = options.arms.find((arm) => arm.id === baselineArmId) as StrategyArm;
  const baselineRuns = await collectArmRuns(baselineArm, options.runner, samples);

  // The reference: the run that actually happened, or — for a fresh A/B with no
  // prior answer — the incumbent's own first answer. Seed 0 then compares with
  // itself, which is why `reference.from` is reported: stability rests on the
  // remaining N−1 seeds, and a reader must be able to see that.
  const referenceFrom = options.originalAnswer !== undefined ? 'prior-run' : 'baseline-arm';
  const reference = options.originalAnswer ?? baselineRuns.answers[0] ?? '';

  const baselineStats = await scoreArmRuns(
    baselineRuns,
    reference,
    options.embedder,
    outcomeChanged,
  );
  // ZERO TOLERANCE, the same gate bisect.ts and localize.ts apply: one
  // un-intervened flip marks the scenario unstable. The majority rule would let
  // a 1-in-3 flaky scenario through to a causal verdict.
  const baselineStable = baselineStats.flips === 0;
  const band = nullBandFrom(baselineArmId, baselineStats, usesDefaultComparator);

  const arms: ArmOutcome[] = [];
  for (const arm of options.arms) {
    const isBaseline = arm.id === baselineArmId;
    const runs: ArmRuns = isBaseline
      ? baselineRuns
      : await collectArmRuns(arm, options.runner, samples);
    const stats: AblationRunStats = isBaseline
      ? baselineStats
      : await scoreArmRuns(runs, reference, options.embedder, outcomeChanged);
    // An arm cannot be outside its own band; saying otherwise would put the
    // incumbent in the readout as a finding about itself.
    const outsideNullBand = !isBaseline && stats.similarity.mean < band.floor;
    const application = checkArmApplication(arm, runs.manifests);
    arms.push({
      armId: arm.id,
      isBaseline,
      runs: stats,
      answers: runs.answers,
      outsideNullBand,
      application,
      ...(isBaseline
        ? {}
        : {
            verdict: verdictForArm(arm.id, stats, {
              baselineArmId,
              baselineStable,
              baselineStats,
              band,
              outsideNullBand,
              application,
            }),
          }),
    });
  }

  return {
    reference: { from: referenceFrom, text: reference },
    baselineArmId,
    baselineStable,
    nullBand: band,
    arms,
    runsUsed: samples * options.arms.length,
    summary: summarize(arms, baselineArmId, baselineStable, samples),
  };
}

/** Plain-language recap — PRESENTATION ONLY; the fields above are the data. */
function summarize(
  arms: readonly ArmOutcome[],
  baselineArmId: string,
  baselineStable: boolean,
  samples: number,
): string {
  const challengers = arms.filter((arm) => !arm.isBaseline);
  const runs = `${arms.length} arms × ${samples} seeded runs`;
  if (!baselineStable) {
    return (
      `The baseline arm '${baselineArmId}' gave different answers across its own seeded reruns — ` +
      `no arm comparison is trustworthy on an unstable scenario (${runs} spent; see each arm's ` +
      `verdict).`
    );
  }
  const named = (kind: string): string =>
    challengers
      .filter((arm) => arm.verdict?.verdict === kind)
      .map((arm) => `'${arm.armId}'`)
      .join(', ') || 'none';
  return `${runs}, baseline arm '${baselineArmId}' reproduced. Answered differently: ${named(
    'confirmed',
  )}. Not distinguishable: ${named('not-confirmed')}. Inconclusive: ${named('inconclusive')}.`;
}

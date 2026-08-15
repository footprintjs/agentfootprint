/**
 * The arm probe — seeded runs in, shared statistics out.
 *
 * Split in two on purpose. `collectArmRuns` only RUNS (it cannot know the
 * reference yet: when no prior answer was supplied, the reference IS the
 * baseline arm's first answer). `scoreArmRuns` only SCORES. Keeping them apart
 * is what lets the reference be chosen between the two halves without a second
 * pass over the model — the same "one ablation, two readouts" thrift
 * `runAblationProbe` applies to cost.
 *
 * Everything statistical is borrowed, not re-derived: `similarityStats`,
 * `costStatsFrom` and `resolveSamples` come from `ablation.ts` unchanged, so an
 * arm's `AblationRunStats` is the same number computed the same way as an
 * ablation's — which is the point of sharing the statistics while keeping the
 * spec types apart.
 */

import { cosineSimilarity } from '../../../memory/embedding/cosine.js';
import { costStatsFrom, similarityStats } from '../ablation.js';
import type { AblationRunStats, Embedder, OutcomeComparator } from '../types.js';
import type {
  ArmApplication,
  ArmFacetMismatch,
  ArmRunner,
  NullBand,
  RunManifestLike,
  StrategyArm,
} from './types.js';
import { checkArmApplied } from './manifest.js';
import { declaredFacetCount } from './validate.js';

/** The raw harvest of one arm's seeded runs — no scoring yet. */
export interface ArmRuns {
  readonly answers: readonly string[];
  readonly loops: readonly number[];
  readonly tokens: readonly number[];
  readonly manifests: readonly RunManifestLike[];
}

/**
 * Call the consumer's runner once per seed (0..samples-1) for ONE arm and
 * normalize the two return shapes (`string` | `{output, cost?, manifest?}`) —
 * the same normalization `runAblationProbe` performs, so a bare-string runner
 * costs the caller nothing in ceremony.
 */
export async function collectArmRuns(
  arm: StrategyArm,
  runner: ArmRunner,
  samples: number,
): Promise<ArmRuns> {
  const answers: string[] = [];
  const loops: number[] = [];
  const tokens: number[] = [];
  const manifests: RunManifestLike[] = [];
  for (let seed = 0; seed < samples; seed++) {
    const raw = await runner(arm, { seed });
    if (typeof raw === 'string') {
      answers.push(raw);
      continue;
    }
    answers.push(raw.output);
    if (raw.cost?.loops !== undefined) loops.push(raw.cost.loops);
    if (raw.cost?.tokens !== undefined) tokens.push(raw.cost.tokens);
    if (raw.manifest !== undefined) manifests.push(raw.manifest);
  }
  return { answers, loops, tokens, manifests };
}

/**
 * Score one arm's harvested answers against the reference: similarity per seed
 * (mean/min/max/stdev) plus the outcome-flip count. Shape-identical to what an
 * ablation probe reports.
 */
export async function scoreArmRuns(
  runs: ArmRuns,
  reference: string,
  embedder: Embedder,
  outcomeChanged: OutcomeComparator,
): Promise<AblationRunStats> {
  const referenceVec = await embedder.embed({ text: reference });
  const similarities: number[] = [];
  let flips = 0;
  for (const answer of runs.answers) {
    const vec = await embedder.embed({ text: answer });
    similarities.push(cosineSimilarity(referenceVec, vec));
    if (await outcomeChanged(reference, answer)) flips++;
  }
  const cost = costStatsFrom(runs.answers.length, runs.loops, runs.tokens);
  return {
    samples: runs.answers.length,
    flips,
    similarity: similarityStats(similarities),
    ...(cost !== undefined ? { cost } : {}),
  };
}

/**
 * Build the inert-intervention control from the baseline arm's OWN seeded runs.
 * See {@link NullBand} for why leave-one-out does not transfer and this does.
 */
export function nullBandFrom(
  baselineArmId: string,
  baselineStats: AblationRunStats,
  gates: boolean,
): NullBand {
  const similarity = baselineStats.similarity;
  const degenerate = similarity.stdev === 0;
  const note = !gates
    ? `Reported, not applied: a custom answerChanged comparator decides the flips, so an ` +
      `embedding-similarity band is a different instrument and must not veto its findings. The ` +
      `control on that axis is the baseline arm's own flip count, which must be zero.`
    : degenerate
    ? `The baseline arm '${baselineArmId}' reproduced identically on every seed (spread 0), so ` +
      `the floor is a hard ${similarity.min.toFixed(3)}: any change clears it. That is honest ` +
      `for a deterministic scenario and only as strong as the determinism.`
    : `A challenger must sit further from the reference than the baseline arm '${baselineArmId}' ` +
      `ever did across its own seeds (floor ${similarity.min.toFixed(
        3,
      )}, spread ±${similarity.stdev.toFixed(3)}).`;
  return { baselineArmId, similarity, floor: similarity.min, degenerate, gates, note };
}

/**
 * Did this arm actually take effect? Compares every manifest the runner
 * reported against the arm's declared facets.
 *
 * `checked: false` — and therefore no refusal — in exactly two cases, both of
 * which are absence of evidence rather than evidence of absence: the runner
 * reported no manifest, or the arm declares only ablations (no manifest names a
 * tool catalog). Refusing a verdict in either case would punish a consumer for
 * a capture they were never required to make.
 */
export function checkArmApplication(
  arm: StrategyArm,
  manifests: readonly RunManifestLike[],
): ArmApplication {
  const declares = declaredFacetCount(arm.facets) > 0;
  if (!declares || manifests.length === 0) {
    return { manifestsSeen: manifests.length, checked: false, applied: false, mismatches: [] };
  }
  // EVERY run must agree — one seed that quietly built the incumbent is enough
  // to poison the arm's numbers, and it would be invisible in an average.
  const mismatches: ArmFacetMismatch[] = [];
  const seen = new Set<string>();
  for (const manifest of manifests) {
    for (const mismatch of checkArmApplied(arm, manifest)) {
      const key = `${mismatch.facet}=${mismatch.observed ?? '<absent>'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mismatches.push(mismatch);
    }
  }
  return {
    manifestsSeen: manifests.length,
    checked: true,
    applied: mismatches.length === 0,
    mismatches,
  };
}

/**
 * restoration — RFC-003 Part B: the causal tier for the missing-context finder
 * (interface #3), the MIRROR of ablation (D8's restoration half).
 *
 * Ablation confirms a PRESENT culprit by removing it and watching the outcome
 * flip. Restoration confirms an ABSENT culprit (a unit `findDroppedContext`
 * surfaced) by adding it BACK and watching the outcome flip. Same seeded-rerun
 * discipline, same verdict rule (`verdictFor(..., 'restoring')`), same honest
 * baseline check — only the intervention is inverted.
 *
 * The re-run is consumer-owned (the library doesn't own your agent loop), just
 * like `AblationRunner`. `RestorationRunner` receives the units to add back
 * (`[]` = the un-restored baseline) plus a seed, and returns the run's output.
 */
import { cosineSimilarity } from '../../memory/embedding/cosine.js';
import type { Embedder } from '../influence-core/index.js';
import { defaultOutcomeComparator, resolveSamples, similarityStats } from './ablation.js';
import type { ContextUnit } from './missingContext.js';
import type { AblationRunStats, OutcomeComparator } from './types.js';
import { CONTEXT_BISECT_DEFAULTS } from './types.js';

/**
 * Re-run the agent with `units` ADDED BACK into the context (`[]` = baseline,
 * restore nothing). Returns the run's output. Mirror of `AblationRunner`.
 */
export type RestorationRunner = (
  units: readonly ContextUnit[],
  run: { readonly seed: number },
) => Promise<string>;

/** The rerun configuration that upgrades the dropped list to the causal tier. */
export interface RestorationRerun {
  readonly runner: RestorationRunner;
  /** The original (buggy) output the reruns are compared against. */
  readonly originalOutput: string;
  /** Seeded reruns per probe. Default 3. Never below 2 (no single-run verdicts). */
  readonly samples?: number;
  /** Outcome-flip comparator. Default: similarity < `flipThreshold`. */
  readonly outcomeChanged?: OutcomeComparator;
  /** Similarity floor for the DEFAULT comparator. Default 0.8. */
  readonly flipThreshold?: number;
  /**
   * Restore only the first K dropped candidates. Default 5. COST: confirmation
   * calls your model `samples × (K + 1)` times (the +1 is the baseline) — real,
   * seeded re-runs. Keep `maxCandidates`/`samples` low, or pre-rank candidates,
   * to bound spend. Candidates beyond K are listed without a verdict.
   */
  readonly maxCandidates?: number;
}

export interface RestorationProbeConfig {
  readonly rerun: RestorationRerun;
  readonly embedder: Embedder;
}

/**
 * Run ONE restoration probe: call the consumer's runner with `units` restored
 * once per seed, measure each output's similarity to the original, count flips.
 * `[]` units = the un-restored baseline. Mirror of `runAblationProbe`.
 */
export async function runRestorationProbe(
  config: RestorationProbeConfig,
  units: readonly ContextUnit[],
): Promise<AblationRunStats> {
  const samples = resolveSamples(config.rerun.samples);
  const flipThreshold = config.rerun.flipThreshold ?? CONTEXT_BISECT_DEFAULTS.flipThreshold;
  const outcomeChanged =
    config.rerun.outcomeChanged ?? defaultOutcomeComparator(config.embedder, flipThreshold);

  const similarities: number[] = [];
  let flips = 0;
  const originalVec = await config.embedder.embed({ text: config.rerun.originalOutput });
  for (let seed = 0; seed < samples; seed++) {
    const output = await config.rerun.runner(units, { seed });
    const outputVec = await config.embedder.embed({ text: output });
    similarities.push(cosineSimilarity(originalVec, outputVec));
    if (await outcomeChanged(config.rerun.originalOutput, output)) flips++;
  }
  return { samples, flips, similarity: similarityStats(similarities) };
}

/**
 * Strategy arms — SUBSTITUTION counterfactuals, kept distinct from ablation's
 * removals and sharing its statistics. See README.md in this folder for the
 * design argument, and `types.ts` for why this is not a fifth `AblationSpec`
 * arm.
 *
 * @beta Beta feature (RFC-003 Part B). The API works and is tested, but may
 * change before GA.
 */

export { applyArm } from './apply.js';
export { compareStrategyArms } from './compare.js';
export {
  armFacetsFromManifest,
  armLabel,
  checkArmApplied,
  manifestFromEvents,
  matchArm,
  RUN_CONFIGURED_EVENT,
} from './manifest.js';
export {
  checkArmApplication,
  collectArmRuns,
  nullBandFrom,
  scoreArmRuns,
  type ArmRuns,
} from './probe.js';
export { armConfigKey, declaredFacetCount, validateStrategyArms } from './validate.js';
export { verdictForArm, type ArmVerdictContext } from './verdict.js';
export type {
  ArmApplication,
  ArmFacetMismatch,
  ArmFacets,
  ArmMemoryFacet,
  ArmOutcome,
  ArmRunResult,
  ArmRunner,
  CompareStrategyArmsOptions,
  ManifestMemoryLike,
  NullBand,
  RunManifestLike,
  StrategyArm,
  StrategyComparison,
} from './types.js';

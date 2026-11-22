import { libraryLimitClauses } from './results/library-did/stage.js';
import {
  evictedCallOutcomes,
  settledSiblingWitness,
  type EvictedCallOutcomes,
} from './callStandingWords.js';
import { legacyConflictWitness } from './conflicts.js';
import { dispatchProofWitness } from './entryEvidence.js';
import type {
  AnswerAssessment,
  AssessmentPointer,
  AssessmentReason,
  AssessmentReasonDetail,
  AssessmentReasonSource,
} from './types.js';

/**
 * The fold's sources and any display names the app declared. For calls that
 * did not complete, the source carries the outcome even without a display name.
 */
export interface StandingNames {
  readonly sources: ReadonlyMap<AssessmentReason, AssessmentReasonSource>;
  readonly displayNames: ReadonlyMap<string, string>;
  readonly details?: ReadonlyMap<AssessmentReason, AssessmentReasonDetail>;
  readonly libraryLimits?: ReadonlyMap<AssessmentReason, readonly string[]>;
  readonly skippedSteps?: number;
  readonly batchRefused?: true;
  readonly settledSiblings?: number;
  readonly evictedOutcomes?: EvictedCallOutcomes;
  readonly libraryLimitsGap?: true;
  readonly dispatchProofGap?: true;
  readonly legacyConflictGap?: true;
  readonly omitDeclaredWhy?: true;
  readonly answerValidationGap?: true;
}

/** Reconstruct exact older warning variants from the same retained evidence. */
export function recordedStandingNameVariants(
  reasons: readonly AssessmentReason[],
  names: StandingNames,
): readonly StandingNames[] {
  const { legacyConflictGap, ...earlierFacts } = names;
  const versions = [names];
  if (
    legacyConflictGap &&
    reasons.includes('check-unreachable') &&
    (names.dispatchProofGap || names.answerValidationGap)
  ) {
    versions.push(earlierFacts);
  }
  const details = names.details;
  if (!details?.size) return versions;
  const generic = versions.map((facts) => ({ ...facts, details: new Map() }));
  const hasWhy = [...details.values()].some((detail) =>
    detail.toolSays?.entries.some(({ why }) => why !== undefined),
  );
  const subjectsOnly = hasWhy
    ? versions.map((facts) => ({ ...facts, omitDeclaredWhy: true as const }))
    : [];
  return [...versions, ...subjectsOnly, ...generic];
}

/** The fold's sources keyed by reason — what {@link StandingNames} carries. */
export function sourcesByReason(
  a: AnswerAssessment,
): ReadonlyMap<AssessmentReason, AssessmentReasonSource> {
  return new Map(a.reasons.map((r) => [r.reason, r.source] as const));
}

/** Each recorded cause of an unreachable check owns its witness pointers. */
export function unreachableWitnessGroups(witnesses: readonly AssessmentPointer[]) {
  return {
    libraryLimits: witnesses.filter(
      (p) =>
        p.kind === 'state' &&
        (p.key === 'libraryResultLimitsIncomplete' ||
          (p.key === 'libraryResultLimits' && p.path === '/length')),
    ),
    conflict: witnesses.filter(legacyConflictWitness),
    dispatch: witnesses.filter(dispatchProofWitness),
    validator: witnesses.filter(
      (pointer) => pointer.kind === 'state' && pointer.key === 'answerValidation',
    ),
  };
}

/** The committed facts the live and rebuilt line share. */
export function standingFactsOf(
  assessment: AnswerAssessment,
  displayNames: ReadonlyMap<string, string>,
  state?: Readonly<Record<string, unknown>>,
  retainedSettlements?: () => unknown,
): StandingNames {
  const libraryLimits = libraryLimitClauses(assessment, displayNames, state);
  const skippedSteps = assessment.reasons.find((r) => r.reason === 'step-skipped')?.witness.length;
  const settlements = assessment.reasons.find((r) => r.reason === 'call-not-completed')?.witness;
  const settledSiblings = settlements?.filter(settledSiblingWitness).length;
  const evictedOutcomes = evictedCallOutcomes(settlements, state, retainedSettlements);
  const batchRefused = settlements?.some(
    (pointer) =>
      pointer.kind === 'history' &&
      pointer.path === '/toolResultExecution' &&
      pointer.toolCallId === undefined,
  );
  const unreachable = assessment.reasons.find((r) => r.reason === 'check-unreachable')?.witness;
  const gaps = unreachable === undefined ? undefined : unreachableWitnessGroups(unreachable);
  return {
    ...(libraryLimits !== undefined && { libraryLimits }),
    sources: sourcesByReason(assessment),
    displayNames,
    details: new Map(
      assessment.reasons.flatMap(({ reason, detail }) =>
        detail === undefined ? [] : [[reason, detail] as const],
      ),
    ),
    ...(skippedSteps !== undefined && { skippedSteps }),
    ...(batchRefused && { batchRefused: true as const }),
    ...(settledSiblings !== undefined && { settledSiblings }),
    ...(evictedOutcomes !== undefined && { evictedOutcomes }),
    ...(gaps?.libraryLimits.length && { libraryLimitsGap: true as const }),
    ...(gaps?.dispatch.length && { dispatchProofGap: true as const }),
    ...(gaps?.conflict.length && { legacyConflictGap: true as const }),
    ...(gaps?.validator.length && { answerValidationGap: true as const }),
  };
}

import {
  BINDING_LIMITS,
  boundedText,
  ownConfigArray,
} from '../../../integrity/claim-binding/scope.js';
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { plainLineProblem } from '../../../lib/plainLine.js';
import type { FlowchartCheckpoint } from 'footprintjs';
import { checkpointOwnSlot, withCheckpointData } from '../../../redaction/privateCaller.js';
import { requireVerificationOnResume } from '../findings/verificationCheckpoint.js';
import {
  readVerificationState,
  type ClaimVerificationState,
} from '../findings/verificationState.js';
import { negativeCheckpointOf, type NegativeCheckpoint } from '../negativeClaims/checkpoint.js';
import type { StoredCitationSource } from './capture.js';

export interface CitationCheckpoint {
  readonly claimVerification: ClaimVerificationState;
  readonly citationSources: readonly StoredCitationSource[];
}

/** Checkpoint storage authenticates provenance. Only an available retained receipt may back a locator. */
export function citationSourcesOf(
  container: unknown,
  verification: ClaimVerificationState | undefined,
): readonly StoredCitationSource[] | undefined {
  const slot = checkpointOwnSlot(container, 'citationSources');
  if (!slot.present) return undefined;
  if (verification === undefined)
    throw new TypeError('Citation checkpoint requires its receipt carrier.');
  const receipts = new Set(
    verification.evidence.results
      .filter((result) => result.unavailable === undefined)
      .map((result) => result.id),
  );
  const occurrences = new Set<string>();
  const sources = ownConfigArray(
    copyJson(slot.value, BINDING_LIMITS.snapshotBytes, true, 5),
    BINDING_LIMITS.results,
  );
  const admitted = sources.map((source) => {
    const data = ownData(source, [
      'callOccurrenceKey',
      'resultId',
      'bodyDigest',
      'completeColumns',
    ]);
    const occurrence = readCallOccurrenceKey(data);
    if (
      typeof occurrence !== 'string' ||
      occurrences.has(occurrence) ||
      typeof data.resultId !== 'string' ||
      !receipts.delete(data.resultId) ||
      typeof data.bodyDigest !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(data.bodyDigest)
    )
      throw new TypeError('Invalid citation checkpoint receipt binding.');
    occurrences.add(occurrence);
    if (Object.hasOwn(data, 'completeColumns')) {
      const columns = ownConfigArray(data.completeColumns, 256);
      if (
        new Set(columns).size !== columns.length ||
        columns.some(
          (column) =>
            !boundedText(column) || plainLineProblem('Citation column', column) !== undefined,
        )
      )
        throw new TypeError('Invalid citation checkpoint columns.');
    }
    return source as StoredCitationSource;
  });
  return Object.freeze(admitted);
}

/** Native pauses retain the library's working state; history checkpoints name its canonical receipt slot. */
export function citationCheckpointFromState(state: unknown): CitationCheckpoint | undefined {
  const slot = checkpointOwnSlot(state ?? {}, 'resultIdentities');
  if (!slot.present) {
    citationSourcesOf(state ?? {}, undefined);
    return undefined;
  }
  const claimVerification = readVerificationState(slot.value, 0);
  return {
    claimVerification,
    citationSources: citationSourcesOf(state, claimVerification) ?? [],
  };
}

export function citationCheckpointOnResume(
  container: unknown,
  enabled: boolean,
): CitationCheckpoint | undefined {
  const marked = checkpointOwnSlot(container, 'citationSources').present;
  const claimVerification = requireVerificationOnResume(container, enabled && marked);
  const citationSources = citationSourcesOf(container, claimVerification);
  if (citationSources === undefined) return undefined;
  if (!enabled || claimVerification === undefined)
    throw new TypeError('Continuation requires the citation setting and retained receipt carrier.');
  return { claimVerification, citationSources };
}

/** An armed history checkpoint uses one result namespace even if both layers are enabled. */
export function checkpointNegatives(
  container: unknown,
  sources: readonly StoredCitationSource[] | undefined,
) {
  const negatives = negativeCheckpointOf(container);
  return sources !== undefined && negatives !== undefined
    ? { negativeClaimState: negatives.negativeClaimState }
    : negatives;
}

/** A new user turn keeps negative-claim reservations but starts with no citation evidence. */
export function clearCitationEvidence(negatives: NegativeCheckpoint): NegativeCheckpoint {
  const state = negatives.resultIdentities;
  if (state === undefined) return negatives;
  return {
    ...negatives,
    resultIdentities: { ...state, evidence: { ...state.evidence, results: [] } },
  };
}

/** Private working state for a native pause. An accepted offer can never cross this door. */
export function resumeCitationCheckpoint(
  checkpoint: FlowchartCheckpoint,
  enabled: boolean,
): FlowchartCheckpoint {
  const state = checkpoint.sharedState ?? {};
  requireVerificationOnResume(state, false);
  const sources = checkpointOwnSlot(state, 'citationSources');
  const offer = checkpointOwnSlot(state, 'acceptedCitationOffer');
  if (!enabled) {
    if (sources.present || offer.present)
      throw new TypeError('Resume requires the citation setting used by the paused agent.');
    return checkpoint;
  }
  const citations = citationCheckpointFromState(state);
  if (citations === undefined && !offer.present) return checkpoint;
  const admitted = withCheckpointData(state, {
    ...(citations !== undefined && { resultIdentities: citations.claimVerification }),
    ...(sources.present &&
      citations !== undefined && { citationSources: citations.citationSources }),
    ...(offer.present && { acceptedCitationOffer: undefined }),
  });
  return withCheckpointData(checkpoint, { sharedState: admitted });
}

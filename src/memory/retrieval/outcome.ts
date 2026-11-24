/** Bounded evidence about a store read and the stages deciding what to recall. */
import type { RetrievalEvidence, RetrievalRejectReason } from './types.js';

export type MemoryRecallExclusionReason = RetrievalRejectReason | 'decayed';

export interface MemoryRecallCandidate {
  readonly id: string;
  /** One-based store order. */
  readonly order: number;
  readonly admitted: boolean;
  readonly score?: number;
  readonly floor?: number;
  readonly reason?: MemoryRecallExclusionReason;
}

export interface MemoryRecallOutcome {
  readonly turnNumber: number;
  readonly kind: 'ok' | 'timeout';
  readonly namespace?: string;
  readonly floor?: number;
  readonly candidateCount?: number;
  /** Prepared candidate count. Request inclusion requires separate evidence. */
  readonly admittedCount?: number;
  readonly exclusions: Readonly<Partial<Record<MemoryRecallExclusionReason, number>>>;
  /** The stages accounted for the candidates actually returned. */
  readonly complete: boolean;
  /** The diagnostic sample covers the full store pool. */
  readonly candidatesComplete?: boolean;
  readonly candidateIdsAmbiguous?: true;
  readonly candidates?: readonly MemoryRecallCandidate[];
}

const CANDIDATE_LIMIT = 128;

export const AMBIGUOUS_CANDIDATE_IDS_REASON =
  'candidate IDs were repeated; individual occurrences cannot be attributed';

export function hasRepeatedCandidateIds(candidates: readonly { readonly id: string }[]): boolean {
  const seen = new Set<string>();
  for (const { id } of candidates) {
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

export function omitAmbiguousRetrievalCandidates(evidence: RetrievalEvidence): RetrievalEvidence {
  const safe = {
    ...evidence,
    candidateIdsAmbiguous: true as const,
    candidatesComplete: false,
    candidatesOmittedReason: AMBIGUOUS_CANDIDATE_IDS_REASON,
  };
  delete safe.candidates;
  delete safe.promptRanges;
  return safe;
}

export function retrievalCandidateIdsAmbiguous(
  evidence: RetrievalEvidence | undefined,
  loaded: readonly { readonly id: string }[],
): boolean {
  return (
    evidence?.candidateIdsAmbiguous === true ||
    hasRepeatedCandidateIds(loaded) ||
    hasRepeatedCandidateIds(evidence?.candidates ?? [])
  );
}

function omitAmbiguousRecallCandidates(outcome: MemoryRecallOutcome): MemoryRecallOutcome {
  if (outcome.kind === 'timeout') return outcome;
  const safe = { ...outcome, candidateIdsAmbiguous: true as const, candidatesComplete: false };
  delete safe.candidates;
  return safe;
}

export function recallOutcome(
  turnNumber: number,
  namespace: string,
  candidates: readonly MemoryRecallCandidate[],
  complete: boolean,
  floor?: number,
): MemoryRecallOutcome {
  const exclusions: Partial<Record<MemoryRecallExclusionReason, number>> = {};
  let admittedCount = 0;
  for (const { reason, admitted } of candidates) {
    if (admitted) admittedCount++;
    else if (reason !== undefined) exclusions[reason] = (exclusions[reason] ?? 0) + 1;
  }
  return {
    kind: 'ok',
    turnNumber,
    namespace,
    ...(floor !== undefined && { floor }),
    candidateCount: candidates.length,
    admittedCount,
    exclusions,
    complete: candidates.every((candidate) => candidate.admitted || candidate.reason !== undefined),
    ...(hasRepeatedCandidateIds(candidates)
      ? { candidateIdsAmbiguous: true as const, candidatesComplete: false }
      : {
          candidatesComplete: complete && candidates.length <= CANDIDATE_LIMIT,
          candidates: candidates.slice(0, CANDIDATE_LIMIT),
        }),
  };
}

export function recallTimeout(turnNumber: number, namespace: string): MemoryRecallOutcome {
  return {
    kind: 'timeout',
    turnNumber,
    namespace,
    admittedCount: 0,
    exclusions: {},
    complete: true,
  };
}

export interface RecallExclusion {
  readonly id: string;
  readonly reason: MemoryRecallExclusionReason;
  readonly score?: number;
  readonly floor?: number;
}

/** Update the counts from every exclusion before matching the diagnostic sample. */
export function refineRecallOutcomes(
  outcomes: readonly MemoryRecallOutcome[],
  removed: readonly RecallExclusion[],
  before: number,
  after: number,
  candidateIdsAmbiguous: boolean,
): readonly MemoryRecallOutcome[] {
  const successful = outcomes.filter((outcome) => outcome.kind === 'ok');
  const origin = successful.length === 1 ? successful[0] : undefined;
  if (origin === undefined || origin.admittedCount !== before) {
    const uncertain = unprovenRecallOutcomes(outcomes);
    return candidateIdsAmbiguous ? uncertain.map(omitAmbiguousRecallCandidates) : uncertain;
  }

  const exclusions = { ...origin.exclusions };
  for (const { reason } of removed) exclusions[reason] = (exclusions[reason] ?? 0) + 1;
  const refined = { ...origin, admittedCount: after, exclusions };
  const ambiguous =
    candidateIdsAmbiguous ||
    origin.candidateIdsAmbiguous === true ||
    hasRepeatedCandidateIds(origin.candidates ?? []);
  if (ambiguous) {
    return outcomes.map((outcome) =>
      outcome === origin ? omitAmbiguousRecallCandidates(refined) : outcome,
    );
  }
  const byId = new Map(removed.map((decision) => [decision.id, decision]));
  const candidates = origin.candidates?.map((candidate) => {
    const decision = byId.get(candidate.id);
    return !candidate.admitted || decision === undefined
      ? candidate
      : { ...candidate, ...decision, admitted: false };
  });
  return outcomes.map((outcome) =>
    outcome === origin ? { ...refined, ...(candidates !== undefined && { candidates }) } : outcome,
  );
}

export function unprovenRecallOutcomes(
  outcomes: readonly MemoryRecallOutcome[],
): readonly MemoryRecallOutcome[] {
  return outcomes.map((outcome) => {
    if (outcome.kind === 'timeout') return outcome;
    const uncertain = { ...outcome, complete: false };
    delete uncertain.admittedCount;
    return uncertain;
  });
}

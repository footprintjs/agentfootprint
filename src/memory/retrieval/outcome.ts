/** Bounded evidence about a store read and the stages deciding what to recall. */
import type { RetrievalRejectReason } from './types.js';

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
  readonly candidates?: readonly MemoryRecallCandidate[];
}

const CANDIDATE_LIMIT = 128;

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
    candidatesComplete: complete && candidates.length <= CANDIDATE_LIMIT,
    candidates: candidates.slice(0, CANDIDATE_LIMIT),
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
  readonly reason: MemoryRecallExclusionReason;
  readonly score?: number;
  readonly floor?: number;
}

/** Update sample rows and counts independently, from the stage's actual decisions. */
function excludeRecall(
  outcome: MemoryRecallOutcome,
  removed: ReadonlyMap<string, RecallExclusion>,
  counts: Readonly<Partial<Record<MemoryRecallExclusionReason, number>>>,
  admittedCount: number,
): MemoryRecallOutcome {
  if (outcome.kind === 'timeout') return outcome;
  const exclusions = { ...outcome.exclusions };
  for (const reason of Object.keys(counts) as MemoryRecallExclusionReason[]) {
    exclusions[reason] = (exclusions[reason] ?? 0) + (counts[reason] ?? 0);
  }
  const candidates = outcome.candidates?.map((candidate) => {
    if (!candidate.admitted) return candidate;
    const decision = removed.get(candidate.id);
    return decision === undefined ? candidate : { ...candidate, ...decision, admitted: false };
  });
  return {
    ...outcome,
    admittedCount,
    exclusions,
    ...(candidates !== undefined && { candidates }),
  };
}

/** Shared/custom pipelines without a single attributable input leave the count unknown. */
export function refineRecallOutcomes(
  outcomes: readonly MemoryRecallOutcome[],
  removed: ReadonlyMap<string, RecallExclusion>,
  before: number,
  after: number,
): readonly MemoryRecallOutcome[] {
  const successful = outcomes.filter((outcome) => outcome.kind === 'ok');
  const origin = successful.length === 1 ? successful[0] : undefined;
  if (origin === undefined || origin.admittedCount !== before)
    return unprovenRecallOutcomes(outcomes);
  const counts: Partial<Record<MemoryRecallExclusionReason, number>> = {};
  for (const { reason } of removed.values()) counts[reason] = (counts[reason] ?? 0) + 1;
  return outcomes.map((outcome) =>
    outcome === origin ? excludeRecall(outcome, removed, counts, after) : outcome,
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

import { readOwnList } from '../../../../../lib/boundedJson.js';
import {
  readRetrievalRequest,
  type RecallSourceSummary,
} from '../../../honesty/retrievalRequests.js';
import { statePointer } from '../../pointer.js';
import type { AnswerAssessment, AssessmentPointer, AssessmentReason } from '../../types.js';

type State = Readonly<Record<string, unknown>>;
type RetrievalReason = 'memory-retrieval-timeout' | 'memory-retrieval-excluded';
type RetrievalWarning = { reason: RetrievalReason; clause: string };
type WitnessedWarning = RetrievalWarning & { witness: AssessmentPointer };

const MAX_FINDINGS_ROWS = 4096;
export function isRetrievalReason(reason: AssessmentReason): reason is RetrievalReason {
  return reason === 'memory-retrieval-timeout' || reason === 'memory-retrieval-excluded';
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function warningOf(row: RecallSourceSummary): RetrievalWarning | undefined {
  if (!row.complete || row.admittedCount !== 0) return undefined;
  if (row.kind === 'timeout')
    return { reason: 'memory-retrieval-timeout', clause: 'a memory search timed out' };
  if (row.candidateCount === undefined || row.candidateCount === 0) return undefined;
  const { exclusions } = row;
  const excluded = Object.values(exclusions).reduce((a, b) => a + b, 0);
  if (excluded !== row.candidateCount) return undefined;

  const candidates = row.candidateCount === 1 ? '1 candidate' : `${row.candidateCount} candidates`;
  const clause =
    exclusions['below-threshold'] === row.candidateCount
      ? `memory search found nothing above the score floor (${candidates} fell below it)`
      : exclusions.decayed === row.candidateCount
      ? `the memory decay rule excluded ${candidates}`
      : `retrieval filters and budgets excluded ${candidates}`;
  return { reason: 'memory-retrieval-excluded', clause };
}

/** A final warning needs all this turn's relevant requests, in order, with proved zero recall. */
export function retrievalReasons(state: State): readonly WitnessedWarning[] {
  const { turnNumber, iteration } = state;
  if (!count(turnNumber) || !count(iteration) || iteration === 0) return [];
  const findings = readOwnList(state.findingsLedger, MAX_FINDINGS_ROWS);
  if (!findings || findings.unread !== 0) return [];
  let expectedIteration = 1;
  let final: { index: number; sources: readonly RecallSourceSummary[] | undefined } | undefined;
  for (const [index, item] of findings.entries.entries()) {
    if (
      item === null ||
      typeof item !== 'object' ||
      Object.getOwnPropertyDescriptor(item, 'kind')?.value !== 'retrieval-request'
    )
      continue;
    const turn = Object.getOwnPropertyDescriptor(item, 'turn')?.value;
    if (count(turn) && turn !== turnNumber) continue;
    const p = readRetrievalRequest(item);
    if (p === undefined) return [];
    if (
      p.iteration !== expectedIteration ||
      p.exposure !== 'absent' ||
      p.accepted !== 'absent' ||
      p.committedProviderResponse !== true
    ) {
      return [];
    }
    expectedIteration++;
    final = { index, sources: p.sources };
  }
  if (final === undefined || expectedIteration !== iteration + 1) return [];
  return (final.sources ?? []).flatMap((source, index) => {
    const warning = warningOf(source);
    return warning === undefined
      ? []
      : [{ ...warning, witness: statePointer('findingsLedger', final.index, 'sources', index) }];
  });
}

/** Rebuild the same words from the committed witnesses for live output and answer accounts. */
export function retrievalWarningClauses(
  assessment: AnswerAssessment,
  state: State | undefined,
): ReadonlyMap<AssessmentReason, readonly string[]> | undefined {
  if (!state || !assessment.reasons.some(({ reason }) => isRetrievalReason(reason)))
    return undefined;
  const clauses = new Map<AssessmentReason, string[]>();
  for (const { reason, clause } of retrievalReasons(state)) {
    const list = clauses.get(reason) ?? [];
    list.push(clause);
    clauses.set(reason, list);
  }
  return clauses.size === 0 ? undefined : clauses;
}

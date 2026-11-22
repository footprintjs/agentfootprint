import type { HistoryCall } from '../recordedCalls.js';
import type { CoverageRow } from './coverageRows.js';
import { REASONS } from './reasons.js';
import type { Gathered } from './gathered.js';
import { reasonSourceOf, type SourceRead } from './sources.js';
import { coverageUsesToolWords, declaredWordsReader } from './results/coverage/stage.js';
import { failureCategoryReader, type FailureSettlement } from './results/outcomes/stage.js';
import { periodUsesToolWords, periodWordsOccurrenceReader } from './results/periods/stage.js';
import type {
  AnswerAssessment,
  AssessmentPointer,
  AssessmentReason,
  AssessmentReasonDetail,
  AssessmentReasonSource,
  AssessmentToolWords,
} from './types.js';

export type RetainedReasonState = (
  key: 'coverageDeclared' | 'findingsLedger' | 'settledToolCalls',
  value: unknown,
) => unknown;

export function reasonUsesToolWords(reason: AssessmentReason): boolean {
  return coverageUsesToolWords(reason) || periodUsesToolWords(reason);
}

interface DetailRead extends ReturnType<typeof failureCategoryReader> {
  readonly wordsFor: (
    reason: AssessmentReason,
    witness: readonly AssessmentPointer[],
  ) => AssessmentToolWords | undefined;
}

/** Ask the result projections for detail only when the fold found its reason. */
export function readReasonDetails(
  g: Gathered,
  calls: readonly HistoryCall[],
  coverage: readonly CoverageRow[],
  state: Readonly<Record<string, unknown>>,
  settlements: ReadonlyMap<string, FailureSettlement> | undefined,
  retain: RetainedReasonState,
): DetailRead {
  const failures = g.fired.has('call-not-completed') ? settlements : undefined;
  const outcomes = failureCategoryReader(calls, failures, () =>
    retain('settledToolCalls', state.settledToolCalls),
  );
  const readWords = [...g.fired.keys()].some(reasonUsesToolWords)
    ? declaredWordsReader(coverage, retain('coverageDeclared', state.coverageDeclared))
    : () => undefined;
  const periodOccurrence = periodWordsOccurrenceReader(() =>
    retain('findingsLedger', state.findingsLedger),
  );
  return {
    ...outcomes,
    wordsFor: (reason, witness) =>
      readWords(reason, witness, periodUsesToolWords(reason) ? periodOccurrence : undefined),
  };
}

function detailOf(
  reason: AssessmentReason,
  witness: readonly AssessmentPointer[],
  read: DetailRead,
): AssessmentReasonDetail | undefined {
  if (reasonUsesToolWords(reason)) {
    const toolSays = read.wordsFor(reason, witness);
    return toolSays === undefined ? undefined : { toolSays };
  }
  if (reason !== 'call-not-completed') return undefined;
  const category = read.failureFor(witness);
  return category === undefined ? undefined : { category };
}

/** Assemble the standing value and project only facts from the witnesses that fired. */
export function assessmentValueOf(
  g: Gathered,
  sourceRead: SourceRead,
  detailRead: DetailRead,
): Pick<AnswerAssessment, 'assessment' | 'reasons'> {
  const reasons = REASONS.flatMap((entry) => {
    const witness = g.fired.get(entry.reason);
    if (witness === undefined) return [];
    const kind: AssessmentReasonSource['kind'] =
      entry.reason === 'value-contingent' &&
      witness.some((w) => w.kind === 'state' && w.path.endsWith('/declaredOn'))
        ? 'answer'
        : entry.source;
    const detail = detailOf(entry.reason, witness, detailRead);
    return [
      {
        reason: entry.reason,
        ...(entry.layer !== undefined && { layer: entry.layer }),
        witness,
        source: reasonSourceOf(entry.reason, kind, witness, sourceRead),
        ...(detail !== undefined && { detail }),
      },
    ];
  });
  const assessment: AnswerAssessment['assessment'] =
    reasons.length > 0
      ? 'unknown'
      : g.support !== undefined
      ? 'known'
      : g.checked.some((c) => c.ran > 0)
      ? 'unrefuted'
      : 'not-applicable';
  return { assessment, reasons };
}

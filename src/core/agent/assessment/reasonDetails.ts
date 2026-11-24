import type { HistoryCall } from '../recordedCalls.js';
import type { CoverageRow } from './coverageRows.js';
import { REASONS } from './reasons.js';
import type { Gathered } from './gathered.js';
import { reasonSourceOf, type SourceRead } from './sources.js';
import { coverageUsesToolWords, declaredWordsReader } from './results/coverage/stage.js';
import { outcomeDetailReader, type OutcomeSettlement } from './results/outcomes/stage.js';
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

interface DetailRead extends ReturnType<typeof outcomeDetailReader> {
  readonly ungroundedEntity?: AssessmentReasonDetail['ungroundedEntity'];
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
  settlements: ReadonlyMap<string, OutcomeSettlement> | undefined,
  retain: RetainedReasonState,
): DetailRead {
  const measured = g.fired.has('call-not-completed') || g.fired.has('work-not-finished');
  const outcomes = outcomeDetailReader(calls, measured ? settlements : undefined, () =>
    retain('settledToolCalls', state.settledToolCalls),
  );
  const readWords = [...g.fired.keys()].some(reasonUsesToolWords)
    ? declaredWordsReader(coverage, retain('coverageDeclared', state.coverageDeclared))
    : () => undefined;
  const periodOccurrence = periodWordsOccurrenceReader(() =>
    retain('findingsLedger', state.findingsLedger),
  );
  const column = g.citations?.findings.find((finding) => finding.kind === 'column');
  return {
    ...outcomes,
    ...(g.fired.has('ungrounded-entity') &&
      column?.kind === 'column' && {
        ungroundedEntity: {
          name: column.name,
          ...(column.nearestName !== undefined && { nearestName: column.nearestName }),
        },
      }),
    wordsFor: (reason, witness) =>
      readWords(reason, witness, periodUsesToolWords(reason) ? periodOccurrence : undefined),
  };
}

function detailOf(
  reason: AssessmentReason,
  witness: readonly AssessmentPointer[],
  read: DetailRead,
): AssessmentReasonDetail | undefined {
  if (reason === 'ungrounded-entity') {
    return read.ungroundedEntity === undefined
      ? undefined
      : { ungroundedEntity: read.ungroundedEntity };
  }
  if (reasonUsesToolWords(reason)) {
    const toolSays = read.wordsFor(reason, witness);
    return toolSays === undefined ? undefined : { toolSays };
  }
  if (reason !== 'call-not-completed' && reason !== 'work-not-finished') return undefined;
  const category = reason === 'call-not-completed' ? read.failureFor(witness) : undefined;
  const counts = read.countsFor(witness);
  if (category === undefined && counts === undefined) return undefined;
  return {
    ...(category !== undefined && { category }),
    ...(counts !== undefined && { counts }),
  };
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

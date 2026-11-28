import { decideFromFacts, decisionRecord } from 'footprintjs';

import { isCut, isLimited } from '../entries.js';
import type { LedgerReader } from '../reader.js';
import { isValueLaw } from '../rules/traceableValues.js';
import type {
  LedgerCoverageOmissions,
  LedgerDelivered,
  LedgerDeliveryCoverage,
  LedgerLimitationKind,
  LedgerNote,
} from '../types.js';
import { missingRanges, spanOf } from '../window.js';
import type { TimeSpan } from '../window.js';

interface CoverageQuestion {
  readonly kind: LedgerLimitationKind;
  readonly receipts: readonly number[];
  readonly span?: TimeSpan;
}

function intersection([a, b]: TimeSpan, [c, d]: TimeSpan): TimeSpan | undefined {
  const start = Math.max(a, c);
  const end = Math.min(b, d);
  return start < end ? [start, end] : undefined;
}

function recordQuestion(
  questions: Map<string, CoverageQuestion>,
  kind: LedgerLimitationKind,
  receipts: readonly number[],
  span?: TimeSpan,
) {
  const refs = [...receipts].sort((a, b) => a - b);
  questions.set(JSON.stringify([kind, refs, span]), {
    kind,
    receipts: refs,
    ...(span === undefined ? {} : { span }),
  });
}

function questionsFor(reader: LedgerReader, notes: readonly LedgerNote[]) {
  const questions = new Map<string, CoverageQuestion>();
  let unassessed = notes.length === 0 ? 1 : 0;
  for (const note of notes) {
    const refs = note.cites.map((seq) => reader.receipt(seq));
    if (refs.length === 0 || refs.some((r) => r === undefined)) unassessed++;
    const claim = note.window === undefined ? undefined : spanOf(note.window);
    const covered: { span: TimeSpan; seq: number }[] = [];
    for (const receipt of refs) {
      if (receipt === undefined) continue;
      const extent = receipt.window === undefined ? undefined : spanOf(receipt.window);
      const relevant =
        claim === undefined || extent === undefined ? extent : intersection(claim, extent);
      if (claim !== undefined && extent !== undefined && relevant === undefined) continue;
      if (relevant !== undefined) covered.push({ span: relevant, seq: receipt.seq });
      if (isCut(receipt)) recordQuestion(questions, 'cut', [receipt.seq], relevant);
      if (isLimited(receipt)) recordQuestion(questions, 'row-limit', [receipt.seq], relevant);
      if (receipt.nothingFound) recordQuestion(questions, 'nothing-found', [receipt.seq], relevant);
    }
    if (claim === undefined || note.noteKind === 'disclosed-gap') continue;
    if (covered.length === 0) unassessed++;
    else
      for (const gap of missingRanges(claim, covered))
        recordQuestion(questions, 'window-gap', gap.receipts, gap.span);
  }
  return { questions: [...questions.values()], unassessed };
}

/** Validate host metadata on each loaded attempt, before anything is appended. */
export function validDeliveryCoverage(
  reader: LedgerReader,
  coverage: LedgerDeliveryCoverage,
): boolean {
  const submit = reader.lastSubmit;
  if (reader.opened?.coverageOmissions !== true || submit?.seq !== coverage.submit) return false;
  const named = new Set(submit.claims);
  return coverage.disclosures.every(({ note: seq, kind, receipts }) => {
    const note = reader.note(seq);
    return (
      named.has(seq) &&
      note?.noteKind === 'disclosed-gap' &&
      (kind !== 'window-gap' || note.window !== undefined) &&
      receipts.every((receipt) => note.cites.includes(receipt))
    );
  });
}

function eligibleBindings(reader: LedgerReader, coverage: LedgerDeliveryCoverage) {
  const checks = reader.checksOf(coverage.submit);
  return coverage.disclosures.flatMap((binding) => {
    const note = reader.note(binding.note);
    if (note === undefined) return [];
    const own = checks.filter(
      (check) => 'note' in check.subject && check.subject.note === note.seq,
    );
    const cited = own.some(
      (check) => check.rule === 'cited@1' && check.disposition === 'checked-pass',
    );
    const values = own.filter((check) => isValueLaw(check.rule));
    if (
      !cited ||
      values.length === 0 ||
      values.some(
        (check) =>
          check.why !== undefined || check.verdict === 'unsupported' || check.counts.missing > 0,
      )
    )
      return [];
    return [
      {
        ...binding,
        ...(note.window === undefined ? {} : { span: spanOf(note.window) }),
      },
    ];
  });
}

function disclosed(
  question: CoverageQuestion,
  bindings: ReturnType<typeof eligibleBindings>,
): boolean {
  const matches = bindings.filter(
    (d) =>
      d.kind === question.kind &&
      question.receipts.every((receipt) => d.receipts.includes(receipt)),
  );
  return question.span === undefined
    ? matches.length > 0
    : missingRanges(
        question.span,
        matches.flatMap((d) => (d.span === undefined ? [] : [{ span: d.span, seq: d.note }])),
      ).length === 0;
}

/** Count only admitted questions, and keep unknown coverage distinct from a clean result. */
export function assessDelivery(
  reader: LedgerReader,
  delivered: LedgerDelivered,
  coverage: LedgerDeliveryCoverage | undefined,
): LedgerCoverageOmissions | undefined {
  if (reader.opened?.coverageOmissions !== true || !delivered.matches) return undefined;
  const submit = reader.lastSubmit;
  const notes =
    submit?.claims.flatMap((seq) => {
      const note = reader.note(seq);
      return note === undefined ? [] : [note];
    }) ?? [];
  const { questions, unassessed } =
    coverage === undefined ? { questions: [], unassessed: 1 } : questionsFor(reader, notes);
  const bindings = coverage === undefined ? [] : eligibleBindings(reader, coverage);
  const assessed = questions.length;
  const omissions = questions.filter((question) => !disclosed(question, bindings)).length;
  const assessment = unassessed === 0 ? 'full' : assessed === 0 ? 'none' : 'partial';
  const verdict = decideFromFacts(
    [
      {
        when: { omissions: { gt: 0 } },
        then: 'omitted',
        label: 'did not say what it could not see',
      },
      {
        when: { unassessed: { gt: 0 } },
        then: 'not-assessed',
        label: 'part of the coverage could not be assessed',
      },
    ],
    { omissions, unassessed },
    { branch: 'no-omission-found', label: 'no coverage omission found' },
  );
  return {
    answerStanding: coverage?.standing ?? null,
    outcome: verdict.branch as LedgerCoverageOmissions['outcome'],
    assessment,
    assessed,
    omissions,
    unassessed,
    decision: { ...decisionRecord(verdict.evidence) },
  };
}

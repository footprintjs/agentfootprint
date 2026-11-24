import {
  assessmentCallOutcome,
  historyCallAt,
  historyCallResolver,
  isRecordedBatchRefusal,
  readHistoryCalls,
} from '../../core/agent/recordedCalls.js';
/** The account's standing and its witnesses, read by the shared assessment fold. */

import { assumedLinesFor } from '../../core/agent/arguments/serve.js';
import { foldState } from '../../core/agent/assessment/assess.js';
import {
  assessmentDataFrom,
  assumedValuesSourceOf,
  reasonUsesToolWords,
  recordedStandingLinesOf,
  rewrittenBehind,
  settledSiblingWitness,
  standingFactsOf,
  standingNamesFrom,
  unreachableWitnessGroups,
} from '../../core/agent/assessment/compose.js';
import { unplacedEvidenceKind } from '../../core/agent/assessment/sources.js';
import type {
  AnswerAssessment,
  AssessmentCheck,
  AssessmentPointer,
  AssessmentReason,
} from '../../core/agent/assessment/types.js';
import { chip, n } from '../render.js';
import type { TemplateId } from '../templates.js';
import type { AnswerFacts, RecordPointer, Sentence } from '../types.js';
import { isKeptOut, keptOut, type RecordingView, type ViewEvent } from '../view.js';
import { MAX_CALLS } from './calls.js';
import { boundedPointer, historyOf, stateAt, type ReadContext } from './common.js';

/** Reasons whose standing line needs the committed rows for its details. */
export const WITNESSED_REASONS: ReadonlySet<AssessmentReason> = new Set([
  'result-cut',
  'placed-unread',
  'times-without-zone',
  'argument-assumed',
  'value-contingent',
  'check-unreachable',
  'call-not-completed',
  'work-not-finished',
  'result-dropped-from-window',
  'memory-retrieval-timeout',
  'memory-retrieval-excluded',
  'step-skipped',
  'ungrounded-entity',
]);

/** The recorded display names, or null if the record cannot supply them in full. */
export function recordedStandingNames(
  end: ViewEvent,
  view: RecordingView,
): ReadonlyMap<string, string> | null | undefined {
  if (keptOut(end, 'standingLineNames')) return null;
  const kept = end.payload.standingLineNames;
  if (kept === undefined) return undefined;
  const names = standingNamesFrom(kept);
  if (
    names === undefined ||
    (view.servedUnderPolicy &&
      [...names].some(([tool, display]) => isKeptOut(tool) || isKeptOut(display)))
  )
    return null;
  return names;
}

/** The standing line can be rebuilt only while the record holds its required witnesses. */
export function recordedStandingWitnesses(
  view: RecordingView,
  reasons: readonly AssessmentReason[],
): AnswerAssessment | undefined {
  const state = view.stateAsRecorded;
  if (state === undefined) return undefined;
  const assessed = foldState(
    state,
    undefined,
    view.servedUnderPolicy,
    undefined,
    undefined,
    view.events,
  );
  if (assessed.keptOut !== undefined) return undefined;
  const complete = reasons.every(
    (reason) =>
      !WITNESSED_REASONS.has(reason) ||
      assessed.reasons.some((r) => r.reason === reason && r.witness.length > 0),
  );
  return complete ? assessed : undefined;
}

/**
 * Standing-line candidates rebuilt from the record. The exact match below
 * selects the wording held by this recorded answer.
 *
 * The line opens with the owner's plain words ("Not sure — ", "Known — "),
 * which a model can write too, so an opening proves nothing. The record does:
 * `turn_end.answerAssessment` exists only on a run whose answer layer folded
 * the standing, and the line is ONE function of that projection
 * (`assessment/compose.ts` · `standingLineOf`) — plus, when a value was
 * assumed, of the rows `assumedValuesSourceOf` reads and the fold's rewrite
 * witness. The account claims only the exact line in its appended position.
 *
 * The fold supplies the witnesses and `turn_end.standingLineNames` supplies names.
 * The account leaves the line unclaimed when required committed state or the
 * complete recorded display names are unavailable.
 */
export function appendedStandingLine(end: ViewEvent, view: RecordingView): readonly string[] {
  // An omitted or unreadable display decision leaves the original answer intact.
  if (
    keptOut(end, 'standingLineOmittedByRaiseOn') ||
    Object.hasOwn(end.payload, 'standingLineOmittedByRaiseOn')
  )
    return [];
  const data = assessmentDataFrom(end.payload.answerAssessment);
  if (data === undefined) return [];
  const displayNames = recordedStandingNames(end, view);
  if (displayNames === null) return [];
  const needsWitnesses = data.reasons.some((reason) => WITNESSED_REASONS.has(reason));
  const plain =
    displayNames === undefined && !needsWitnesses ? recordedStandingLinesOf(data, [], false) : [];
  if (plain.length > 0 && !data.reasons.some(reasonUsesToolWords)) return plain;
  const assessed = recordedStandingWitnesses(view, data.reasons);
  const { state } = view;
  if (assessed === undefined || state === undefined) return plain;
  const source = assumedValuesSourceOf(assessed, state);
  const assumed =
    source === undefined ? [] : assumedLinesFor(source.ledger, source.turn, source.readDecisions);
  const facts = standingFactsOf(assessed, displayNames ?? new Map(), view.stateAsRecorded);
  return recordedStandingLinesOf(data, assumed, rewrittenBehind(assessed), facts);
}

/** The account's standing fact: the owner's word, or "not recorded" when no committed state is. */
type StandingFact = AnswerFacts['standing'];

/**
 * The fold's witnesses as the account's pointers — each identity cut as the
 * account's own builders cut theirs (`common.ts` · `boundedPointer`).
 */
function pointersOf(witness: readonly AssessmentPointer[]): RecordPointer[] {
  return witness.map(boundedPointer);
}

const REASON_LINES: Readonly<Record<AssessmentReason, TemplateId>> = {
  asked: 'howSure.reason.asked',
  'argument-asked': 'howSure.reason.argumentAsked',
  'argument-assumed': 'howSure.reason.argumentAssumed',
  'argument-unverified': 'howSure.reason.argumentUnverified',
  'argument-read': 'howSure.reason.argumentRead',
  'value-contingent': 'howSure.reason.valueContingent',
  'coverage-gap': 'howSure.reason.coverageGap',
  'declared-absent': 'howSure.reason.declaredAbsent',
  'empty-undeclared': 'howSure.reason.emptyUndeclared',
  'call-not-completed': 'howSure.reason.callNotCompleted',
  'result-withheld': 'howSure.reason.resultWithheld',
  'result-cut': 'howSure.reason.resultCut',
  'placed-unread': 'howSure.reason.placedUnread',
  'times-without-zone': 'howSure.reason.timesWithoutZone',
  'result-dropped-from-window': 'howSure.reason.resultDroppedFromWindow',
  'work-not-finished': 'howSure.reason.workNotFinished',
  'memory-retrieval-timeout': 'howSure.reason.memoryRetrievalTimeout',
  'memory-retrieval-excluded': 'howSure.reason.memoryRetrievalExcluded',
  'period-not-held': 'howSure.reason.periodNotHeld',
  'period-partly-held': 'howSure.reason.periodPartlyHeld',
  'period-unknown': 'howSure.reason.periodUnknown',
  'period-undeclared': 'howSure.reason.periodUndeclared',
  'period-differs-from-asked': 'howSure.reason.periodDiffersFromAsked',
  'period-beyond-retention': 'howSure.reason.periodBeyondRetention',
  'sources-conflict': 'howSure.reason.sourcesConflict',
  'value-unsupported': 'howSure.reason.valueUnsupported',
  'value-survived-revision': 'howSure.reason.valueSurvivedRevision',
  'derived-from-reading': 'howSure.reason.derivedFromReading',
  'script-unmatched': 'howSure.reason.scriptUnmatched',
  'stopped-early': 'howSure.reason.stoppedEarly',
  'answer-output-limit': 'howSure.reason.answerOutputLimit',
  'steps-unfinished': 'howSure.reason.stepsUnfinished',
  'step-skipped': 'howSure.reason.stepSkipped',
  'negative-prose-unverified': 'howSure.reason.negativeProseUnverified',
  'invariant-violation': 'howSure.reason.invariantViolation',
  'unsupported-argument': 'howSure.reason.unsupportedArgument',
  'column-type-mismatch': 'howSure.reason.columnTypeMismatch',
  'missing-column': 'howSure.reason.missingColumn',
  'ungrounded-entity': 'howSure.reason.claimUnsettled',
  'unsupported-claim': 'howSure.reason.unsupportedClaim',
  'claim-unsettled': 'howSure.reason.claimUnsettled',
  'claim-exceeds-search': 'howSure.reason.claimExceedsSearch',
  'declaration-overclaimed': 'howSure.reason.declarationOverclaimed',
  'answer-check-failed': 'howSure.reason.answerCheckFailed',
  'check-unreachable': 'howSure.reason.checkUnreachable',
};

/** The reason lines that carry a count of the rows behind them. */
const COUNTED: ReadonlySet<AssessmentReason> = new Set([
  'argument-assumed',
  'argument-unverified',
  'argument-read',
  'value-contingent',
  'coverage-gap',
  'declared-absent',
  'empty-undeclared',
  'work-not-finished',
  'result-dropped-from-window',
  'step-skipped',
  'period-not-held',
  'period-partly-held',
  'period-unknown',
  'period-undeclared',
  'period-differs-from-asked',
  'period-beyond-retention',
  'sources-conflict',
]);

/**
 * The counted lines whose count is CALLS ("1 call declared …"), not rows: one
 * `coverage(absent(…))` files a boundary row AND an absence row, and both can
 * list a gap — one call, two rows. A conflict line counts conflicts (rows).
 */
const COUNTS_CALLS: ReadonlySet<AssessmentReason> = new Set([
  'coverage-gap',
  'declared-absent',
  'empty-undeclared',
  // A period reason's witnesses are the call's `period` row and, when its tool
  // declares a `ToolPeriod`, the inputs layer's `argument` row for the same
  // call — two rows, one call.
  'period-not-held',
  'period-partly-held',
  'period-unknown',
  'period-undeclared',
  'period-differs-from-asked',
  'period-beyond-retention',
]);

const UNPLACED_LINES = {
  legacy: 'howSure.reason.unplacedEvidence',
  'result-unavailable': 'howSure.reason.resultUnavailable',
  'call-unreadable': 'howSure.reason.callAddressUnreadable',
} as const;

/**
 * How many calls a reason rests on — read off the reason's own `source`, the
 * fold's one answer to "which calls" (`assessment/sources.ts` ·
 * `reasonSourceOf`): the calls it names, plus those the record does not name
 * in full, each counted once — never re-derived here. A reason that rests on
 * the answer or the run stands for no call: its rows are counted instead.
 */
function callsBehind(r: AnswerAssessment['reasons'][number]): number {
  return r.source.kind === 'calls'
    ? r.source.calls.length + (r.source.unnamed ?? 0)
    : r.witness.length;
}

const CALL_OUTCOME_LINES = {
  refused: 'howSure.reason.callRefused',
  failed: 'howSure.reason.callFailed',
  'not-dispatched': 'howSure.reason.callNotDispatched',
  unknown: REASON_LINES['call-not-completed'],
} as const;

/** Each line counts and points to the outcomes at the witnesses' own history positions. */
function callOutcomeLines(ctx: ReadContext, r: AnswerAssessment['reasons'][number]): Sentence[] {
  const history = historyOf(ctx.view);
  const groups: Record<keyof typeof CALL_OUTCOME_LINES, AssessmentPointer[]> = {
    refused: [],
    failed: [],
    'not-dispatched': [],
    unknown: [],
  };
  for (const w of r.witness) {
    if (settledSiblingWitness(w)) {
      groups['not-dispatched'].push(w);
      continue;
    }
    const row = w.kind === 'history' ? historyCallAt(history, w.index)?.message : undefined;
    const message =
      w.kind === 'history'
        ? Object.getOwnPropertyDescriptor(history, String(w.index))?.value
        : undefined;
    const outcome =
      row !== undefined
        ? assessmentCallOutcome(row)
        : isRecordedBatchRefusal(message)
        ? 'refused'
        : undefined;
    groups[outcome ?? 'unknown'].push(w);
  }
  return (['refused', 'failed', 'not-dispatched', 'unknown'] as const).flatMap((outcome) => {
    const witnesses = groups[outcome];
    if (witnesses.length === 0) return [];
    return ctx.say(CALL_OUTCOME_LINES[outcome], {
      vars: { n: n(witnesses.length) },
      ...recordedAt(pointersOf(witnesses)),
      item: true,
    });
  });
}

const CHECK_LINES: Readonly<Record<AssessmentCheck, TemplateId>> = {
  'argument-rules': 'howSure.check.argumentRules',
  'argument-sources': 'howSure.check.argumentSources',
  'result-period': 'howSure.check.resultPeriod',
  'tool-coverage': 'howSure.check.toolCoverage',
  'result-shape': 'howSure.check.resultShape',
  'names-and-numbers': 'howSure.check.namesAndNumbers',
  'script-match': 'howSure.check.scriptMatch',
  'answer-checks': 'howSure.check.answerChecks',
};

/** A standing this record cannot give — said so, with the one template that says why. */
function noStanding(
  ctx: ReadContext,
  id: 'howSure.standing.none' | 'howSure.standing.noAnswer' | 'howSure.standing.keptOut',
): { lines: Sentence[]; fact: StandingFact } {
  const missing = id === 'howSure.standing.keptOut' ? 'redacted' : 'no-event';
  return {
    lines: [
      ctx.say(id, {
        status: 'not-recorded',
        missing,
        chips: [chip('not-recorded', 'chip.notRecorded')],
      }),
    ],
    fact: {
      value: null,
      source: 'library',
      status: 'not-recorded',
      pointers: [],
      missing,
    },
  };
}

/**
 * The answer's standing — the ONE fold (`core/agent/assessment/assess.ts` ·
 * `assessAnswer`) over the run's committed state, rendered. The fold reads
 * committed state and any exact declaration addresses established by the
 * recording. The same state decides the standing on a pause. Settled first,
 * from the events: a record with no answer
 * (no `turn_end`) that did not end in a pause gets no standing — the run threw,
 * a rule stopped it before it answered, or the recording ends early, and the
 * fold cannot tell those from the committed state (`agent.assessment()`
 * returns `undefined` there). A refused answer still has a `turn_end`: the
 * account rates the answer the record holds. The fold is handed the state AS
 * RECORDED: where it would read a key the record keeps out (a redaction
 * policy's placeholder), it gives no standing (`AnswerAssessment.keptOut`),
 * and neither does the account.
 */
export function standingLines(
  ctx: ReadContext,
  declarationAddresses?: ReadonlyMap<number, number>,
): { lines: Sentence[]; fact: StandingFact } {
  const state = ctx.view.stateAsRecorded;
  if (state === undefined) return noStanding(ctx, 'howSure.standing.none');
  const a = foldState(
    state,
    ctx.declarations,
    ctx.view.servedUnderPolicy,
    undefined,
    declarationAddresses,
    ctx.view.events,
  );
  if (a.keptOut !== undefined) return noStanding(ctx, 'howSure.standing.keptOut');
  if (a.standing !== 'ask' && ctx.view.last('agent.turn_end') === undefined) {
    return noStanding(ctx, 'howSure.standing.noAnswer');
  }
  const reasonPointers = pointersOf(a.reasons.flatMap((r) => r.witness));
  const { conflict, dispatch, validator, libraryLimits } = unreachableWitnessGroups(
    a.reasons.find(({ reason }) => reason === 'check-unreachable')?.witness ?? [],
  );
  const accompanyingReasons =
    conflict.length === 0 && libraryLimits.length === 0
      ? 0
      : [conflict, libraryLimits, dispatch, validator].filter((rows) => rows.length > 0).length - 1;
  const ran = a.checked.filter((c) => c.ran > 0);
  const lines: Sentence[] = [];
  let resolve: ReturnType<typeof historyCallResolver> | undefined;
  switch (a.standing) {
    case 'known':
      lines.push(
        ctx.say('howSure.standing.known', { pointers: [stateAt('answerValidation', 'status')] }),
      );
      break;
    case 'consistent':
      lines.push(
        ctx.say('howSure.standing.consistent', {
          vars: { n: n(ran.length) },
          pointers: pointersOf(ran.flatMap((c) => c.witness)),
        }),
        ...ran.map((c) =>
          ctx.say(CHECK_LINES[c.check], {
            vars: { ran: n(c.ran), of: n(c.of) },
            pointers: pointersOf(c.witness),
            item: true,
          }),
        ),
      );
      break;
    case 'not-sure':
    case 'ask':
      lines.push(
        ctx.say(a.standing === 'ask' ? 'howSure.standing.ask' : 'howSure.standing.notSure', {
          ...(a.standing === 'not-sure' && {
            vars: { n: n(a.reasons.length + accompanyingReasons) },
          }),
          ...recordedAt(reasonPointers),
        }),
        ...a.reasons.flatMap((r) => {
          if (r.reason === 'call-not-completed') return callOutcomeLines(ctx, r);
          const unplaced = r.source.kind === 'calls' ? r.source.unplaced ?? [] : [];
          const count = COUNTS_CALLS.has(r.reason) ? callsBehind(r) : r.witness.length;
          let template: TemplateId = REASON_LINES[r.reason];
          if (r.reason === 'check-unreachable') {
            if (conflict.length > 0 || libraryLimits.length > 0) {
              const causes = [
                ['howSure.reason.conflictReadingsUnplaced', conflict],
                ['howSure.reason.libraryLimitsIncomplete', libraryLimits],
                ['howSure.reason.dispatchProofUnavailable', dispatch],
                ['howSure.reason.checkUnreachable', validator],
              ] as const;
              return causes.flatMap(([id, witnesses]) =>
                witnesses.length === 0
                  ? []
                  : [ctx.say(id, { ...recordedAt(pointersOf(witnesses)), item: true })],
              );
            }
            if (dispatch.length > 0) template = 'howSure.reason.dispatchProofUnavailable';
          }
          const line =
            unplaced.length > 0 && count === 0
              ? []
              : [
                  ctx.say(template, {
                    ...(COUNTED.has(r.reason) && {
                      vars: { n: n(count) },
                    }),
                    ...recordedAt(pointersOf(r.witness)),
                    item: true,
                  }),
                ];
          if (unplaced.length === 0) return line;
          resolve ??= historyCallResolver(readHistoryCalls(historyOf(ctx.view)));
          const groups = new Map<TemplateId, AssessmentPointer[]>();
          for (const pointer of unplaced) {
            const template =
              UNPLACED_LINES[unplacedEvidenceKind(r.reason, pointer, state, resolve)];
            const group = groups.get(template) ?? [];
            group.push(pointer);
            groups.set(template, group);
          }
          return [
            ...line,
            ...[...groups].map(([template, group]) =>
              ctx.say(template, {
                vars: { n: n(group.length) },
                ...recordedAt(pointersOf(group)),
                item: true,
              }),
            ),
          ];
        }),
      );
      break;
    case 'not-assessed':
      lines.push(ctx.say('howSure.standing.notAssessed', { status: 'not-applicable' }));
      break;
  }
  // A fact lists at most MAX_CALLS pointers (law 8, the `limitsData`
  // precedent): one per witness row would grow with the record. The lines
  // above count every row; only the listing is capped.
  const factPointers = (
    a.standing === 'known'
      ? [stateAt('answerValidation', 'status')]
      : a.standing === 'consistent'
      ? pointersOf(ran.flatMap((c) => c.witness))
      : reasonPointers
  ).slice(0, MAX_CALLS);
  return {
    lines,
    fact: {
      value: a.standing,
      source: 'library',
      status: a.standing === 'not-assessed' ? 'not-applicable' : 'recorded',
      pointers: factPointers,
    },
  };
}

/** A line is `recorded` only when it points into the record. */
function recordedAt(pointers: readonly RecordPointer[]): {
  pointers: readonly RecordPointer[];
  status?: 'not-recorded';
  missing?: 'no-event';
} {
  return pointers.length > 0
    ? { pointers }
    : { pointers, status: 'not-recorded', missing: 'no-event' };
}

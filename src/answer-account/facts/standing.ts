import { historyCallAt } from '../../core/agent/recordedCalls.js';
/** The account's standing and its witnesses, read by the shared assessment fold. */

import { foldState } from '../../core/agent/assessment/assess.js';
import { standingNamesFrom } from '../../core/agent/assessment/compose.js';
import type {
  AnswerAssessment,
  AssessmentCheck,
  AssessmentPointer,
  AssessmentReason,
} from '../../core/agent/assessment/types.js';
import { recordedCallOutcome } from '../../semantics/toolOutcome.js';
import { chip, n } from '../render.js';
import type { TemplateId } from '../templates.js';
import type { AnswerFacts, RecordPointer, Sentence } from '../types.js';
import { isKeptOut, keptOut, type RecordingView, type ViewEvent } from '../view.js';
import { MAX_CALLS } from './calls.js';
import { boundedPointer, historyOf, stateAt, type ReadContext } from './common.js';

/** Reasons whose standing line needs the committed rows for its details. */
export const WITNESSED_REASONS: ReadonlySet<AssessmentReason> = new Set([
  'argument-assumed',
  'call-not-completed',
  'work-not-finished',
  'step-skipped',
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
  const assessed = foldState(state, undefined, view.servedUnderPolicy);
  if (assessed.keptOut !== undefined) return undefined;
  const complete = reasons.every(
    (reason) =>
      !WITNESSED_REASONS.has(reason) ||
      assessed.reasons.some((r) => r.reason === reason && r.witness.length > 0),
  );
  return complete ? assessed : undefined;
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
  'work-not-finished': 'howSure.reason.workNotFinished',
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
  'steps-unfinished': 'howSure.reason.stepsUnfinished',
  'step-skipped': 'howSure.reason.stepSkipped',
  'negative-prose-unverified': 'howSure.reason.negativeProseUnverified',
  'invariant-violation': 'howSure.reason.invariantViolation',
  'unsupported-argument': 'howSure.reason.unsupportedArgument',
  'column-type-mismatch': 'howSure.reason.columnTypeMismatch',
  'missing-column': 'howSure.reason.missingColumn',
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
  unknown: REASON_LINES['call-not-completed'],
} as const;

/** Each line counts and points to the outcomes at the witnesses' own history positions. */
function callOutcomeLines(ctx: ReadContext, r: AnswerAssessment['reasons'][number]): Sentence[] {
  const history = historyOf(ctx.view);
  const groups: Record<keyof typeof CALL_OUTCOME_LINES, AssessmentPointer[]> = {
    refused: [],
    failed: [],
    unknown: [],
  };
  for (const w of r.witness) {
    const row = w.kind === 'history' ? historyCallAt(history, w.index)?.message : undefined;
    const outcome = row === undefined ? undefined : recordedCallOutcome(row);
    groups[outcome ?? 'unknown'].push(w);
  }
  return (['refused', 'failed', 'unknown'] as const).flatMap((outcome) => {
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
  );
  if (a.keptOut !== undefined) return noStanding(ctx, 'howSure.standing.keptOut');
  if (a.standing !== 'ask' && ctx.view.last('agent.turn_end') === undefined) {
    return noStanding(ctx, 'howSure.standing.noAnswer');
  }
  const reasonPointers = pointersOf(a.reasons.flatMap((r) => r.witness));
  const ran = a.checked.filter((c) => c.ran > 0);
  const lines: Sentence[] = [];
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
          ...(a.standing === 'not-sure' && { vars: { n: n(a.reasons.length) } }),
          ...recordedAt(reasonPointers),
        }),
        ...a.reasons.flatMap((r) => {
          if (r.reason === 'call-not-completed') return callOutcomeLines(ctx, r);
          const unplaced = r.source.kind === 'calls' ? r.source.unplaced ?? [] : [];
          const count = COUNTS_CALLS.has(r.reason) ? callsBehind(r) : r.witness.length;
          const line =
            unplaced.length > 0 && count === 0
              ? []
              : [
                  ctx.say(REASON_LINES[r.reason], {
                    ...(COUNTED.has(r.reason) && {
                      vars: { n: n(count) },
                    }),
                    ...recordedAt(pointersOf(r.witness)),
                    item: true,
                  }),
                ];
          if (unplaced.length === 0) return line;
          return [
            ...line,
            ctx.say('howSure.reason.unplacedEvidence', {
              vars: { n: n(unplaced.length) },
              ...recordedAt(pointersOf(unplaced)),
              item: true,
            }),
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

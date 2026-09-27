/**
 * Row "How sure" — what the record holds about how sure the answer is, side by
 * side:
 *   - the whole-answer standing, FIRST: the one fold
 *     (`core/agent/assessment/assess.ts` · `assessAnswer`) over the run's
 *     committed state — known · consistent with the record · not sure (with the
 *     reasons) · ask · not assessed — never read from this recording's events,
 *     and never "known" from silence. The lines below stay facts beside it; the
 *     standing is the only verdict, and it is the fold's, not this row's;
 *   - the model's pre-call expectation (`findings.declared`) — "how useful it
 *     expected the result to be", never a confidence — and, beside it, the
 *     call's outcome as its own fact (a declared absence can BE the direct,
 *     useful answer, so no "instead" joins the two);
 *   - the evidence check (the LAST `agent.evidence_checked` of the answering
 *     iteration). `lookedUp` splits looked-up values from exempt ones; a run
 *     recorded before it gets the unsplit line, which makes no count claim. The
 *     event slices `unsupported` at 12, so a full list says "at least".
 */

import { assessAnswer } from '../../../core/agent/assessment/assess.js';
import type {
  AssessmentCheck,
  AssessmentPointer,
  AssessmentReason,
} from '../../../core/agent/assessment/types.js';
import { MAX_REPORTED_VALUES } from '../../../core/agent/evidence/limits.js';
import { chip, joinAnd, n, v } from '../render.js';
import type { TemplateId } from '../templates.js';
import type { AnswerFacts, EvidenceFact, AccountFact, RecordPointer, Sentence } from '../types.js';
import { isRecord, num, str, type ViewEvent } from '../view.js';
import { at, emptinessSource, stateAt, takeItem, type ReadContext } from './common.js';
import type { CallsRead } from './calls.js';
import { MAX_LISTED_CALLS } from './checked.js';

/** A flagged value is a name or a number from the answer; longer is clipped. */
export const FLAGGED_VALUE_CHARS = 200;

export interface HowSureRead {
  readonly lines: readonly Sentence[];
  readonly evidence: AccountFact<EvidenceFact>;
  readonly standing: AnswerFacts['standing'];
}

/**
 * The FINAL evidence verdict on THIS answer: the last `agent.evidence_checked`
 * of the answering iteration, and only when it is a verdict (not the
 * `revision-asked` row that precedes a revision). Never another iteration's
 * row — a verdict on a draft is not a verdict on the answer — and nothing at
 * all when the answering iteration is unknown: the line then says "not
 * recorded".
 */
function evidenceEvent(ctx: ReadContext): ViewEvent | undefined {
  if (ctx.answeringIteration === undefined) return undefined;
  const ofAnswer = ctx.view
    .ofType('agent.evidence_checked')
    .filter((e) => e.payload.iteration === ctx.answeringIteration);
  const last = ofAnswer[ofAnswer.length - 1];
  return last?.payload.action === 'revision-asked' ? undefined : last;
}

function expectationLines(ctx: ReadContext, calls: CallsRead): Sentence[] {
  const lines: Sentence[] = [];
  // Every call the model declared an expectation for; the first MAX_LISTED_CALLS are printed.
  const declared = calls.all.filter(
    (c) => !c.unnamed && str(c.findings?.payload.basis) !== undefined,
  );
  for (const call of declared.slice(0, MAX_LISTED_CALLS)) {
    const f = call.findings;
    const basis = str(f?.payload.basis);
    if (f === undefined || basis === undefined) continue;
    if (call.unnamed) continue;
    const tool = call.tool;
    const expect = str(f.payload.expect);
    lines.push(
      basis === 'direct'
        ? expect !== undefined
          ? ctx.say('howSure.expected.direct', {
              vars: { tool, expect: v(expect, 'model', at(f, 'expect')) },
              pointers: [at(f, 'basis')],
            })
          : ctx.say('howSure.expected.directNoRating', {
              vars: { tool },
              pointers: [at(f, 'basis')],
            })
        : ctx.say('howSure.expected.exploratory', { vars: { tool }, pointers: [at(f, 'basis')] }),
    );
    if (call.fact.outcome !== 'ran' || call.fact.withheldBy !== undefined || call.end === undefined)
      continue;
    if (call.emptiness.emptiness === 'declared-absent') {
      lines.push(
        ctx.say('howSure.outcome.nothing', {
          vars: { tool: call.tool },
          pointers: [
            call.end.payload.status !== undefined
              ? at(call.end, 'status')
              : at(call.end, 'toolCallId'),
          ],
        }),
      );
    } else if (call.emptiness.emptiness === 'undeclared-empty') {
      lines.push(
        ctx.say('howSure.outcome.empty', {
          basis: [emptinessSource(call.emptiness)],
          pointers: [
            { kind: 'event', index: call.end.index, type: call.end.type, path: '#emptiness' },
          ],
        }),
      );
    }
  }
  const hidden = declared.length - Math.min(declared.length, MAX_LISTED_CALLS);
  if (hidden > 0) {
    lines.push(
      ctx.say('howSure.expected.more', {
        vars: { n: n(hidden) },
        pointers: declared
          .slice(MAX_LISTED_CALLS)
          .flatMap((c) => (c.findings ? [at(c.findings, 'basis')] : [])),
      }),
    );
  }
  return lines;
}

function evidenceLines(ctx: ReadContext, e: ViewEvent, fact: EvidenceFact): Sentence[] {
  const { say } = ctx;
  /** A pointer only to a leaf the row actually holds. */
  const leafAt = (key: string) => (e.payload[key] !== undefined ? [at(e, key)] : []);
  const lines: Sentence[] = [];
  const candidates = at(e, 'candidates'); // required to read the row at all
  if (fact.candidates === 0) {
    lines.push(say('howSure.evidence.empty', { pointers: [candidates] }));
  } else if (fact.unsupported.length > 0) {
    const values = fact.unsupported;
    const valuePointers = values.map((_, i) => at(e, 'unsupported', i, 'value'));
    if (fact.capped) {
      lines.push(
        say('howSure.evidence.flagged.atLeast', {
          vars: { n: n(values.length) },
          pointers: [...leafAt('action'), candidates],
        }),
      );
    } else if (values.length <= 3) {
      lines.push(
        say('howSure.evidence.flagged', {
          vars: {
            n: n(values.length),
            values: v(
              joinAnd(values.map((x) => `“${x.slice(0, FLAGGED_VALUE_CHARS)}”`)),
              'library',
            ),
          },
          pointers: [...leafAt('action'), ...valuePointers],
        }),
      );
    } else {
      lines.push(
        say('howSure.evidence.flagged.list', {
          vars: { n: n(values.length) },
          pointers: [...leafAt('action'), candidates],
        }),
      );
    }
    if (fact.capped || values.length > 3) {
      let listed = 0;
      values.forEach((value, i) => {
        if (!takeItem(ctx, Math.min(value.length, FLAGGED_VALUE_CHARS))) return;
        listed += 1;
        lines.push(
          say('howSure.evidence.value', {
            vars: {
              value: v(value, 'library', at(e, 'unsupported', i, 'value'), FLAGGED_VALUE_CHARS),
            },
            item: true,
          }),
        );
      });
      if (listed < values.length) {
        lines.push(
          say('items.more', {
            vars: { n: n(values.length - listed) },
            pointers: [at(e, 'candidates')],
            item: true,
          }),
        );
      }
    }
  } else if (fact.lookedUp !== undefined && fact.lookedUp > 0) {
    lines.push(
      say('howSure.evidence.lookedUp', {
        vars: { lookedUp: v(fact.lookedUp, 'library', at(e, 'lookedUp')) },
      }),
    );
  } else if (fact.lookedUp === 0) {
    lines.push(
      say('howSure.evidence.lookedUp.none', { pointers: [at(e, 'lookedUp'), candidates] }),
    );
  } else {
    lines.push(say('howSure.evidence.unsplit', { pointers: [candidates, ...leafAt('action')] }));
  }
  if (fact.afterRevision)
    lines.push(say('howSure.evidence.revised', { pointers: [at(e, 'afterRevision')] }));
  if (fact.truncated === true)
    lines.push(say('howSure.evidence.truncated', { pointers: [at(e, 'evidenceTruncated')] }));
  return lines;
}

/** The account's standing fact: the owner's word, or "not recorded" when no committed state is. */
type StandingFact = AnswerFacts['standing'];

/** Witness rows the account can point at (a checkpoint is never in a recording). */
function pointersOf(witness: readonly AssessmentPointer[]): RecordPointer[] {
  return witness.flatMap((w): RecordPointer[] => (w.kind === 'checkpoint' ? [] : [w]));
}

const REASON_LINES: Readonly<Record<AssessmentReason, TemplateId>> = {
  asked: 'howSure.reason.asked',
  'coverage-gap': 'howSure.reason.coverageGap',
  'declared-absent': 'howSure.reason.declaredAbsent',
  'empty-undeclared': 'howSure.reason.emptyUndeclared',
  'sources-conflict': 'howSure.reason.sourcesConflict',
  'value-unsupported': 'howSure.reason.valueUnsupported',
  'value-survived-revision': 'howSure.reason.valueSurvivedRevision',
  'stopped-early': 'howSure.reason.stoppedEarly',
  'answer-check-failed': 'howSure.reason.answerCheckFailed',
  'check-unreachable': 'howSure.reason.checkUnreachable',
};

/** The reason lines that carry a count of the rows behind them. */
const COUNTED: ReadonlySet<AssessmentReason> = new Set([
  'coverage-gap',
  'declared-absent',
  'empty-undeclared',
  'sources-conflict',
]);

const CHECK_LINES: Readonly<Record<AssessmentCheck, TemplateId>> = {
  'tool-coverage': 'howSure.check.toolCoverage',
  'result-shape': 'howSure.check.resultShape',
  'names-and-numbers': 'howSure.check.namesAndNumbers',
  'answer-checks': 'howSure.check.answerChecks',
};

/**
 * The answer's standing — the ONE fold (`core/agent/assessment/assess.ts` ·
 * `assessAnswer`) over the run's committed state, rendered. The fold reads
 * committed rows only, never this recording's events, so the account and every
 * other reader of the same run say the same standing.
 */
function standingLines(ctx: ReadContext): { lines: Sentence[]; fact: StandingFact } {
  const state = ctx.view.state;
  if (state === undefined) {
    return {
      lines: [
        ctx.say('howSure.standing.none', {
          status: 'not-recorded',
          missing: 'no-event',
          chips: [chip('not-recorded', 'chip.notRecorded')],
        }),
      ],
      fact: {
        value: null,
        source: 'library',
        status: 'not-recorded',
        pointers: [],
        missing: 'no-event',
      },
    };
  }
  const a = assessAnswer({ snapshot: { sharedState: state } }, ctx.declarations);
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
        ...a.reasons.map((r) =>
          ctx.say(REASON_LINES[r.reason], {
            ...(COUNTED.has(r.reason) && { vars: { n: n(r.witness.length) } }),
            ...recordedAt(pointersOf(r.witness)),
            item: true,
          }),
        ),
      );
      break;
    case 'not-assessed':
      lines.push(ctx.say('howSure.standing.notAssessed', { status: 'not-applicable' }));
      break;
  }
  const factPointers =
    a.standing === 'known'
      ? [stateAt('answerValidation', 'status')]
      : a.standing === 'consistent'
      ? pointersOf(ran.flatMap((c) => c.witness))
      : reasonPointers;
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

/** A line is `recorded` only when it points into the record — a pending ask lives in the checkpoint, not here. */
function recordedAt(pointers: readonly RecordPointer[]): {
  pointers: readonly RecordPointer[];
  status?: 'not-recorded';
  missing?: 'no-event';
} {
  return pointers.length > 0
    ? { pointers }
    : { pointers, status: 'not-recorded', missing: 'no-event' };
}

export function readHowSure(ctx: ReadContext, calls: CallsRead): HowSureRead {
  const standing = standingLines(ctx);
  const lines: Sentence[] = [...standing.lines, ...expectationLines(ctx, calls)];
  const e = evidenceEvent(ctx);
  const posture = str(e?.payload.posture);
  const candidates = num(e?.payload.candidates);
  const readable =
    e !== undefined &&
    posture !== undefined &&
    candidates !== undefined &&
    Array.isArray(e.payload.unsupported) &&
    // Every entry must be readable, so a value's index is its index on the record.
    e.payload.unsupported.every((u) => isRecord(u) && typeof u.value === 'string');
  if (e !== undefined && !readable) ctx.noteUnread();
  if (e !== undefined && readable && posture !== undefined && candidates !== undefined) {
    // The event slices at MAX_REPORTED_VALUES; a longer (hand-built) list is read to the same cap.
    const unsupported = (e.payload.unsupported as { value: string }[])
      .slice(0, MAX_REPORTED_VALUES)
      .map((u) => u.value);
    const lookedUp = num(e.payload.lookedUp);
    const fact: EvidenceFact = {
      posture,
      candidates,
      ...(lookedUp !== undefined && { lookedUp }),
      unsupported,
      capped: unsupported.length >= MAX_REPORTED_VALUES,
      action: str(e.payload.action) ?? '',
      afterRevision: e.payload.afterRevision === true,
      ...(e.payload.evidenceTruncated === true && { truncated: true }),
    };
    lines.push(...evidenceLines(ctx, e, fact));
    // The fact carries each flagged value cut at FLAGGED_VALUE_CHARS (the lines carry the same, marked clipped).
    const stored: EvidenceFact = {
      ...fact,
      unsupported: unsupported.map((x) => x.slice(0, FLAGGED_VALUE_CHARS)),
    };
    return {
      lines,
      standing: standing.fact,
      evidence: {
        value: stored,
        source: 'library',
        status: 'recorded',
        pointers: [at(e, 'posture'), at(e, 'candidates')],
      },
    };
  }
  const configured = ctx.view.first('agent.run_configured');
  if (configured !== undefined && configured.payload.evidenceGate === undefined) {
    lines.push(
      ctx.say('howSure.evidence.off', {
        status: 'not-applicable',
        pointers: [
          { kind: 'event', index: configured.index, type: configured.type, path: '#meta/runId' },
        ],
      }),
    );
    return {
      lines,
      standing: standing.fact,
      evidence: { value: null, source: 'library', status: 'not-applicable', pointers: [] },
    };
  }
  lines.push(
    ctx.say('howSure.evidence.notRecorded', {
      status: 'not-recorded',
      missing: 'no-event',
      chips: [chip('not-recorded', 'chip.notRecorded')],
    }),
  );
  return {
    lines,
    standing: standing.fact,
    evidence: {
      value: null,
      source: 'library',
      status: 'not-recorded',
      pointers: [],
      missing: 'no-event',
    },
  };
}

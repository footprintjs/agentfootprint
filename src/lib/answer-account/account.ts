/**
 * `accountForAnswer` — one answer's recording (+ what the app declared) in, a
 * typed account out. A pure read-time Fold over the Trace: no clock, network,
 * model or randomness; the same inputs give the same bytes. It never writes
 * back into the run.
 *
 * It throws ONLY on a caller error (a recording that is not an object,
 * declarations that break their rules). Content it cannot read is passed over
 * and counted (`unread`); a line whose fill fails becomes `unreadable.line@1`.
 */

import { COVERAGE_BLOCK_HEADING } from '../../core/agent/coverage/answer.js';
import type { Recording } from '../../recorders/observability/recordRun.js';
import { chip, clipFact, MAX_VAR_CHARS, saidBy, sentence } from './render.js';
import { ANSWER_ACCOUNT_TEMPLATE_SET_VERSION, type TemplateId } from './templates.js';
import type {
  AccountSource,
  AnswerAccount,
  AnswerAccountDeclarations,
  Chip,
  Fact,
  FactStatus,
  Row,
  RowId,
  RunFact,
  Sentence,
} from './types.js';
import { validateDeclarations } from './declarations.js';
import { num, str, recordingView, type RecordingView } from './view.js';
import {
  at,
  derived,
  makeSay,
  stateAt,
  type AccountInternals,
  type ReadContext,
} from './facts/common.js';
import { readAsked } from './facts/asked.js';
import { readUnderstood } from './facts/understood.js';
import { FACT_TEXT_CHARS, MAX_CALLS, readCalls } from './facts/calls.js';
import { answeringIteration, readInView } from './facts/inView.js';
import { readBeforePause, readCheckedRows } from './facts/checked.js';
import { readFoundRow } from './facts/found.js';
import { readHowSure } from './facts/howSure.js';
import { runChecks, summaryOf, wrongLines } from './signals.js';

export interface AccountOptions {
  /** The stored artifact's `meta.origin.runId`, when the caller has it — preferred over the recording's own. */
  readonly runId?: string;
}

/** The answer text the account carries (the PDF folds at 1,200); the rest is in the record. */
export const MAX_ANSWER_CHARS = 4000;

const HEADINGS: Readonly<Record<RowId, TemplateId>> = {
  asked: 'row.asked',
  understood: 'row.understood',
  checked: 'row.checked',
  'not-checked': 'row.notChecked',
  found: 'row.found',
  'how-sure': 'row.howSure',
  'anything-wrong': 'row.wrong',
};

/** recorded if any line is; not-applicable if every line is; else not-recorded. */
function rowStatus(lines: readonly Sentence[]): FactStatus {
  if (lines.some((l) => l.status === 'recorded')) return 'recorded';
  if (lines.length > 0 && lines.every((l) => l.status === 'not-applicable'))
    return 'not-applicable';
  return 'not-recorded';
}

function saidByChips(lines: readonly Sentence[]): Chip[] {
  const sources: AccountSource[] = [];
  for (const line of lines) {
    if (line.status === 'recorded' && !sources.includes(line.source)) sources.push(line.source);
  }
  return sources.map(saidBy);
}

function row(
  id: RowId,
  lines: readonly Sentence[],
  extra: { more?: Sentence; chips?: readonly Chip[] } = {},
): Row {
  const status = rowStatus(lines);
  return {
    id,
    heading: sentence(HEADINGS[id], { status: 'not-applicable' }),
    lines,
    ...(extra.more !== undefined && { more: extra.more }),
    chips: [...(extra.chips ?? []), ...saidByChips(lines)],
    status,
  };
}

/** The answer, and the library-appended limits block split off it (`.limitsTravelWithTheAnswer()`). */
function readAnswer(view: RecordingView): { answer: Fact<string>; limits: Fact<string> } {
  const end = view.last('agent.turn_end');
  const content = str(end?.payload.finalContent);
  const none: Fact<string> = {
    value: null,
    source: 'library',
    status: 'not-recorded',
    pointers: [],
    missing: 'no-event',
  };
  if (end === undefined || content === undefined) {
    return {
      answer: none,
      limits: { value: null, source: 'library', status: 'not-applicable', pointers: [] },
    };
  }
  const pointer = at(end, 'finalContent');
  const heading = `${COVERAGE_BLOCK_HEADING} — declared by the tools that produced it, not by the model:`;
  const cut = content.lastIndexOf(heading);
  if (cut < 0) {
    return {
      answer: {
        ...clipFact(content, MAX_ANSWER_CHARS),
        source: 'model',
        status: 'recorded',
        pointers: [pointer],
      },
      limits: { value: null, source: 'library', status: 'not-applicable', pointers: [] },
    };
  }
  const model = content.slice(0, cut).replace(/\n\n---\n\n$/, '');
  return {
    answer: {
      ...clipFact(model, MAX_ANSWER_CHARS),
      source: 'model',
      status: 'recorded',
      pointers: [pointer],
    },
    limits: {
      ...clipFact(content.slice(cut), MAX_ANSWER_CHARS),
      source: 'library',
      status: 'recorded',
      pointers: [pointer],
    },
  };
}

function readRun(view: RecordingView, resumedLeg: boolean): Fact<RunFact> {
  const configured = view.first('agent.run_configured');
  const model = str((configured?.payload.llm as Record<string, unknown> | undefined)?.model);
  const turnNumber = num(view.state?.turnNumber);
  if (view.runId === undefined) {
    return {
      value: null,
      source: 'library',
      status: 'not-recorded',
      pointers: [],
      missing: 'no-event',
    };
  }
  const anchor = configured ?? view.events[0];
  return {
    value: {
      runId: view.runId,
      ...(turnNumber !== undefined && { turnNumber }),
      ...(model !== undefined && { model }),
      resumedLeg,
    },
    source: 'library',
    status: 'recorded',
    pointers: [
      ...(anchor !== undefined ? [derived(anchor, '#meta/runId')] : []),
      ...(configured !== undefined && model !== undefined ? [at(configured, 'llm', 'model')] : []),
      ...(turnNumber !== undefined ? [stateAt('turnNumber')] : []),
    ],
  };
}

/**
 * The account of a run that owns NO event of this record — an options.runId
 * that is not this recording's, or a recording with no readable event. The
 * record's silence is not evidence: every row says the run is not in this
 * record, nothing is claimed about it (no "did not run any tools", no "did not
 * finish"), and the hosting op may map it to `summary.notAvailable@1`.
 */
function noOwnEventsAccount(
  view: RecordingView,
  say: ReadContext['say'],
  unread: () => number,
): AnswerAccount {
  const missing = { status: 'not-recorded' as const, missing: 'no-event' as const };
  const none = <T>(): Fact<T> => ({ value: null, source: 'library', pointers: [], ...missing });
  const rows: Row[] = (Object.keys(HEADINGS) as RowId[]).map((id) =>
    row(id, [
      id === 'anything-wrong'
        ? say('scope.noOwnEvents', {
            ...missing,
            chips: [chip('not-recorded', 'chip.notRecorded')],
          })
        : say('row.notInRecord', missing),
    ]),
  );
  return {
    kind: 'agentfootprint/answer-account',
    shape: 1,
    templates: { set: 'answer-account', version: ANSWER_ACCOUNT_TEMPLATE_SET_VERSION },
    run: none(),
    question: none(),
    answer: none(),
    facts: {
      routing: {
        configured: none(),
        verdict: none(),
        scores: none(),
        confidence: none(),
        appDecision: none(),
        delivered: none(),
        refusals: [],
      },
      calls: [],
      beforePause: [],
      inView: [],
      evidence: none(),
      standing: none(),
      limitsBlock: none(),
      errors: { failed: 0, refused: 0, declined: 0, notDispatched: 0, withheld: 0 },
      checks: { reachable: [], unreachable: [], notApplicable: [] },
    },
    rows,
    signals: [],
    unreachable: [],
    summary: { sentence: say('scope.noOwnEvents', missing), tone: 'unknown' },
    unread: unread(),
    foreign: view.foreign,
    scope: view.scope,
  };
}

/** @internal — the account with test hooks (`failTemplate`). The public door is `accountForAnswer`. */
export function buildAccount(
  recording: unknown,
  declarations: AnswerAccountDeclarations | undefined,
  options: AccountOptions | undefined,
  internals?: AccountInternals,
): AnswerAccount {
  if (typeof recording !== 'object' || recording === null || Array.isArray(recording)) {
    throw new TypeError(
      'accountForAnswer: the recording must be an object ({ snapshot, events, structure })',
    );
  }
  const decl = validateDeclarations(declarations);
  const view = recordingView(recording as { events?: unknown; snapshot?: unknown }, options);
  let unread = view.unread;
  const say = makeSay(internals, () => {
    unread += 1;
  });
  if (view.events.length === 0) return noOwnEventsAccount(view, say, () => unread);
  const resumedLeg =
    view.ofType('pause.resume').length > 0 ||
    (view.ofType('agent.turn_end').length > 0 && view.ofType('agent.turn_start').length === 0);
  const iteration = answeringIteration(view);
  const ctx: ReadContext = {
    view,
    declarations: decl,
    resumedLeg,
    ...(iteration !== undefined && { answeringIteration: iteration }),
    say,
    noteUnread: () => {
      unread += 1;
    },
    budget: { itemChars: 0, items: 0 },
  };

  const asked = readAsked(ctx);
  const understood = readUnderstood(ctx);
  const calls = readCalls(ctx);
  const inView = readInView(ctx, calls.ids);
  const beforePause = readBeforePause(ctx, calls);
  const checkedRows = readCheckedRows(ctx, calls, beforePause);
  const found = readFoundRow(ctx, calls, inView, beforePause);
  const howSure = readHowSure(ctx, calls);
  const checks = runChecks(ctx, understood, calls, inView);
  const wrong = wrongLines(ctx, checks, calls);
  const { answer, limits } = readAnswer(view);
  const summary = summaryOf(ctx, checks, answer.status === 'recorded');

  const firstSignal = checks.signals[0];
  const wrongChips: Chip[] =
    firstSignal !== undefined
      ? [
          chip('signals', 'chip.signals', firstSignal.tone, {
            n: { value: checks.signals.length, source: 'library' },
          }),
        ]
      : [];
  const rows: Row[] = [
    row('asked', asked.lines),
    row('understood', understood.lines),
    row(
      'checked',
      checkedRows.checked,
      checkedRows.checkedMore ? { more: checkedRows.checkedMore } : {},
    ),
    row(
      'not-checked',
      checkedRows.notChecked,
      checkedRows.notCheckedMore ? { more: checkedRows.notCheckedMore } : {},
    ),
    row('found', found),
    row('how-sure', howSure.lines),
    row('anything-wrong', wrong, { chips: wrongChips }),
  ];
  // Counts are judgements: over EVERY call. Only the listing (`facts.calls`) is capped.
  const all = calls.all.map((c) => c.fact);
  const count = (o: string) => all.filter((c) => c.outcome === o).length;
  return {
    kind: 'agentfootprint/answer-account',
    shape: 1,
    templates: { set: 'answer-account', version: ANSWER_ACCOUNT_TEMPLATE_SET_VERSION },
    run: readRun(view, resumedLeg),
    question:
      asked.question.value !== null && asked.question.value.length > MAX_VAR_CHARS
        ? { ...asked.question, ...clipFact(asked.question.value, MAX_VAR_CHARS) }
        : asked.question,
    answer,
    facts: {
      routing: understood.routing,
      calls: calls.calls.map((c) => c.fact),
      ...(calls.omitted > 0 && { callsOmitted: calls.omitted }),
      beforePause: beforePause.slice(0, MAX_CALLS).map(({ toolName, toolCallId }) => ({
        toolName: toolName.slice(0, FACT_TEXT_CHARS),
        toolCallId: toolCallId.slice(0, FACT_TEXT_CHARS),
      })),
      ...(beforePause.length > MAX_CALLS && { beforePauseOmitted: beforePause.length - MAX_CALLS }),
      inView: inView.all.slice(0, MAX_CALLS).map((r) => r.fact),
      ...(inView.all.length > MAX_CALLS && { inViewOmitted: inView.all.length - MAX_CALLS }),
      evidence: howSure.evidence,
      standing: {
        value: null,
        source: 'library',
        status: 'not-recorded',
        pointers: [],
        missing: 'not-built',
      },
      limitsBlock: limits,
      errors: {
        failed: count('failed'),
        refused: count('refused'),
        declined: count('declined'),
        notDispatched: count('not-dispatched'),
        withheld: all.filter((c) => c.withheldBy !== undefined).length,
      },
      checks: {
        reachable: checks.reachable,
        unreachable: checks.unreachableChecks,
        notApplicable: checks.notApplicable,
      },
    },
    rows,
    signals: checks.signals,
    unreachable: checks.unreachable,
    summary,
    unread,
    foreign: view.foreign,
    scope: view.scope,
  };
}

/**
 * Explain one answer from its recording.
 *
 * @param recording     the answer's recording — `{ snapshot, events, structure }` (`recordRun`).
 * @param declarations  what the APP declares when the report is made (skill labels, `rowsAt`);
 *                      everything filled from it is vouched `app`.
 * @param options       `runId` — the stored artifact's `meta.origin.runId`, when known.
 *
 * @example
 * ```ts
 * import { accountForAnswer } from 'agentfootprint/observe';
 *
 * const account = accountForAnswer(recording, { tools: { lookup_volumes: { rowsAt: 'volumes' } } });
 * account.summary.sentence.text; // "Nothing this report looks for turned up in the record."
 * ```
 */
export function accountForAnswer(
  recording: Recording,
  declarations?: AnswerAccountDeclarations,
  options?: { readonly runId?: string },
): AnswerAccount {
  return buildAccount(recording, declarations, options);
}

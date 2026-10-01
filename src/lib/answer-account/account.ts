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

import { assumedLinesFor } from '../../core/agent/arguments/serve.js';
import { assessAnswer } from '../../core/agent/assessment/assess.js';
import {
  assessmentDataFrom,
  assumedValuesSourceOf,
  rewrittenBehind,
  standingLineOf,
} from '../../core/agent/assessment/compose.js';
import { ASSUMED_BLOCK_HEADING, COVERAGE_BLOCK_HEADING } from '../../core/agent/coverage/answer.js';
import type { Recording } from '../../recorders/observability/recordRun.js';
import { chip, clipFact, MAX_VAR_CHARS, saidBy, sentence } from './render.js';
import { ANSWER_ACCOUNT_TEMPLATE_SET_VERSION, type TemplateId } from './templates.js';
import type {
  AccountSource,
  AnswerAccount,
  AnswerAccountDeclarations,
  Chip,
  AccountFact,
  BeforePauseFact,
  FactStatus,
  LimitsDataFact,
  RecordPointer,
  Row,
  RowId,
  RunFact,
  Sentence,
} from './types.js';
import { validateDeclarations } from './declarations.js';
import { isRecord, num, str, recordingView, type RecordingView, type ViewEvent } from './view.js';
import {
  at,
  countedFields,
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
import { readCheckedRows } from './facts/checked.js';
import { readPausedLeg, type BeforePauseCall } from './facts/pausedLeg.js';
import { beforePausePointers, readFoundRow } from './facts/found.js';
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

/** The separator the framework's one composer puts between the answer and what it appends. */
const APPENDED_SEPARATOR = '\n\n---\n\n';

/**
 * The headings of the two BLOCKS the framework appends after an answer
 * (`coverage/answer.ts` · `composeAnswerWithCoverage`, the one composer), each
 * read from its owner: the limits block's and the "Assumed" block's — long,
 * fixed sentences only the framework writes.
 */
const BLOCK_HEADINGS: readonly string[] = [
  `${COVERAGE_BLOCK_HEADING} — declared by the tools that produced it, not by the model:`,
  ASSUMED_BLOCK_HEADING,
];

/**
 * The standing line THIS run appended, rebuilt from its record — or
 * `undefined` when the record says none could be there.
 *
 * The line opens with the owner's plain words ("Not sure — ", "Known — "),
 * which a model can write too, so an opening proves nothing. The record does:
 * `turn_end.answerAssessment` exists only on a run whose answer layer folded
 * the standing, and the line is ONE function of that projection
 * (`assessment/compose.ts` · `standingLineOf`) — plus, when a value was
 * assumed, of the committed rows it names, read from the source the layer's
 * stage read (`assumedValuesSourceOf`) and the fold's rewrite witness. Only
 * that exact line, where the composer puts it, is the library's. Without the
 * committed state an assumed value cannot be rebuilt, and the line is not
 * claimed.
 */
function appendedStandingLine(
  end: ViewEvent,
  state: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const data = assessmentDataFrom(end.payload.answerAssessment);
  if (data === undefined) return undefined;
  if (!data.reasons.includes('argument-assumed')) return standingLineOf(data, [], false);
  if (state === undefined) return undefined;
  const source = assumedValuesSourceOf(data.reasons, state);
  const assumed =
    source === undefined ? [] : assumedLinesFor(source.ledger, source.turn, source.readDecisions);
  const rewritten = rewrittenBehind(assessAnswer({ snapshot: { sharedState: state } }));
  return standingLineOf(data, assumed, rewritten);
}

/** Whether `text` opens the framework's appended section: the run's own line, or a block's heading. */
function opensAppended(text: string, line: string | undefined): boolean {
  if (line !== undefined && (text === line || text.startsWith(`${line}\n\n`))) return true;
  return BLOCK_HEADINGS.some((heading) => text.startsWith(heading));
}

/**
 * Split the framework's appended section off an answer: the LAST separator
 * whose next line opens it — the run's own standing line, exactly, or a
 * block's heading. A `---` the model wrote itself opens neither, and the
 * composer joins its own blocks with blank lines, never a second separator.
 * An answer with no text of its own is the section alone (the composer adds
 * no separator then).
 */
function splitAppended(
  content: string,
  line: string | undefined,
): { readonly model: string; readonly appended?: string } {
  let at = content.lastIndexOf(APPENDED_SEPARATOR);
  while (at >= 0) {
    const rest = content.slice(at + APPENDED_SEPARATOR.length);
    if (opensAppended(rest, line)) return { model: content.slice(0, at), appended: rest };
    at = at === 0 ? -1 : content.lastIndexOf(APPENDED_SEPARATOR, at - 1);
  }
  return opensAppended(content, line) ? { model: '', appended: content } : { model: content };
}

/** How many items one of the data's lists holds — `0` for a list the record does not carry. */
const listLength = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/**
 * A TYPED answer's limits, read off `turn_end.answerCoverage` — the data
 * `.limitsTravelWithTheAnswer()` files beside an answer that must stay JSON.
 * Counts, with a pointer to every item's `what` (an assumed value's
 * `toolName` — never its `value`, an argument's value, which "show me" never
 * shows), capped at the account's call cap. `undefined` when the event
 * carries none.
 */
function readLimitsData(end: ViewEvent): AccountFact<LimitsDataFact> | undefined {
  const data = end.payload.answerCoverage;
  if (!isRecord(data)) return undefined;
  const pointers: RecordPointer[] = [];
  for (const list of ['checked', 'notChecked', 'cannotCover'] as const) {
    const items = data[list];
    if (!Array.isArray(items)) continue;
    items.forEach((item, i) => {
      if (isRecord(item) && typeof item.what === 'string') {
        pointers.push(at(end, 'answerCoverage', list, i, 'what'));
      }
    });
  }
  const assumed = data.assumed;
  if (Array.isArray(assumed)) {
    assumed.forEach((item, i) => {
      if (isRecord(item) && typeof item.toolName === 'string') {
        pointers.push(at(end, 'answerCoverage', 'assumed', i, 'toolName'));
      }
    });
  }
  if (pointers.length === 0) return undefined;
  return {
    value: {
      checked: listLength(data.checked),
      notChecked: listLength(data.notChecked),
      cannotCover: listLength(data.cannotCover),
      assumed: listLength(assumed),
    },
    source: 'library',
    status: 'recorded',
    pointers: pointers.slice(0, MAX_CALLS),
  };
}

/**
 * The answer, and what the framework carried with it: the appended section of
 * a PROSE answer split off it (the limits block, the "Assumed" block, the
 * standing line — `limitsBlock`), or a TYPED answer's limits as data
 * (`limitsData`). A typed answer's limits never read `not-applicable`: the
 * block reads `not-recorded` with `missing: 'as-data'`, and the data is
 * `recorded`.
 */
function readAnswer(view: RecordingView): {
  answer: AccountFact<string>;
  limits: AccountFact<string>;
  limitsData: AccountFact<LimitsDataFact>;
} {
  const end = view.last('agent.turn_end');
  const content = str(end?.payload.finalContent);
  const none: AccountFact<string> = {
    value: null,
    source: 'library',
    status: 'not-recorded',
    pointers: [],
    missing: 'no-event',
  };
  const noData: AccountFact<LimitsDataFact> = {
    value: null,
    source: 'library',
    status: 'not-applicable',
    pointers: [],
  };
  if (end === undefined || content === undefined) {
    return {
      answer: none,
      limits: { value: null, source: 'library', status: 'not-applicable', pointers: [] },
      limitsData: noData,
    };
  }
  const pointer = at(end, 'finalContent');
  const data = readLimitsData(end);
  const { model, appended } = splitAppended(content, appendedStandingLine(end, view.state));
  const answer: AccountFact<string> = {
    ...clipFact(model, MAX_ANSWER_CHARS),
    source: 'model',
    status: 'recorded',
    pointers: [pointer],
  };
  if (appended !== undefined) {
    return {
      answer,
      limits: {
        ...clipFact(appended, MAX_ANSWER_CHARS),
        source: 'library',
        status: 'recorded',
        pointers: [pointer],
      },
      limitsData: data ?? noData,
    };
  }
  return {
    answer,
    limits:
      data !== undefined
        ? {
            value: null,
            source: 'library',
            status: 'not-recorded',
            pointers: [],
            missing: 'as-data',
          }
        : { value: null, source: 'library', status: 'not-applicable', pointers: [] },
    limitsData: data ?? noData,
  };
}

function readRun(view: RecordingView, resumedLeg: boolean): AccountFact<RunFact> {
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
  const none = <T>(): AccountFact<T> => ({
    value: null,
    source: 'library',
    pointers: [],
    ...missing,
  });
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
      limitsData: none(),
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

/** One call answered before the pause, as the facts list it (read from the committed state). */
function beforePauseFact(c: BeforePauseCall): BeforePauseFact {
  const reading = c.reading;
  const coverage = c.coverage;
  return {
    toolName: c.toolName.slice(0, FACT_TEXT_CHARS),
    toolCallId: c.toolCallId.slice(0, FACT_TEXT_CHARS),
    emptiness: reading.emptiness,
    ...countedFields(reading),
    ...(coverage !== undefined && {
      coverage: {
        kind: coverage.kind,
        ...(coverage.lookedFor !== undefined && {
          lookedFor: coverage.lookedFor.text.slice(0, FACT_TEXT_CHARS),
        }),
        checked: coverage.items.filter((i) => i.section === 'checked').length,
        notChecked: coverage.items.filter((i) => i.section === 'notChecked').length,
        cannotCover: coverage.items.filter((i) => i.section === 'cannotCover').length,
        kinds: coverage.items.filter((i) => i.kind !== undefined).length,
      },
    }),
    pointers: beforePausePointers(c),
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
  const pausedLeg = readPausedLeg(ctx, calls);
  const beforePause = pausedLeg.calls;
  const checkedRows = readCheckedRows(ctx, calls, pausedLeg);
  const found = readFoundRow(ctx, calls, inView, pausedLeg);
  const howSure = readHowSure(ctx, calls);
  const checks = runChecks(ctx, understood, calls, inView, pausedLeg);
  const wrong = wrongLines(ctx, checks, calls, pausedLeg);
  const { answer, limits, limitsData } = readAnswer(view);
  const summary = summaryOf(ctx, checks, answer.status === 'recorded', pausedLeg);

  const firstSignal = checks.signals[0];
  const wrongChips: Chip[] =
    firstSignal !== undefined
      ? [
          chip('signals', 'chip.signals', firstSignal.tone, {
            // Every signal the checks raised, not only the listed ones.
            n: { value: checks.signals.length + checks.omittedSignals, source: 'library' },
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
      beforePause: beforePause.slice(0, MAX_CALLS).map((c) => beforePauseFact(c)),
      ...(beforePause.length > MAX_CALLS && { beforePauseOmitted: beforePause.length - MAX_CALLS }),
      inView: inView.all.slice(0, MAX_CALLS).map((r) => r.fact),
      ...(inView.all.length > MAX_CALLS && { inViewOmitted: inView.all.length - MAX_CALLS }),
      evidence: howSure.evidence,
      standing: howSure.standing,
      limitsBlock: limits,
      limitsData,
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

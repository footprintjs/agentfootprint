/**
 * H4 — a doubt names where it came from. Every reason the fold fires says, as
 * data, what it rests on (`AnswerAssessment` · `reasons[].source`): specific
 * calls, the answer itself, or the run as a whole — the KIND declared once per
 * reason in `REASONS`, the calls read off the rows the reason's witnesses point
 * at. A tool may declare `displayName` (the app's words); the standing line
 * names a reason's calls only by it, and the limits block marks an item's
 * declaring calls the same way.
 *
 * Test types (Convention 3):
 *   - UNIT      — the table declares a kind for every reason (pinned); the
 *                 projection off hand-built records: a call the record names in
 *                 full, a call it does not (counted in `unnamed`, never
 *                 dropped), a conflict's returned readings, and an answer's
 *                 contingent value; the display-name rule and the naming phrase;
 *   - SCENARIO  — real agents on the mock provider: two calls, one absent and
 *                 one clean → the reason lists only the absent call; a run-level
 *                 reason → `run`; an answer-level reason → `answer`; the line
 *                 names a declared call ("Not sure — loading the attached data
 *                 reported no matching results"), names the declared ones and counts the rest,
 *                 and the answer account still finds the line it appended;
 *   - BOUNDARY  — no `displayName` → the delivered text is byte-identical to
 *                 an agent's that never heard of one; a name on a tool no reason
 *                 rests on changes nothing; the limits block's items carry the
 *                 same names, and nothing without them; the rule refuses a
 *                 non-string, a blank, an over-long name and control, separator
 *                 and bidi characters — at `defineTool` and at registration;
 *   - SECURITY  — a source holds kinds, call ids and tool names only: never an
 *                 argument, a result or a value from the answer;
 *   - PROPERTY  — naming never moves the standing: with and without display
 *                 names, every agent configuration folds the same value, word,
 *                 reasons and checks, and the line opens with the same word.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  Agent,
  absent,
  allow,
  coverage,
  defineTool,
  deny,
  type OutputSchemaParser,
  type Tool,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import type { Recording } from '../../../../src/recorders/observability/recordRun.js';
import { REASONS } from '../../../../src/core/agent/assessment/reasons.js';
import {
  MAX_ROW_LIST_ENTRIES,
  reasonSourceOf,
} from '../../../../src/core/agent/assessment/sources.js';
import {
  sourcesByReason,
  standingLineOf,
  STANDING_LINE_OPENINGS,
  type AnswerAssessmentData,
} from '../../../../src/core/agent/assessment/compose.js';
import type { AnswerAssessment } from '../../../../src/core/agent/assessment/types.js';
import {
  displayNameProblem,
  MAX_DISPLAY_NAME_CHARS,
  namedCalls,
  readDisplayName,
} from '../../../../src/lib/displayName.js';

// ─── the harness ─────────────────────────────────────────────────────

type Source = AnswerAssessment['reasons'][number]['source'];

const LOADING = 'loading the attached data';

/** A lookup that finds nothing it was asked for: an `absent()` with what it searched. */
const loadAttachment = (displayName?: string): Tool =>
  defineTool({
    name: 'load_attachment',
    description: 'Load the files attached to this conversation',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } } },
    ...(displayName !== undefined && { displayName }),
    execute: () =>
      absent({ what: 'an attached data file', checked: ['the files attached to this chat'] }),
  });

/** A lookup that returns rows: clean — no reason fires on it. */
const listRuns = (displayName?: string): Tool =>
  defineTool({
    name: 'list_runs',
    description: 'The runs in the workspace',
    inputSchema: { type: 'object', properties: {} },
    ...(displayName !== undefined && { displayName }),
    execute: () => [{ id: 'run-1', state: 'draft' }],
  });

/** A second lookup that also finds nothing — to have two sources behind one reason. */
const searchArchive = (displayName?: string): Tool =>
  defineTool({
    name: 'search_archive',
    description: 'Search the archived runs',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    ...(displayName !== undefined && { displayName }),
    execute: () => absent({ what: 'an archived run', checked: ['the archive'] }),
  });

/** The model calls every tool once, in one batch, then answers. */
const callsThen = (calls: readonly { id: string; name: string }[], answer: string) =>
  mock({
    replies: [
      { toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: {} })) },
      { content: answer },
    ],
  });

interface Run {
  readonly text: string;
  readonly recording: Recording;
  readonly assessed: Record<string, unknown>[];
  readonly turnEnds: Record<string, unknown>[];
  readonly live: AnswerAssessment;
}

async function runOnce(agent: Agent, message = 'which runs used the attached data?') {
  const assessed: Record<string, unknown>[] = [];
  const turnEnds: Record<string, unknown>[] = [];
  agent.on('agentfootprint.answer.assessed', (e) => {
    assessed.push(e.payload as unknown as Record<string, unknown>);
  });
  agent.on('agentfootprint.agent.turn_end', (e) => {
    turnEnds.push(e.payload as unknown as Record<string, unknown>);
  });
  const recorder = recordRun(agent);
  const text = (await agent.run({ message })) as string;
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  const live = (await agent.assessment())!;
  return { text, recording, assessed, turnEnds, live } satisfies Run;
}

const sourceOf = (a: AnswerAssessment, reason: string): Source | undefined =>
  a.reasons.find((r) => r.reason === reason)?.source;

/** A typed answer for the negative-claims arm: a summary and the model's typed negatives. */
const typedReply: OutputSchemaParser<{ summary: string; negatives: unknown[] }> = {
  parse(raw) {
    const value = raw as { summary?: unknown; negatives?: unknown };
    if (typeof value?.summary !== 'string' || !Array.isArray(value.negatives)) {
      throw new Error('summary and negatives are required');
    }
    return { summary: value.summary, negatives: value.negatives };
  },
};
const TYPED_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
          about: { type: ['string', 'number'] },
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'restsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'negatives'],
  additionalProperties: false,
} as const;

const LINE = '\n\n---\n\n';

// ─── UNIT — the table ────────────────────────────────────────────────

describe('UNIT — every reason DECLARES what it rests on', () => {
  it('one kind per reason, from the one table — never decided per run', () => {
    const byKind = (kind: Source['kind']) =>
      REASONS.filter((r) => r.source === kind)
        .map((r) => r.reason)
        .sort();
    expect(REASONS.every((r) => ['calls', 'answer', 'run'].includes(r.source))).toBe(true);
    expect(byKind('run')).toEqual(
      [
        'argument-asked',
        'asked',
        'check-unreachable',
        'invariant-violation',
        'memory-retrieval-timeout',
        'memory-retrieval-excluded',
        'result-dropped-from-window',
        'result-withheld',
        'step-skipped',
        'steps-unfinished',
        'stopped-early',
      ].sort(),
    );
    expect(byKind('answer')).toEqual(
      [
        'answer-check-failed',
        'answer-output-limit',
        'claim-exceeds-search',
        'claim-unsettled',
        'derived-from-reading',
        'negative-prose-unverified',
        'script-unmatched',
        'unsupported-claim',
        'value-survived-revision',
        'value-unsupported',
      ].sort(),
    );
    expect(byKind('calls')).toEqual(
      [
        'argument-assumed',
        'argument-read',
        'argument-unverified',
        'call-not-completed',
        'column-type-mismatch',
        'coverage-gap',
        'declaration-overclaimed',
        'declared-absent',
        'empty-undeclared',
        'missing-column',
        'period-beyond-retention',
        'period-differs-from-asked',
        'period-not-held',
        'period-partly-held',
        'period-undeclared',
        'period-unknown',
        'sources-conflict',
        'unsupported-argument',
        'value-contingent',
        'result-cut',
        'placed-unread',
        'times-without-zone',
        'work-not-finished',
      ].sort(),
    );
  });
});

// ─── UNIT — the projection off hand-built records ────────────────────

const user = (content: string) => ({ role: 'user', content });
const toolMsg = (
  toolCallId: string | undefined,
  toolName: string | undefined,
  content: unknown,
) => ({
  role: 'tool',
  content: typeof content === 'string' ? content : JSON.stringify(content),
  ...(toolCallId !== undefined && { toolCallId }),
  ...(toolName !== undefined && { toolName }),
});
const fold = (state: Record<string, unknown>) => assessAnswer({ snapshot: { sharedState: state } });

const overclaimCheck = (tools: readonly unknown[], toolCallId?: string) => ({
  id: 'agent:negative-claims:declaration:0',
  disposition: 'not-applicable',
  reason: 'declaration-overclaimed',
  tools,
  ...(toolCallId !== undefined && { toolCallId, iteration: 1 }),
});

describe('UNIT — the calls are read off the rows the witnesses point at', () => {
  it('a result names its own call; a clean result is never listed', () => {
    const a = fold({
      history: [
        user('q'),
        toolMsg('c1', 'load_attachment', []),
        toolMsg('c2', 'list_runs', [{ id: 1 }]),
      ],
    });
    expect(sourceOf(a, 'empty-undeclared')).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c1', toolName: 'load_attachment' }],
    });
  });

  it('one call that filed two rows is ONE call; rows of the same call are said once', () => {
    const row = (kind: 'absence' | 'ledger') => ({
      kind,
      toolName: 'load_attachment',
      toolCallId: 'c1',
      iteration: 1,
      checked: [{ what: 'inventory' }],
      notChecked: [{ what: 'powered-off VMs' }],
      cannotCover: [],
    });
    const a = fold({
      history: [user('q'), toolMsg('c1', 'load_attachment', {})],
      coverageDeclared: [row('ledger'), row('absence')],
    });
    expect(sourceOf(a, 'coverage-gap')).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c1', toolName: 'load_attachment' }],
    });
  });

  it('a call the record does not name in full is COUNTED, never dropped and never guessed', () => {
    const a = fold({
      // A result with an id and no tool name; a result with no id at all.
      history: [user('q'), toolMsg('c1', undefined, []), toolMsg(undefined, 'load_attachment', [])],
    });
    expect(sourceOf(a, 'empty-undeclared')).toEqual({ kind: 'calls', calls: [], unnamed: 2 });
  });

  it('a conflict names the readings that disagree; their tools are read from history', () => {
    const a = fold({
      history: [
        user('q'),
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'inventory', args: {} }] },
        toolMsg('c1', 'inventory', [{ host: 'h1' }]),
        toolMsg('c2', 'cmdb', [{ host: 'h1' }]),
      ],
      findingsLedger: [
        {
          kind: 'conflict',
          key: 'host:h1|state',
          iteration: 1,
          witnesses: [
            { toolCallId: 'c1', subject: { kind: 'host', id: 'h1' }, predicate: 'state' },
            { toolCallId: 'c2', subject: { kind: 'host', id: 'h1' }, predicate: 'state' },
          ],
        },
      ],
    });
    expect(sourceOf(a, 'sources-conflict')).toEqual({
      kind: 'calls',
      calls: [
        { toolCallId: 'c1', toolName: 'inventory' },
        { toolCallId: 'c2', toolName: 'cmdb' },
      ],
    });
  });

  it('an overclaim needs the exact returned tool occurrence', () => {
    const history = [
      user('q'),
      toolMsg('c1', 'inventory', [{ id: 1 }]),
      toolMsg('c2', 'inventory', [{ id: 2 }]),
    ];
    const reportFor = (toolCallId?: string) => ({
      mode: 'observe',
      status: 'passed',
      checks: [overclaimCheck(['inventory'], toolCallId)],
    });
    const assessment = (
      toolCallId?: string,
      record: ReadonlyArray<Record<string, unknown>> = history,
    ) => fold({ history: record, answerValidation: reportFor(toolCallId) });

    expect(sourceOf(assessment('c2'), 'declaration-overclaimed')).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c2', toolName: 'inventory' }],
    });
    expect(sourceOf(assessment(), 'declaration-overclaimed')).toBeUndefined();
    expect(sourceOf(assessment('missing'), 'declaration-overclaimed')).toBeUndefined();
    for (const execution of ['threw', 'not-entered', 'returned-unserved']) {
      const failed = [...history.slice(0, 2), { ...history[2]!, toolResultExecution: execution }];
      expect(sourceOf(assessment('c2', failed), 'declaration-overclaimed')).toBeUndefined();
    }
  });

  it('an answer-level and a run-level reason carry their kind and nothing else', () => {
    const a = fold({
      unsupportedValues: { candidates: [{ value: '4821' }], revised: false },
      stoppedEarly: { reason: 'max-iterations', iteration: 3, pendingToolCalls: 1 },
    });
    expect(sourceOf(a, 'value-unsupported')).toEqual({ kind: 'answer' });
    expect(sourceOf(a, 'stopped-early')).toEqual({ kind: 'run' });
  });
});

describe('UNIT — witness lists and the source they support', () => {
  const history = [
    user('q'),
    toolMsg('c1', 'inventory', [{ id: 'x' }]),
    toolMsg('c2', 'inventory', [{ id: 'x' }]),
  ];
  const reading = (toolCallId?: string) => ({
    ...(toolCallId !== undefined && { toolCallId }),
    subject: { kind: 'host', id: 'x' },
    predicate: 'state',
  });
  const conflict = (witnesses: readonly unknown[]) => ({
    kind: 'conflict',
    key: 'host:x|state',
    iteration: 1,
    witnesses,
  });
  const carrier = (toolCallId?: string) => ({
    ...(toolCallId !== undefined && { toolCallId }),
    standing: 'noise',
  });
  const contingent = (carriers: readonly unknown[]) => ({
    kind: 'contingent',
    declaredOn: 'answer',
    value: 'x',
    iteration: 2,
    carriers,
  });
  const displayNames = new Map([['inventory', 'checking inventory']]);
  const lineOf = (a: AnswerAssessment) =>
    standingLineOf(
      {
        assessment: a.assessment,
        standing: a.standing,
        reasons: a.reasons.map((r) => r.reason),
        checked: [],
      },
      [],
      false,
      { sources: sourcesByReason(a), displayNames },
    );
  const projectConflict = (row: ReturnType<typeof conflict>) =>
    reasonSourceOf(
      'sources-conflict',
      'calls',
      [{ kind: 'state', key: 'findingsLedger', path: '/0/kind' }],
      { state: { history, findingsLedger: [row] }, turnResults: [] },
    );

  it('a conflict of returned readings names each distinct occurrence once', () => {
    const a = fold({
      history,
      findingsLedger: [conflict([reading('c1'), reading('c2'), reading('c1')])],
    });
    expect(sourceOf(a, 'sources-conflict')).toEqual({
      kind: 'calls',
      calls: [
        { toolCallId: 'c1', toolName: 'inventory' },
        { toolCallId: 'c2', toolName: 'inventory' },
      ],
    });
  });

  it('a partially named conflict retains its source counts without contributing to standing', () => {
    const row = conflict([reading('c1'), reading('c1'), reading(), reading()]);
    expect(sourceOf(fold({ history, findingsLedger: [row] }), 'sources-conflict')).toBeUndefined();
    expect(projectConflict(row)).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c1', toolName: 'inventory' }],
      unnamed: 2,
    });
  });

  it('all unnamed readings are insufficient with or without a turn stamp', () => {
    const row = conflict([reading(), reading()]);
    const a = fold({ history, findingsLedger: [row] });
    const stamped = fold({ history, turnNumber: 1, findingsLedger: [{ ...row, turn: 1 }] });
    expect(sourceOf(a, 'sources-conflict')).toBeUndefined();
    expect(sourceOf(stamped, 'sources-conflict')).toBeUndefined();

    const source = projectConflict(row);
    expect(source).toEqual({ kind: 'calls', calls: [], unnamed: 2 });
    expect(
      standingLineOf(
        { assessment: 'unknown', standing: 'not-sure', reasons: ['sources-conflict'], checked: [] },
        [],
        false,
        { sources: new Map([['sources-conflict', source]]), displayNames },
      ),
    ).toBe('Not sure — two results the answer stood on disagree.');
  });

  const HOLE = Symbol('hole');
  const sparse = (...entries: readonly unknown[]): unknown[] => {
    const list: unknown[] = new Array(entries.length);
    entries.forEach((entry, i) => {
      if (entry !== HOLE) list[i] = entry;
    });
    return list;
  };

  it.each([
    { case: 'named and unnamed', carriers: [carrier('c1'), carrier()] },
    { case: 'empty', carriers: [] },
    { case: 'sparse', carriers: sparse(carrier('c1'), HOLE) },
    { case: 'all unnamed', carriers: [carrier(), carrier()] },
  ])('an answer’s contingent value speaks for the answer with $case carriers', ({ carriers }) => {
    const a = fold({ history, findingsLedger: [contingent(carriers)] });
    expect(sourceOf(a, 'value-contingent')).toEqual({ kind: 'answer' });
    expect(lineOf(a)).toBe(
      'Not sure — a value in the answer came from a result the model had set aside.',
    );
  });

  it('a sparse conflict witness list cannot supply the missing reading', () => {
    const witnesses = sparse(reading('c1'), HOLE, reading('c2'));
    expect(1 in witnesses).toBe(false);
    const row = conflict(witnesses);
    expect(sourceOf(fold({ history, findingsLedger: [row] }), 'sources-conflict')).toBeUndefined();
    expect(projectConflict(row)).toEqual({
      kind: 'calls',
      calls: [
        { toolCallId: 'c1', toolName: 'inventory' },
        { toolCallId: 'c2', toolName: 'inventory' },
      ],
      unnamed: 1,
    });
  });

  it('a sparse tools list on a report check adds no occurrence', () => {
    const tools = sparse('inventory', HOLE);
    const assess = (toolCallId?: string) =>
      fold({
        history,
        answerValidation: {
          mode: 'observe',
          status: 'passed',
          checks: [overclaimCheck(tools, toolCallId)],
        },
      });
    expect(sourceOf(assess(), 'declaration-overclaimed')).toBeUndefined();
    expect(sourceOf(assess('c1'), 'declaration-overclaimed')).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c1', toolName: 'inventory' }],
    });
  });

  const iterating = (list: unknown[], iterate: () => Generator<unknown>): unknown[] =>
    Object.defineProperty(list, Symbol.iterator, { value: iterate });
  const fromNowhere = function* (): Generator<unknown> {};

  it('reads witness indices without executing an own iterator', () => {
    const iterator = vi.fn(fromNowhere);
    const witnesses = iterating([reading('c1'), reading('c2')], iterator);
    const a = fold({
      history,
      turnNumber: 1,
      findingsLedger: [{ ...conflict(witnesses), turn: 1 }],
    });
    expect(sourceOf(a, 'sources-conflict')).toEqual({
      kind: 'calls',
      calls: [
        { toolCallId: 'c1', toolName: 'inventory' },
        { toolCallId: 'c2', toolName: 'inventory' },
      ],
    });
    expect(iterator).not.toHaveBeenCalled();
  });

  it('never executes the own iterator of the report check’s tools', () => {
    const iterator = vi.fn(function* () {
      yield 'unrelated';
    });
    const check = overclaimCheck(iterating(['inventory'], iterator), 'c1');
    const a = fold({
      history,
      answerValidation: { mode: 'observe', status: 'passed', checks: [check] },
    });
    expect(sourceOf(a, 'declaration-overclaimed')).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c1', toolName: 'inventory' }],
    });
    expect(iterator).not.toHaveBeenCalled();
  });

  it('never executes a getter at a witness index', () => {
    const getter = vi.fn(() => reading('c2'));
    const witnesses: unknown[] = [reading('c1')];
    Object.defineProperty(witnesses, 1, { enumerable: true, get: getter });
    const row = conflict(witnesses);
    expect(sourceOf(fold({ history, findingsLedger: [row] }), 'sources-conflict')).toBeUndefined();
    expect(projectConflict(row)).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c1', toolName: 'inventory' }],
      unnamed: 1,
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it('reads history and report checks without calling their own list methods', () => {
    const iterator = vi.fn(fromNowhere);
    const quiet = iterating([...history], iterator);
    const a = fold({ history: quiet, findingsLedger: [conflict([reading('c1'), reading('c2')])] });
    expect(sourceOf(a, 'sources-conflict')).toEqual({
      kind: 'calls',
      calls: [
        { toolCallId: 'c1', toolName: 'inventory' },
        { toolCallId: 'c2', toolName: 'inventory' },
      ],
    });
    expect(iterator).not.toHaveBeenCalled();

    const entries = vi.fn(() => [][Symbol.iterator]());
    const checkGetter = vi.fn(() => overclaimCheck(['inventory'], 'c2'));
    const checks = [overclaimCheck(['inventory'], 'c1')];
    Object.defineProperties(checks, {
      entries: { value: entries },
      1: { get: checkGetter },
    });
    const b = fold({ history, answerValidation: { mode: 'observe', status: 'passed', checks } });
    expect(sourceOf(b, 'declaration-overclaimed')).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c1', toolName: 'inventory' }],
    });
    expect(entries).not.toHaveBeenCalled();
    expect(checkGetter).not.toHaveBeenCalled();
  });

  it('a nonplain witness list cannot support a conflict', () => {
    const witnesses = Object.setPrototypeOf([reading('c1'), reading('c2')], null) as unknown[];
    expect(Array.isArray(witnesses)).toBe(true);
    const row = conflict(witnesses);
    expect(sourceOf(fold({ history, findingsLedger: [row] }), 'sources-conflict')).toBeUndefined();
    expect(projectConflict(row)).toEqual({ kind: 'calls', calls: [], unnamed: 1 });
  });

  it('counts witness entries past the bound without walking them', () => {
    const witnesses: unknown[] = [];
    const getter = vi.fn(() => reading('c2'));
    Object.defineProperty(witnesses, MAX_ROW_LIST_ENTRIES + 1, { get: getter });
    const row = conflict(witnesses);
    expect(sourceOf(fold({ history, findingsLedger: [row] }), 'sources-conflict')).toBeUndefined();
    expect(projectConflict(row)).toEqual({
      kind: 'calls',
      calls: [],
      unnamed: MAX_ROW_LIST_ENTRIES + 2,
    });
    expect(getter).not.toHaveBeenCalled();

    const huge: unknown[] = [];
    huge.length = 2 ** 32 - 1;
    expect(projectConflict(conflict(huge))).toEqual({
      kind: 'calls',
      calls: [],
      unnamed: 2 ** 32 - 1,
    });
  });
});

describe('UNIT — the rule and the naming', () => {
  it('a display name is one plain line of at most 60 characters, judged trimmed', () => {
    expect(displayNameProblem('displayName', LOADING)).toBeUndefined();
    expect(readDisplayName(`  ${LOADING}  `)).toBe(LOADING);
    for (const bad of [
      undefined,
      42,
      '',
      '   ',
      'x'.repeat(MAX_DISPLAY_NAME_CHARS + 1),
      'loading\u0007the data', // a control
      'loading\u{2028}the data', // a line separator
      'loading \u{202E}atad eht', // a bidi override: reverses what a person reads
      'loading\u{200B}the data', // a zero-width character
    ]) {
      expect(displayNameProblem('displayName', bad), JSON.stringify(bad)).toBeDefined();
      expect(readDisplayName(bad)).toBeUndefined();
    }
  });

  it('names the declared calls, counts the rest, never prints a registered name', () => {
    const names = (tool: string) =>
      ({ load_attachment: LOADING, search_archive: 'searching the archive' }[tool]);
    const call = (toolName: string) => ({ toolName });
    expect(namedCalls([call('load_attachment')], 0, names)).toBe(LOADING);
    expect(namedCalls([call('load_attachment'), call('load_attachment')], 0, names)).toBe(LOADING);
    expect(namedCalls([call('load_attachment'), call('search_archive')], 0, names)).toBe(
      `${LOADING} and searching the archive`,
    );
    expect(namedCalls([call('load_attachment'), call('list_runs')], 0, names)).toBe(
      `${LOADING} and 1 other call`,
    );
    expect(namedCalls([call('load_attachment')], 2, names)).toBe(`${LOADING} and 2 other calls`);
    // Nothing declared: nothing to say — the caller keeps its own words.
    expect(namedCalls([call('list_runs')], 1, names)).toBeUndefined();
  });

  it('the line: no names → today’s words; names → the named clause', () => {
    const data: AnswerAssessmentData = {
      assessment: 'unknown',
      standing: 'not-sure',
      reasons: ['declared-absent'],
      checked: [],
    };
    const sources = new Map([
      [
        'declared-absent' as const,
        { kind: 'calls' as const, calls: [{ toolCallId: 'c1', toolName: 'load_attachment' }] },
      ],
    ]);
    expect(standingLineOf(data, [], false)).toBe('Not sure — a tool said nothing matched.');
    expect(standingLineOf(data, [], false, { sources, displayNames: new Map() })).toBe(
      'Not sure — a tool said nothing matched.',
    );
    expect(
      standingLineOf(data, [], false, {
        sources,
        displayNames: new Map([['load_attachment', LOADING]]),
      }),
    ).toBe(`Not sure — ${LOADING} reported no matching results.`);
  });
});

// ─── SCENARIO ────────────────────────────────────────────────────────

describe('SCENARIO — a reason names where it came from, from a real run', () => {
  it('two calls, one absent and one clean → the reason lists only the absent call', async () => {
    const agent = Agent.create({
      provider: callsThen(
        [
          { id: 'c1', name: 'load_attachment' },
          { id: 'c2', name: 'list_runs' },
        ],
        'One draft run: run-1.',
      ),
      model: 'mock',
    })
      .tool(loadAttachment())
      .tool(listRuns())
      .answerLayer()
      .build();
    const r = await runOnce(agent);
    for (const a of [r.live, assessAnswer(r.recording)]) {
      expect(a.standing).toBe('not-sure');
      expect(a.reasons.map((x) => x.reason)).toEqual(['declared-absent']);
      expect(sourceOf(a, 'declared-absent')).toEqual({
        kind: 'calls',
        calls: [{ toolCallId: 'c1', toolName: 'load_attachment' }],
      });
    }
  });

  it('a run-level reason → kind run (a limit cut the turn short)', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'list_runs', args: {} }] },
          { toolCalls: [{ id: 'c2', name: 'list_runs', args: {} }] },
          { content: 'I listed them twice and ran out of steps.' },
        ] as never,
      }),
      model: 'mock',
      maxIterations: 2,
    })
      .tool(listRuns())
      .answerLayer()
      .build();
    const r = await runOnce(agent);
    expect(sourceOf(r.live, 'stopped-early')).toEqual({ kind: 'run' });
    expect(sourceOf(assessAnswer(r.recording), 'stopped-early')).toEqual({ kind: 'run' });
  });

  it('an answer-level reason → kind answer (a value no result carried)', async () => {
    const agent = Agent.create({
      provider: callsThen([{ id: 'c1', name: 'list_runs' }], 'There are 4821 runs.'),
      model: 'mock',
    })
      .tool(listRuns())
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer()
      .build();
    const r = await runOnce(agent);
    expect(r.live.reasons.map((x) => x.reason)).toEqual(['value-unsupported']);
    expect(sourceOf(r.live, 'value-unsupported')).toEqual({ kind: 'answer' });
    expect(sourceOf(assessAnswer(r.recording), 'value-unsupported')).toEqual({ kind: 'answer' });
  });

  it.each(['throw', 'native return', 'framework refusal', 'withheld native return'] as const)(
    'an absence assertion on a %s uses only delivered native evidence for standing',
    async (kind) => {
      const native = kind === 'native return' || kind === 'withheld native return';
      const message = 'Service payments does not exist.';
      const execute = vi.fn(({ service }: Record<string, unknown>) => {
        if (service === 'billing') return [{ incident: 'incident-1' }];
        if (kind === 'throw') throw new Error(message);
        return { content: message, effects: [], status: 'denied' as const };
      });
      const incidents = defineTool({
        name: 'read_incidents',
        description: 'Read open incidents for a service',
        inputSchema: {
          type: 'object',
          properties: { service: { type: 'string' } },
          required: ['service'],
        },
        effects: 'read',
        search: {
          source: { what: 'the incident store', said: ['the incident store'] },
          subject: { what: 'incidents', said: ['incident', 'incidents'] },
          arguments: [{ name: 'service', role: 'population' }],
          complete: 'within-arguments',
        },
        execute,
      });
      const builder = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'c1', name: 'read_incidents', args: { service: 'billing' } }] },
            { toolCalls: [{ id: 'c2', name: 'read_incidents', args: { service: 'payments' } }] },
            {
              content: JSON.stringify({ summary: 'The payments read was refused.', negatives: [] }),
            },
          ] as never,
        }),
        model: 'mock',
      })
        .tool(incidents)
        .outputSchema(typedReply, { jsonSchema: TYPED_REPLY_SCHEMA })
        .negativeClaims({ field: 'negatives', tools: ['read_incidents'] });
      if (kind === 'framework refusal') {
        builder.toolMiddleware({
          name: 'refuse-payments',
          onToolCall: (call) => (call.args.service === 'payments' ? deny(message) : allow()),
        });
      }
      if (kind === 'withheld native return') {
        builder.toolMiddleware({
          name: 'keep-payments-out',
          onToolResult: (call) =>
            call.args.service === 'payments' ? deny('Payment incidents are internal.') : allow(),
        });
      }
      const agent = builder.build();
      const r = await runOnce(agent, 'Any open incidents for billing and payments?');
      expect(execute).toHaveBeenCalledTimes(kind === 'framework refusal' ? 1 : 2);
      for (const a of [r.live, assessAnswer(r.recording)]) {
        expect(a.standing).toBe('not-sure');
        if (kind === 'withheld native return') {
          expect(sourceOf(a, 'result-withheld')).toEqual({ kind: 'run' });
        } else {
          expect(sourceOf(a, 'call-not-completed')).toEqual({
            kind: 'calls',
            calls: [
              {
                toolCallId: 'c2',
                toolName: 'read_incidents',
                outcome: kind === 'throw' ? 'failed' : 'refused',
                ...(kind === 'throw' ? { category: 'unknown' } : {}),
              },
            ],
          });
        }
        expect(sourceOf(a, 'declaration-overclaimed')).toEqual(
          kind === 'native return'
            ? { kind: 'calls', calls: [{ toolCallId: 'c2', toolName: 'read_incidents' }] }
            : undefined,
        );
      }

      if (kind !== 'framework refusal') {
        const rows = agent.answerValidation()?.checks.filter((c) => c.id.includes(':declaration:'));
        const snapshot = r.recording.snapshot as {
          sharedState: { history: Record<string, unknown>[] };
        };
        const landedKey = snapshot.sharedState.history.find(
          (row) => row.role === 'tool' && row.toolCallId === 'c2',
        )?.callOccurrenceKey;
        expect(landedKey).toEqual(Array(5).fill(expect.any(Number)));
        expect(rows).toEqual([
          {
            id: 'agent:negative-claims:declaration:0',
            path: '/',
            disposition: 'not-applicable',
            reason: 'declaration-overclaimed',
            tools: ['read_incidents'],
            ...(native && {
              toolCallId: 'c2',
              iteration: 2,
              callOccurrenceKey: landedKey,
            }),
          },
        ]);
      }
    },
  );
});

describe('SCENARIO — the line names a reason’s calls only in the app’s words', () => {
  const lineAgent = (tools: readonly Tool[], calls: readonly { id: string; name: string }[]) => {
    let b = Agent.create({
      provider: callsThen(calls, 'One draft run: run-1.'),
      model: 'mock',
    });
    for (const t of tools) b = b.tool(t);
    return b.answerLayer({ standingLine: true }).build();
  };
  const both = [
    { id: 'c1', name: 'load_attachment' },
    { id: 'c2', name: 'list_runs' },
  ];

  it('displayName appears in the line: "Not sure — loading the attached data reported no matching results."', async () => {
    const r = await runOnce(lineAgent([loadAttachment(LOADING), listRuns()], both));
    expect(r.text).toBe(
      `One draft run: run-1.${LINE}Not sure — ${LOADING} reported no matching results.`,
    );
    // The registered name is never printed.
    expect(r.text).not.toContain('load_attachment');
    // The record keeps the words the line used, so a reader rebuilds the very line.
    expect(r.turnEnds.at(-1)!.standingLineNames).toEqual({ load_attachment: LOADING });
  });

  it('no displayName → the delivered text is byte-identical to today’s', async () => {
    const plain = await runOnce(lineAgent([loadAttachment(), listRuns()], both));
    expect(plain.text).toBe(`One draft run: run-1.${LINE}Not sure — a tool said nothing matched.`);
    expect(plain.turnEnds.at(-1)!).not.toHaveProperty('standingLineNames');
    // A name on a tool NO reason rests on changes nothing either.
    const cleanNamed = await runOnce(
      lineAgent([loadAttachment(), listRuns('listing the runs')], both),
    );
    expect(cleanNamed.text).toBe(plain.text);
    expect(cleanNamed.turnEnds.at(-1)!).not.toHaveProperty('standingLineNames');
  });

  it('several sources: the declared ones named, the rest counted', async () => {
    const calls = [
      { id: 'c1', name: 'load_attachment' },
      { id: 'c2', name: 'search_archive' },
    ];
    const oneNamed = await runOnce(lineAgent([loadAttachment(LOADING), searchArchive()], calls));
    expect(oneNamed.text.split(LINE)[1]).toBe(
      `Not sure — ${LOADING} and 1 other call reported no matching results.`,
    );
    const twoNamed = await runOnce(
      lineAgent([loadAttachment(LOADING), searchArchive('searching the archive')], calls),
    );
    expect(twoNamed.text.split(LINE)[1]).toBe(
      `Not sure — ${LOADING} and searching the archive reported no matching results.`,
    );
  });

  it('an assumed value names the tool whose rule assumed it in the app’s words — and the account finds that line too', async () => {
    const searchLogs = (displayName?: string) =>
      defineTool({
        name: 'search_logs',
        description: 'Error lines for one service over a look-back period.',
        inputSchema: {
          type: 'object',
          required: ['service', 'window'],
          properties: {
            service: { type: 'string' },
            window: { type: 'string', enum: ['1h', '2h', '24h'] },
          },
        },
        askOrAssume: { window: { assume: '2h' } },
        ...(displayName !== undefined && { displayName }),
        execute: async () => ({ errors: 0 }),
      });
    const agent = (displayName?: string) =>
      Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'c1', name: 'search_logs', args: { service: 'api' } }] },
            { content: 'No errors on api.' },
          ] as never,
        }),
        model: 'mock',
      })
        .tool(searchLogs(displayName))
        .answerLayer({ standingLine: true })
        .build();
    const plain = await runOnce(agent(), 'errors on api?');
    expect(plain.text.split(LINE)[1]).toBe(
      'Not sure — window = "2h" was assumed by search_logs\'s rule, not given by you.',
    );
    const named = await runOnce(agent('searching the logs'), 'errors on api?');
    expect(named.text.split(LINE)[1]).toBe(
      'Not sure — window = "2h" was assumed by the rule of searching the logs, not given by you.',
    );
    expect(named.text).not.toContain('search_logs');
    const account = accountForAnswer(named.recording);
    expect(`${account.answer.value}${LINE}${account.facts.limitsBlock.value}`).toBe(named.text);
  });

  it('the answer account still finds the line it appended, from the record alone', async () => {
    const r = await runOnce(lineAgent([loadAttachment(LOADING), listRuns()], both));
    const account = accountForAnswer(r.recording);
    expect(account.answer.value).toBe('One draft run: run-1.');
    expect(account.facts.limitsBlock.value).toBe(
      `Not sure — ${LOADING} reported no matching results.`,
    );
    // The account's "How sure" counts the calls behind each reason off the same source.
    const howSure = account.rows.find((row) => row.id === 'how-sure')!;
    expect(howSure.lines.map((l) => l.text)).toContain('1 call declared that nothing matched.');
  });
});

describe('BOUNDARY — the limits block marks an item’s calls the same way', () => {
  const limitsAgent = (named: boolean) =>
    Agent.create({
      provider: callsThen(
        [
          { id: 'c1', name: 'load_attachment' },
          { id: 'c2', name: 'list_hosts' },
        ],
        'No data file is attached.',
      ),
      model: 'mock',
    })
      .tool(loadAttachment(named ? LOADING : undefined))
      .tool(
        defineTool({
          name: 'list_hosts',
          description: 'The hosts in the estate',
          inputSchema: { type: 'object', properties: {} },
          execute: () => coverage([{ host: 'h1' }], { checked: ['the hosts in the estate'] }),
        }),
      )
      .limitsTravelWithTheAnswer()
      .build();

  it('a named call’s items carry its words; an unnamed call’s items stay as they were', async () => {
    const plain = (await limitsAgent(false).run({ message: 'which files?' })) as string;
    const named = (await limitsAgent(true).run({ message: 'which files?' })) as string;
    const plainWarning = 'Not sure — a tool said nothing matched.';
    const namedWarning = 'Not sure — loading the attached data reported no matching results.';
    expect(plain).toBe(
      [
        'No data file is attached.',
        '',
        '---',
        '',
        plainWarning,
        '',
        'Coverage of this answer — declared by the tools that produced it, not by the model:',
        '',
        'Checked:',
        '- the files attached to this chat',
        '- the hosts in the estate',
      ].join('\n'),
    );
    expect(named).toBe(
      plain
        .replace(plainWarning, namedWarning)
        .replace(
          '- the files attached to this chat',
          `- the files attached to this chat (${LOADING})`,
        ),
    );
  });
});

describe('BOUNDARY — the rule holds at both doors', () => {
  it('defineTool refuses a name a person should not read, naming the tool', () => {
    for (const bad of ['', '  ', 'x'.repeat(61), 'a\u{202E}b', 'a\nb', 7 as unknown as string]) {
      expect(() => loadAttachment(bad), JSON.stringify(bad)).toThrow(
        /defineTool\('load_attachment'\): `displayName`/,
      );
    }
    expect(loadAttachment(`  ${LOADING} `).displayName).toBe(LOADING);
  });

  it('registration refuses a hand-built tool carrying one', () => {
    const handBuilt: Tool = { ...loadAttachment(), displayName: 'loading\u0000the data' };
    expect(() =>
      Agent.create({ provider: mock({ replies: [{ content: 'x' }] }), model: 'mock' })
        .tool(handBuilt)
        .build(),
    ).toThrow(/`displayName`/);
  });
});

// ─── SECURITY ────────────────────────────────────────────────────────

describe('SECURITY — a source holds kinds, call ids and tool names only', () => {
  it('no argument, no result, no value from the answer', async () => {
    const secret = 'SECRET-host-7731';
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'load_attachment', args: { file: secret } }] },
          { content: `Nothing about ${secret}; 9917 rows.` },
        ],
      }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'load_attachment',
          description: 'Load an attached file',
          inputSchema: { type: 'object', properties: { file: { type: 'string' } } },
          displayName: LOADING,
          execute: () =>
            absent({ what: `the file ${secret}`, checked: [`attachments named ${secret}`] }),
        }),
      )
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer({ standingLine: true })
      .build();
    const r = await runOnce(agent, `load ${secret}`);
    const sources = [r.live, assessAnswer(r.recording)].flatMap((a) =>
      a.reasons.map((x) => x.source),
    );
    expect(sources.length).toBeGreaterThan(0);
    const text = JSON.stringify(sources);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('9917');
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object' && v !== null) {
        for (const [k, inner] of Object.entries(v)) {
          keys.add(k);
          walk(inner);
        }
      }
    };
    walk(sources);
    expect([...keys].sort()).toEqual(['calls', 'kind', 'toolCallId', 'toolName']);
    // The words the record keeps for the line are the app's, keyed by tool name.
    expect(JSON.stringify(r.turnEnds.at(-1)!.standingLineNames)).not.toContain(secret);
  });
});

// ─── PROPERTY — naming never moves the standing ──────────────────────

describe('PROPERTY — the standing is unchanged by naming', () => {
  // Every combination of the tools that answer, the gate, and the line; each run
  // with and without display names — the value, the word, the reason kinds, the
  // checks and the line's opening must not move.
  const answers = ['One draft run: run-1.', 'There are 4821 runs.'];
  const sets: readonly (readonly ('load_attachment' | 'list_runs' | 'search_archive')[])[] = [
    ['load_attachment'],
    ['list_runs'],
    ['load_attachment', 'list_runs'],
    ['load_attachment', 'search_archive'],
    ['load_attachment', 'list_runs', 'search_archive'],
  ];
  const make = {
    load_attachment: loadAttachment,
    list_runs: listRuns,
    search_archive: searchArchive,
  };
  const words = {
    load_attachment: LOADING,
    list_runs: 'listing the runs',
    search_archive: 'searching the archive',
  };
  const cases = sets.flatMap((tools) =>
    answers.flatMap((answer) => [true, false].map((gate) => ({ tools, answer, gate }))),
  );

  it.each(cases.map((c, i) => [i, c] as const))('case %i', async (_, c) => {
    const build = (named: boolean) => {
      let b = Agent.create({
        provider: callsThen(
          c.tools.map((name, i) => ({ id: `c${i + 1}`, name })),
          c.answer,
        ),
        model: 'mock',
      });
      for (const t of c.tools) b = b.tool(make[t](named ? words[t] : undefined));
      if (c.gate) b = b.namesAndNumbersFromEvidence({ posture: 'assist' });
      return b.answerLayer({ standingLine: true }).build();
    };
    const plain = await runOnce(build(false));
    const named = await runOnce(build(true));
    const view = (a: AnswerAssessment) => ({
      assessment: a.assessment,
      standing: a.standing,
      reasons: a.reasons.map((x) => ({ reason: x.reason, source: x.source })),
      checked: a.checked,
    });
    expect(view(named.live)).toEqual(view(plain.live));
    expect(named.assessed).toEqual(plain.assessed);
    expect(named.turnEnds.at(-1)!.answerAssessment).toEqual(
      plain.turnEnds.at(-1)!.answerAssessment,
    );
    const opening = STANDING_LINE_OPENINGS[plain.live.standing];
    expect(plain.text.split(LINE)[1]!.startsWith(opening)).toBe(true);
    expect(named.text.split(LINE)[1]!.startsWith(opening)).toBe(true);
    // The model's words are untouched either way.
    expect(named.text.split(LINE)[0]).toBe(plain.text.split(LINE)[0]);
  });
});

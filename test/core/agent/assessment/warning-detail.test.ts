import { AttemptTimeoutError } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import { absent, Agent, coverage, defineTool, type AgentOptions } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer, recordRun } from '../../../../src/observe.js';
import {
  recordedStandingLinesOf,
  standingLineOf,
} from '../../../../src/core/agent/assessment/compose.js';
import type { StandingNames } from '../../../../src/core/agent/assessment/standingFacts.js';

const ANSWER = 'I reviewed the request.';

async function runWithWarning(
  execute: () => unknown,
  options: { displayName?: string; redact?: AgentOptions['redact']; results?: true } = {},
) {
  const { displayName, redact } = options;
  const builder = Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'lookup-1', name: 'lookup', args: {} }] }, ANSWER],
    }),
    model: 'mock',
    ...(redact === undefined ? {} : { redact }),
  }).tool(
    defineTool({
      name: 'lookup',
      description: 'Look up a record.',
      inputSchema: { type: 'object', properties: {} },
      ...(displayName === undefined ? {} : { displayName }),
      execute,
    }),
  );
  if (options.results) builder.resultsLayer();
  const agent = builder.build();
  const recorder = recordRun(agent);
  try {
    const answer = await agent.run({ message: 'Look up the record.' });
    const assessment = await agent.assessment();
    const saved = assessAnswer(JSON.parse(JSON.stringify(recorder.toRecording())));
    return { answer, assessment, saved };
  } finally {
    recorder.stop();
  }
}

describe('the default warning carries recorded reason detail', () => {
  it('says a named tool timed out from the engine category', async () => {
    const run = await runWithWarning(
      () => {
        throw new AttemptTimeoutError(1, 30000);
      },
      { displayName: 'Collector check' },
    );
    expect(run.answer).toContain('Collector check timed out');
    expect(run.assessment?.reasons).toContainEqual(
      expect.objectContaining({ reason: 'call-not-completed', detail: { category: 'timeout' } }),
    );
    expect(run.saved).toEqual(run.assessment);
  });

  it.each([
    { category: 'rate-limited', data: { status: 429 }, text: 'hit a rate limit' },
    { category: 'server', data: { status: 503 }, text: 'failed with a server error' },
    { category: 'network', data: { code: 'ECONNRESET' }, text: 'failed with a network error' },
    { category: 'auth', data: { status: 403 }, text: 'failed an access check' },
    { category: 'permanent', data: { status: 422 }, text: 'failed with a non-retryable error' },
    { category: 'unknown', data: {}, text: 'did not complete (failed)' },
  ])(
    'uses the engine category $category without quoting the error',
    async ({ category, data, text }) => {
      const message = 'timed out contacting the collector after 30 s';
      const run = await runWithWarning(
        () => {
          throw Object.assign(new Error(message), data);
        },
        { displayName: 'Collector check' },
      );
      const line = String(run.answer).split('\n\n---\n\n')[1];
      expect(line).toBe(`Not sure — Collector check ${text}.`);
      expect(line).not.toContain(message);
      expect(run.assessment?.reasons).toContainEqual(
        expect.objectContaining({ reason: 'call-not-completed', detail: { category } }),
      );
      expect(run.saved).toEqual(run.assessment);
    },
  );

  it.each([undefined, 'Inventory lookup'])(
    'uses the declared short gap for %s',
    async (displayName) => {
      const run = await runWithWarning(
        () =>
          coverage([{ available: true }], {
            checked: ['Current stock'],
            notChecked: [{ what: 'Older inventory archives', short: 'Older archives' }],
          }),
        { displayName },
      );
      expect(run.answer).toContain('Older archives');
      expect(run.answer).not.toContain('Older inventory archives');
      if (displayName !== undefined) expect(run.answer).toContain(displayName);
      expect(run.saved).toEqual(run.assessment);
    },
  );

  it('carries an admitted absence suggestion without the limits block', async () => {
    const run = await runWithWarning(() =>
      absent({
        what: 'the requested record',
        checked: ['Current stock'],
        tryInstead: 'Try the archived list',
      }),
    );
    expect(run.answer).toContain('Try the archived list');
    expect(run.saved).toEqual(run.assessment);
  });

  it('attributes each suggestion to the tool that declared it', async () => {
    const lookup = (name: string, displayName: string, tryInstead: string) =>
      defineTool({
        name,
        displayName,
        description: 'Read a fixture index.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => absent({ what: 'the item', checked: ['Index'], tryInstead }),
      });
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'live', name: 'live_index', args: {} },
              { id: 'archive', name: 'archive_index', args: {} },
            ],
          },
          ANSWER,
        ],
      }),
      model: 'mock',
    })
      .tool(lookup('live_index', 'Live index', 'Try the running list'))
      .tool(lookup('archive_index', 'Archive index', 'Try backup records'))
      .build();
    const answer = await agent.run({ message: 'Find the item.' });
    expect(answer).toContain(
      'Live index suggested “Try the running list”; Archive index suggested “Try backup records”',
    );
  });

  it('keeps a selected long suggestion out of the default warning', async () => {
    const advice =
      'Check the archived records for the previous quarter before trying again. '.repeat(2);
    const run = await runWithWarning(
      () =>
        absent({ what: 'the requested record', checked: ['Current stock'], tryInstead: advice }),
      { redact: { fields: { coverageDeclared: ['0.tryInstead'] } } },
    );
    expect(run.answer).toBe(`${ANSWER}\n\n---\n\nNot sure — a tool said nothing matched.`);
    expect(
      run.assessment?.reasons.find(({ reason }) => reason === 'declared-absent')?.detail,
    ).toBeUndefined();
    expect(run.saved).toEqual(run.assessment);
  });

  it.each([
    { keys: ['coverageDeclared'] },
    { fields: { coverageDeclared: ['0.notChecked.0.what'] } },
    { fields: { coverageDeclared: ['0.notChecked.0.short'] } },
  ])('keeps retained declaration text out of the live warning under %j', async (redact) => {
    const options = { displayName: 'Inventory lookup', redact };
    const read = (word: string) =>
      runWithWarning(
        () =>
          coverage([{ available: true }], {
            checked: ['Current stock'],
            notChecked: [{ what: `Inventory in ${word}`, short: word }],
          }),
        options,
      );
    const first = await read('archive one');
    const second = await read('archive two');
    expect(first.answer).toContain('Not sure');
    expect(first.answer).toEqual(second.answer);
    expect(first.answer).not.toContain('archive');
    expect(first.assessment?.reasons.some((reason) => reason.detail?.toolSays !== undefined)).toBe(
      false,
    );
    expect(second.assessment?.reasons.some((reason) => reason.detail?.toolSays !== undefined)).toBe(
      false,
    );
  });

  it('bounds total quoted text and counts omitted declaration words', async () => {
    const run = await runWithWarning(() =>
      coverage([{ available: true }], {
        checked: ['Current stock'],
        cannotCover: ['Archived stock '.repeat(8), 'Orders '.repeat(16), 'Returns '.repeat(14)].map(
          (what) => ({ what, why: 'Outside the lookup window' }),
        ),
      }),
    );
    const detail = run.assessment?.reasons.find(({ reason }) => reason === 'coverage-gap')?.detail;
    const words = detail?.toolSays;
    expect(run.answer).toContain('cannot cover');
    expect(words?.entries.map(({ kind }) => kind)).toEqual(['cannotCover', 'cannotCover']);
    expect(
      words?.entries.reduce((size, { text, why }) => size + text.length + (why?.length ?? 0), 0),
    ).toBeLessThanOrEqual(160);
    expect(words?.omitted).toBe(1);
    expect(run.answer).toContain('1 more in the run record');
    expect(run.saved).toEqual(run.assessment);
  });

  it('binds declared words to the occurrence that produced a period verdict', async () => {
    const run = await runWithWarning(
      () =>
        coverage([{ available: true }], {
          notChecked: [{ what: 'Archive inventory by day', short: 'Archive inventory' }],
          period: {
            queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
            held: { from: '2026-09-25T09:00:00Z', to: '2026-09-25T10:00:00Z' },
          },
        }),
      { displayName: 'Inventory lookup', results: true },
    );
    const period = run.assessment?.reasons.find(({ reason }) => reason === 'period-not-held');
    expect(period?.detail?.toolSays?.entries).toEqual([
      { kind: 'notChecked', text: 'Archive inventory', toolName: 'lookup' },
    ]);
    expect(run.answer).toContain('Inventory lookup read data that does not reach');
    expect(run.saved).toEqual(run.assessment);
  });
});

it('retains older saved warning text with neither newer wording rule', () => {
  const data = {
    assessment: 'unknown',
    standing: 'not-sure',
    reasons: ['check-unreachable', 'coverage-gap'],
    checked: [],
  } as const;
  const old: StandingNames = {
    sources: new Map([['coverage-gap', { kind: 'calls', calls: [] }]]),
    displayNames: new Map(),
    dispatchProofGap: true,
  };
  const expanded: StandingNames = {
    ...old,
    legacyConflictGap: true,
    details: new Map([
      [
        'coverage-gap',
        {
          toolSays: { entries: [{ kind: 'notChecked', text: 'The archive' }], omitted: 0 },
        },
      ],
    ]),
  };
  expect(recordedStandingLinesOf(data, [], false, expanded)).toContain(
    standingLineOf(data, [], false, old),
  );
});

it('recognizes the exact saved subject-only line even when the record contains why', () => {
  const data = {
    assessment: 'unknown',
    standing: 'not-sure',
    reasons: ['check-unreachable', 'coverage-gap'],
    checked: [],
  } as const;
  const subject = { kind: 'notChecked', text: 'The archive' } as const;
  const earlier: StandingNames = {
    sources: new Map([['coverage-gap', { kind: 'calls', calls: [] }]]),
    displayNames: new Map(),
    dispatchProofGap: true,
    details: new Map([['coverage-gap', { toolSays: { entries: [subject], omitted: 1 } }]]),
  };
  const current: StandingNames = {
    ...earlier,
    legacyConflictGap: true,
    details: new Map([
      [
        'coverage-gap',
        { toolSays: { entries: [{ ...subject, why: 'collection paused' }], omitted: 1 } },
      ],
    ]),
  };
  const earlierLine = standingLineOf(data, [], false, earlier);
  const currentLine = standingLineOf(data, [], false, current);
  expect(earlierLine).toContain('did not check “The archive”; 1 more in the run record');
  expect(currentLine).toContain('did not check “The archive” because “collection paused”');
  expect(recordedStandingLinesOf(data, [], false, current)).toEqual(
    expect.arrayContaining([earlierLine, currentLine]),
  );
});

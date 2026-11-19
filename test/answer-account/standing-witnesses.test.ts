import { describe, expect, it } from 'vitest';

import { Agent, defineTool, isInputPause, requestInput, slidingWindow } from '../../src/index.js';
import { defineSkill } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../src/observe.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { REDACTION_MARKER_ID } from '../../src/redaction/marker.js';
import { assertP1 } from './helpers.js';

const REPLY = 'The request was received.';
const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  toolCalls: [{ id, name, args }],
});

async function recorded(agent: Agent) {
  const recorder = recordRun(agent);
  try {
    const result = await agent.run({ message: 'Submit the request.' });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    return { result, recording };
  } finally {
    recorder.stop();
  }
}

async function pending(displayName?: string): Promise<Recording> {
  const agent = Agent.create({
    provider: mock({ replies: [call('c1', 'submit_request'), { content: REPLY }] }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'submit_request',
        ...(displayName !== undefined && { displayName }),
        description: 'Submit a request.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => ({ content: 'Request received.', effects: [], status: 'pending' }),
      }),
    )
    .answerLayer({ standingLine: true })
    .build();
  return (await recorded(agent)).recording;
}

async function skipped(count = 1): Promise<Recording> {
  const steps = Array.from({ length: count }, (_, i) => ({
    tool: `submit_request_${i + 1}`,
    note: 'Submit the request.',
  }));
  const tools = steps.map(({ tool }) =>
    defineTool({
      name: tool,
      description: 'Submit a request.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'Request received.',
    }),
  );
  const agent = Agent.create({
    provider: mock({
      replies: [
        call('open', 'read_skill', { id: 'submit' }),
        ...steps.map((_, i) => call(`skip${i}`, 'skip_step', { reason: 'Already sent.' })),
        { content: REPLY },
      ],
    }),
    model: 'mock',
  })
    .skill(
      defineSkill({
        id: 'submit',
        description: 'Submit a request.',
        body: 'Follow each step.',
        tools,
        steps,
      }),
    )
    .answerLayer({ standingLine: true })
    .build();
  return (await recorded(agent)).recording;
}

interface MutableSnapshot {
  sharedState: {
    history: Record<string, unknown>[];
    findingsLedger: Record<string, unknown>[] | string;
    compactions?: readonly unknown[];
  };
  recorders: { id: string }[];
}

function snapshotOf(recording: Recording): MutableSnapshot {
  return recording.snapshot as MutableSnapshot;
}

function turnEndOf(recording: Recording): Record<string, unknown> {
  return recording.events.find((event) => event.type === 'agentfootprint.agent.turn_end')!
    .payload as unknown as Record<string, unknown>;
}

function assertUnclaimed(recording: Recording) {
  const account = accountForAnswer(recording);
  expect(account.answer.value).toBe(turnEndOf(recording).finalContent);
  expect(account.facts.limitsBlock.status).toBe('not-applicable');
}

const SAME_ID_WITNESS_MODES = [
  'in-tool pause',
  'sliding window',
  'sliding window after both results left',
  'complete history',
] as const;

describe('standing reasons rebuilt from their committed witnesses', () => {
  it.each(SAME_ID_WITNESS_MODES)(
    'keeps the first same-ID argument failure with a %s',
    async (mode) => {
      const paused = mode === 'in-tool pause';
      const bothRetained = mode === 'complete history';
      const windowed = !paused && !bothRetained;
      const bothEvicted = mode === 'sliding window after both results left';
      const name = 'read_shelf';
      const read = (shelf: string, quote: string, id = 'reused') =>
        call(id, name, {
          shelf,
          _findings: { from: [{ argument: 'shelf', source: 'user', quote }] },
        });
      const entered: string[] = [];
      const builder = Agent.create({
        provider: mock({
          replies: [
            read('alpha', 'missing alpha'),
            read('beta', 'beta'),
            ...(bothEvicted ? [read('gamma', 'gamma', 'different')] : []),
            { content: 'Read the shelf.' },
          ],
        }),
        model: 'mock',
        ...(windowed && { keepLastToolResults: false }),
      })
        .tool(
          defineTool({
            name,
            description: 'Read an inert fixture shelf.',
            inputSchema: { type: 'object', properties: { shelf: { type: 'string' } } },
            askOrAssume: { shelf: { assume: 'fallback' } },
            execute({ shelf }) {
              entered.push(String(shelf));
              if (paused && shelf === 'beta') {
                return requestInput({
                  id: 'confirm-shelf',
                  question: 'Continue the fixture lookup?',
                  fields: [{ id: 'confirm', type: 'string', required: true }],
                });
              }
              return `${shelf} fixture result ${'x'.repeat(600)}`;
            },
          }),
        )
        .inputsLayer({ argumentSources: true });
      if (windowed) builder.window(slidingWindow({ keepRecentTurns: 1 }));
      if (bothRetained) builder.answerLayer({ standingLine: true });
      const agent = builder.build();
      const recorder = recordRun(agent);
      try {
        const result = await agent.run({ message: 'Read the fixture shelves beta and gamma.' });
        if (windowed) expect(result).toBe('Read the shelf.');
        else if (paused) expect(isInputPause(result)).toBe(true);
        expect(entered).toEqual(bothEvicted ? ['alpha', 'beta', 'gamma'] : ['alpha', 'beta']);
        const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
        const { history, findingsLedger, compactions } = snapshotOf(recording).sharedState;
        const results = history.filter((message) => message.role === 'tool');
        expect(results).toHaveLength(bothRetained ? 2 : 1);
        if (bothRetained) {
          expect(
            results.map(({ toolCallId, toolResultExecution, content }) => ({
              toolCallId,
              toolResultExecution,
              content,
            })),
          ).toEqual([
            {
              toolCallId: 'reused',
              toolResultExecution: 'returned',
              content: expect.stringContaining('alpha fixture result'),
            },
            {
              toolCallId: 'reused',
              toolResultExecution: 'returned',
              content: expect.stringContaining('beta fixture result'),
            },
          ]);
        }
        if (windowed) {
          const retained = bothEvicted ? 'gamma' : 'beta';
          expect(results[0]?.content).toContain(`${retained} fixture result`);
          expect(history.filter((message) => Array.isArray(message.toolCalls))).toMatchObject([
            { toolCalls: [{ args: { shelf: retained } }] },
          ]);
          expect(compactions).toContainEqual(expect.objectContaining({ removedMessageCount: 2 }));
          const settled = recording.events.filter(
            (event) =>
              event.type === 'agentfootprint.stream.tool_end' &&
              event.payload.toolCallId === 'reused',
          );
          expect(settled).toHaveLength(2);
        }
        expect(findingsLedger).toMatchObject([
          { kind: 'argument', argument: 'shelf', iteration: 1, failed: 'quote-not-found' },
          { kind: 'argument', argument: 'shelf', iteration: 2, source: 'said' },
          ...(bothEvicted
            ? [
                {
                  kind: 'argument',
                  toolCallId: 'different',
                  argument: 'shelf',
                  iteration: 3,
                  source: 'said',
                },
              ]
            : []),
        ]);
        const pointer = { kind: 'state', key: 'findingsLedger', path: '/0/argument' };
        const assessment = assessAnswer(recording);
        const argumentReason = assessment.reasons.find(
          (row) => row.reason === 'argument-unverified',
        );
        expect(argumentReason).toMatchObject({
          witness: [pointer],
          ...(!bothEvicted &&
            !bothRetained && { source: { kind: 'calls', calls: [], unplaced: [pointer] } }),
        });
        if (bothEvicted) {
          expect(argumentReason?.source).toEqual({
            kind: 'calls',
            calls: [{ toolCallId: 'reused', toolName: name }],
          });
        }
        if (bothRetained) {
          expect((await agent.assessment())?.reasons).toEqual(assessment.reasons);
          expect(result).toBe(
            'Read the shelf.\n\n---\n\n' +
              'Not sure — a value a call ran with came from the model, with no source on the record.',
          );
        }
        const account = accountForAnswer(recording);
        const reason = account.rows
          .find((row) => row.id === 'how-sure')
          ?.lines.find((line) => line.template.id === 'howSure.reason.argumentUnverified');
        expect(reason).toMatchObject({ pointers: [pointer] });
        assertP1(account, recording);
      } finally {
        recorder.stop();
        await agent.shutdown();
      }
    },
  );

  it.each([
    ['Review', 'Review reported its work as partial and Submission reported its work as pending'],
    [undefined, 'Submission reported its work as pending and a tool reported unfinished work'],
  ])(
    'keeps each reported status when two batches reuse an id (review name %s)',
    async (displayName, clause) => {
      const id = 'request';
      const agent = Agent.create({
        provider: mock({
          replies: [call(id, 'review_request'), call(id, 'submit_request'), { content: REPLY }],
        }),
        model: 'mock',
      })
        .tools([
          defineTool({
            name: 'review_request',
            ...(displayName !== undefined && { displayName }),
            description: 'Review the request.',
            inputSchema: { type: 'object' },
            execute: () => ({ content: 'Review started.', effects: [], status: 'partial' }),
          }),
          defineTool({
            name: 'submit_request',
            displayName: 'Submission',
            description: 'Submit the request.',
            inputSchema: { type: 'object' },
            execute: () => ({ content: 'Request received.', effects: [], status: 'pending' }),
          }),
        ])
        .answerLayer({ standingLine: true })
        .build();

      const { result, recording } = await recorded(agent);
      const history = snapshotOf(recording).sharedState.history;
      const messages = history.filter((message) => message.role === 'tool');
      expect(messages).toMatchObject([
        { toolCallId: id, toolName: 'review_request', reportedStatus: 'partial' },
        { toolCallId: id, toolName: 'submit_request', reportedStatus: 'pending' },
      ]);
      const pointers = messages.map((message) => ({
        kind: 'history',
        index: history.indexOf(message),
        path: '/reportedStatus',
        toolCallId: id,
      }));

      const line = `Not sure — ${clause}.`;
      expect.soft(result).toBe(`${REPLY}\n\n---\n\n${line}`);
      const account = accountForAnswer(recording);
      expect.soft(account.answer.value).toBe(REPLY);
      expect.soft(account.facts.limitsBlock.value).toBe(line);
      const reason = account.rows
        .find((row) => row.id === 'how-sure')
        ?.lines.find((sentence) => sentence.template.id === 'howSure.reason.workNotFinished');
      expect(reason).toMatchObject({
        text: '2 calls reported unfinished work.',
        status: 'recorded',
        pointers,
      });
      assertP1(account, recording);
    },
  );

  it.each([
    [undefined, 'Not sure — a tool reported unfinished work.'],
    ['Request submission', 'Not sure — Request submission reported its work as pending.'],
  ])('rebuilds a pending standing with display name %s', async (displayName, line) => {
    const recording = await pending(displayName);
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe(REPLY);
    expect(account.facts.limitsBlock.value).toBe(line);
    expect(account.rows.find((row) => row.id === 'how-sure')?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '1 call reported unfinished work.',
          pointers: [expect.objectContaining({ kind: 'history', path: '/reportedStatus' })],
        }),
      ]),
    );
    assertP1(account, recording);
  });

  it('rebuilds the skipped-step standing and points to its row', async () => {
    const recording = await skipped();
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe(REPLY);
    expect(account.facts.limitsBlock.value).toBe('Not sure — a declared step was skipped.');
    expect(account.rows.find((row) => row.id === 'how-sure')?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '1 declared step was skipped.',
          pointers: [
            expect.objectContaining({
              kind: 'state',
              key: 'findingsLedger',
              path: expect.any(String),
            }),
          ],
        }),
      ]),
    );
    assertP1(account, recording);
  });

  it('rebuilds the number of skipped steps from their witnesses', async () => {
    const recording = await skipped(2);
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe(REPLY);
    expect(account.facts.limitsBlock.value).toBe('Not sure — 2 declared steps were skipped.');
    const reason = account.rows
      .find((row) => row.id === 'how-sure')
      ?.lines.find((line) => line.template.id === 'howSure.reason.stepSkipped');
    expect(reason?.text).toBe('2 declared steps were skipped.');
    expect(reason?.pointers).toHaveLength(2);
    assertP1(account, recording);
  });

  it.each(['missing', 'hidden'] as const)(
    'leaves the line unclaimed when a status is %s',
    async (condition) => {
      const recording = await pending();
      const snapshot = snapshotOf(recording);
      const message = snapshot.sharedState.history.find((message) => message.toolCallId === 'c1')!;
      if (condition === 'missing') delete message.reportedStatus;
      else {
        snapshot.recorders.push({ id: REDACTION_MARKER_ID });
        message.reportedStatus = 'REDACTED';
      }
      assertUnclaimed(recording);
    },
  );

  it.each(['missing', 'hidden'] as const)(
    'leaves the line unclaimed when a step witness is %s',
    async (condition) => {
      const recording = await skipped();
      const snapshot = snapshotOf(recording);
      if (condition === 'missing') snapshot.sharedState.findingsLedger = [];
      else {
        snapshot.recorders.push({ id: REDACTION_MARKER_ID });
        snapshot.sharedState.findingsLedger = 'REDACTED';
      }
      assertUnclaimed(recording);
    },
  );

  it.each(['missing', 'hidden', 'hidden entry'] as const)(
    'leaves the line unclaimed when display names are %s',
    async (condition) => {
      const recording = await pending(
        condition === 'hidden entry' ? '[REDACTED]' : 'Request submission',
      );
      const end = turnEndOf(recording);
      if (condition === 'missing') delete end.standingLineNames;
      else {
        snapshotOf(recording).recorders.push({ id: REDACTION_MARKER_ID });
        end.standingLineNames =
          condition === 'hidden' ? '[REDACTED]' : { submit_request: '[REDACTED]' };
      }
      assertUnclaimed(recording);
    },
  );
});

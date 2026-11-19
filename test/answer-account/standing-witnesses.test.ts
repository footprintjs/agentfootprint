import { describe, expect, it } from 'vitest';

import { Agent, defineTool, isInputPause, requestInput } from '../../src/index.js';
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

describe('standing reasons rebuilt from their committed witnesses', () => {
  it('keeps a landed argument failure when the next same-ID lookup pauses inside its tool', async () => {
    const name = 'read_shelf';
    const read = (shelf: string, quote: string) =>
      call('reused', name, {
        shelf,
        _findings: { from: [{ argument: 'shelf', source: 'user', quote }] },
      });
    const entered: string[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [read('alpha', 'missing alpha'), read('beta', 'beta')] }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name,
          description: 'Read an inert fixture shelf.',
          inputSchema: { type: 'object', properties: { shelf: { type: 'string' } } },
          askOrAssume: { shelf: { assume: 'fallback' } },
          execute({ shelf }) {
            entered.push(String(shelf));
            return shelf === 'beta'
              ? requestInput({
                  id: 'confirm-shelf',
                  question: 'Continue the fixture lookup?',
                  fields: [{ id: 'confirm', type: 'string', required: true }],
                })
              : 'Fixture result';
          },
        }),
      )
      .inputsLayer({ argumentSources: true })
      .build();
    const recorder = recordRun(agent);
    try {
      const paused = await agent.run({ message: 'Read the fixture shelf beta.' });
      expect(isInputPause(paused)).toBe(true);
      expect(entered).toEqual(['alpha', 'beta']);
      const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
      const { history, findingsLedger } = snapshotOf(recording).sharedState;
      expect(history.filter((message) => message.role === 'tool')).toHaveLength(1);
      expect(findingsLedger).toMatchObject([
        { kind: 'argument', argument: 'shelf', iteration: 1, failed: 'quote-not-found' },
        { kind: 'argument', argument: 'shelf', iteration: 2, source: 'said' },
      ]);
      const pointer = { kind: 'state', key: 'findingsLedger', path: '/0/argument' };
      const assessment = assessAnswer(recording);
      expect(assessment.reasons.find((row) => row.reason === 'argument-unverified')).toMatchObject({
        witness: [pointer],
        source: { kind: 'calls', calls: [], unplaced: [pointer] },
      });
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
  });

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

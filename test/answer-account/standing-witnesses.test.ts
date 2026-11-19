import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { defineSkill } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../src/observe.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { REDACTION_MARKER_ID } from '../../src/redaction/marker.js';
import { assertP1 } from './helpers.js';

const REPLY = 'The request was received.';
const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  toolCalls: [{ id, name, args }],
});

async function recorded(agent: Agent): Promise<Recording> {
  const recorder = recordRun(agent);
  await agent.run({ message: 'Submit the request.' });
  recorder.stop();
  return JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
}

function pending(displayName?: string): Promise<Recording> {
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
  return recorded(agent);
}

function skipped(count = 1): Promise<Recording> {
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
  return recorded(agent);
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

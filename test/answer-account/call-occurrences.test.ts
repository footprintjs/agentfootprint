import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../src/observe.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';

const results = [
  ['review_request', 'partial'],
  ['submit_request', 'pending'],
] as const;

async function recordedCalls(sameReply: boolean) {
  const entered: string[] = [];
  const proposals = results.map(([name]) => ({ id: 'request', name, args: {} }));
  const batches = sameReply ? [proposals] : proposals.map((proposal) => [proposal]);
  const agent = Agent.create({
    provider: mock({
      replies: [...batches.map((toolCalls) => ({ toolCalls })), { content: 'Request received.' }],
    }),
    model: 'mock',
  })
    .tools(
      results.map(([name, status]) =>
        defineTool({
          name,
          description: 'Process the fixture request.',
          inputSchema: { type: 'object' },
          execute: () => {
            entered.push(name);
            return { content: 'Fixture result.', effects: [], status };
          },
        }),
      ),
    )
    .answerLayer({ standingLine: true })
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'Review and submit the fixture request.' });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    return { recording, entered };
  } finally {
    recorder.stop();
  }
}

describe('call occurrence attribution in the saved answer account', () => {
  it.each([
    ['separate replies', false],
    ['one reply', true],
  ] as const)('keeps both statuses and pointers for a reused ID in %s', async (_, sameReply) => {
    const { recording, entered } = await recordedCalls(sameReply);
    expect(entered).toEqual(results.map(([name]) => name));

    const account = accountForAnswer(recording);
    expect(
      account.facts.calls.map(({ toolCallId, toolName, reportedStatus }) => [
        toolCallId,
        toolName,
        reportedStatus,
      ]),
    ).toEqual(results.map(([name, status]) => ['request', name, status]));

    const found = account.rows.find((row) => row.id === 'found');
    for (const [index, [name, status]] of results.entries()) {
      const start = recording.events.findIndex(
        (event) =>
          event.type === 'agentfootprint.stream.tool_start' && event.payload.toolName === name,
      );
      expect(start).toBeGreaterThanOrEqual(0);
      const stage = recording.events[start]?.meta?.runtimeStageId;
      expect(typeof stage).toBe('string');
      const end = recording.events.findIndex(
        (event, at) =>
          at > start &&
          event.type === 'agentfootprint.stream.tool_end' &&
          event.meta?.runtimeStageId === stage &&
          event.payload.status === status,
      );
      expect(end).toBeGreaterThan(start);
      const pointers = [
        { kind: 'event', index: start, path: '/toolName', runtimeStageId: stage },
        { kind: 'event', index: end, path: '/status', runtimeStageId: stage },
      ];
      expect(account.facts.calls[index]?.pointers).toEqual(
        expect.arrayContaining(pointers.map((pointer) => expect.objectContaining(pointer))),
      );
      expect(found?.lines).toContainEqual(
        expect.objectContaining({
          text: `${name} ran. The tool reported a status of ${status}.`,
          pointers: expect.arrayContaining(
            pointers.map((pointer) => expect.objectContaining(pointer)),
          ),
        }),
      );
    }
  });
});

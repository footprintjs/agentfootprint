import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../src/observe.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { assertP1, assertP7 } from './helpers.js';

const call = { id: 'c1', name: 'submit_request', args: {} };

async function recordedResult(result: unknown, maxChars?: number): Promise<Recording> {
  const agent = Agent.create({
    provider: mock({ replies: [{ toolCalls: [call] }, { content: 'Done.' }] }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: call.name,
        description: 'Submit a request.',
        inputSchema: { type: 'object', properties: {} },
        ...(maxChars !== undefined && { resultCeiling: { maxChars } }),
        execute: () => result,
      }),
    )
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'Submit the request.' });
  recorder.stop();
  return JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
}

describe('a tool result with a declared status', () => {
  it.each([
    ['failure', 'The tool reported a status of failure.', 'tool:submit_request'],
    ['denied', 'The tool reported a status of denied.', 'tool:submit_request'],
    ['invalid', 'The result was recorded as invalid.', 'library'],
    ['partial', 'The tool reported a status of partial.', 'tool:submit_request'],
    ['pending', 'The tool reported a status of pending.', 'tool:submit_request'],
  ])('reports %s and separately says that the tool ran', async (status, wording, source) => {
    const recording = await recordedResult({ content: 'Request received.', effects: [], status });
    const endIndex = recording.events.findIndex(
      (event) => event.type === 'agentfootprint.stream.tool_end',
    );
    const account = accountForAnswer(recording);

    expect(recording.events[endIndex]?.payload).toMatchObject({ entered: true, status });
    expect(account.facts.calls).toMatchObject([
      { toolName: call.name, outcome: 'ran', reportedStatus: status },
    ]);
    const found = account.rows.find((row) => row.id === 'found')?.lines[0];
    expect(found).toMatchObject({ text: `${call.name} ran. ${wording}`, source });
    expect(found?.pointers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'event', index: endIndex, path: '/entered' }),
        expect.objectContaining({ kind: 'event', index: endIndex, path: '/status' }),
      ]),
    );
    if (status === 'failure' || status === 'denied' || status === 'invalid') {
      const lines = account.rows.find((row) => row.id === 'anything-wrong')?.lines;
      expect(lines?.map((line) => line.template.id)).not.toContain('wrong.noErrors');
    }
    assertP1(account, recording, {});
    assertP7(account, recording, {});
  });

  it('attributes an invalid result recorded by the result ceiling to the library', async () => {
    const recording = await recordedResult('Request received.', 10);
    const account = accountForAnswer(recording);

    expect(account.facts.calls).toMatchObject([
      { toolName: call.name, outcome: 'ran', reportedStatus: 'invalid' },
    ]);
    expect(account.rows.find((row) => row.id === 'found')?.lines[0]).toMatchObject({
      text: `${call.name} ran. The result was recorded as invalid.`,
      source: 'library',
    });
    assertP1(account, recording, {});
    assertP7(account, recording, {});
  });

  it.each([
    ['plain result words', 'Request failed.'],
    ['success', { content: 'Request received.', effects: [], status: 'success' }],
    ['unknown status', { content: 'Request received.', effects: [], status: 'failure-ish' }],
    ['absent', { content: 'Request received.', effects: [], status: 'absent' }],
  ])('adds no status field for %s', async (_what, result) => {
    const account = accountForAnswer(await recordedResult(result));
    expect(account.facts.calls[0]).toMatchObject({ outcome: 'ran' });
    expect(account.facts.calls[0]).not.toHaveProperty('reportedStatus');
    expect(account.rows.find((row) => row.id === 'found')?.lines[0]?.template.id).not.toBe(
      'found.reportedStatus',
    );
  });
});

import { expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';
import { Agent, coverage, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { callTraceTool, recordRun, traceToolpack, type Recording } from '../../src/observe.js';
import { openRecording } from '../../src/debug.js';
import { readCallOccurrenceKey } from '../../src/lib/callOccurrence.js';
import type { LLMRequest } from '../../src/provider-contract/types.js';

const EVENT_TYPES = [
  'agentfootprint.stream.tool_start',
  'agentfootprint.stream.tool_end',
  'agentfootprint.tools.coverage_declared',
  'agentfootprint.context.injected',
] as const;

async function recorded(redact: RedactionPolicy) {
  const provider = mock({
    replies: [
      { toolCalls: [{ id: 'fixture-call', name: 'lookup', args: {} }] },
      { content: 'Inventory checked.' },
    ],
  });
  const requests: LLMRequest[] = [];
  const agent = Agent.create({
    provider: {
      name: provider.name,
      complete(request) {
        requests.push(request);
        return provider.complete(request);
      },
    },
    model: 'mock',
    redact,
  })
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Read a fixture inventory.',
        inputSchema: { type: 'object' },
        execute: () => coverage([{ count: 7 }], { checked: ['inventory'] }),
      }),
    )
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run('Read the specimen inventory.');
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.some((m) => m.role === 'tool')).toBe(true);
    expect(JSON.stringify(requests)).not.toContain('callOccurrenceKey');
    return recording;
  } finally {
    recorder.stop();
  }
}

function savedKeys(recording: Recording) {
  const snapshot = recording.snapshot as {
    sharedState: {
      history: readonly {
        readonly role: string;
        readonly toolCalls?: readonly object[];
      }[];
      coverageDeclared: readonly object[];
    };
    commitLog: readonly { runtimeStageId: string }[];
  };
  const { history, coverageDeclared } = snapshot.sharedState;
  const saved = [history[1].toolCalls?.[0], history[2], coverageDeclared[0]];
  expect(history[2].role).toBe('tool');
  const eventKeys = EVENT_TYPES.map((type) =>
    recording.events.find(
      (e) =>
        e.type === type &&
        (e.type !== 'agentfootprint.context.injected' || e.payload.source === 'tool-result'),
    ),
  ).map((event) => (event === undefined ? undefined : readCallOccurrenceKey(event.payload)));
  return {
    state: saved.map((row) => (row === undefined ? undefined : readCallOccurrenceKey(row))),
    eventKeys,
    lastStage: snapshot.commitLog.at(-1)?.runtimeStageId,
  };
}

it('serves explicitly masked occurrence keys as unreadable and leaves ordinary requests clean', async () => {
  const ordinary = savedKeys(await recorded({ keys: ['unrelated-field'] }));
  const key = ordinary.state[0];
  expect(typeof key).toBe('string');
  expect(ordinary.state).toEqual([key, key, key]);
  expect(ordinary.eventKeys).toEqual([key, key, key, key]);

  const masked = await recorded({
    keys: ['callOccurrenceKey'],
    fields: {
      history: ['1.toolCalls.0.callOccurrenceKey', '2.callOccurrenceKey'],
      coverageDeclared: ['0.callOccurrenceKey'],
    },
  });
  const saved = savedKeys(masked);
  expect(saved.state).toEqual([null, null, null]);
  expect(saved.eventKeys).toEqual([null, null, null, null]);
  const trace = await callTraceTool(traceToolpack(openRecording(masked)), 'get_value', {
    runtimeStageId: saved.lastStage,
    key: 'history',
    maxChars: 8000,
  });
  expect(trace).toMatch(/"callOccurrenceKey":"(?:\[)?REDACTED(?:\])?"/);
  expect(trace).not.toContain('"callOccurrenceKey":[');
});

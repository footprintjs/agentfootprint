import { expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import {
  Agent,
  defineTool,
  epochLocations,
  keyedFold,
  slidingWindow,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { recordRun } from '../../../../src/observe.js';
import type { ServedRow } from '../../../../src/core/agent/receipt/servedRow.js';
import type { LLMMessage, LLMRequest } from '../../../../src/provider-contract/types.js';

const servedKey = 'sourceLinkServedRows';
const earlyResult = `Early sample. ${'One retained row of evidence. '.repeat(22)}`;

async function recordHistory(windowed: boolean, result: string, redact?: RedactionPolicy) {
  const rounds = windowed ? 4 : 1;
  const fixture = mock({
    replies: [
      ...Array.from({ length: rounds }, (_, index) => ({
        toolCalls: [{ id: `sample-${index}`, name: 'sample', args: {} }],
      })),
      { content: 'Finished.' },
    ],
  });
  const requests: LLMRequest[] = [];
  let sample = 0;
  const builder = Agent.create({
    model: 'mock',
    maxIterations: rounds + 2,
    provider: {
      name: fixture.name,
      complete(request) {
        requests.push(request);
        return fixture.complete(request);
      },
    },
    ...(redact === undefined ? {} : { redact }),
  }).tool(
    defineTool({
      name: 'sample',
      description: 'Read a sample label.',
      inputSchema: { type: 'object' },
      execute: () => (sample++ === 0 ? result : 'Later sample'),
    }),
  );
  if (windowed) builder.window(slidingWindow({ keepRecentTurns: 1 }));
  const agent = builder.build();
  const recorder = recordRun(agent);
  try {
    expect(await agent.run(`Read the labels. ${'Start the sampling exercise. '.repeat(18)}`)).toBe(
      'Finished.',
    );
    return { recording: recorder.toRecording(), requests };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

it('keeps the original served row after the window evicts its tool result', async () => {
  const { recording, requests } = await recordHistory(true, earlyResult);
  const epochs = epochLocations(recording.snapshot);
  expect(epochs).toHaveLength(requests.length);
  const first = epochs[1]!;
  const later = epochs.at(-1)!;
  expect(requests[1]!.messages.some(({ content }) => content === earlyResult)).toBe(true);
  expect(requests.at(-1)!.messages.some(({ content }) => content === earlyResult)).toBe(false);
  expect(recording.events.some(({ type }) => type === 'agentfootprint.context.evicted')).toBe(true);

  const firstFold = keyedFold(first.source);
  const originalHistory = firstFold.valueAt('history', first.callIdx - 1) as readonly LLMMessage[];
  const position = originalHistory.findIndex(({ content }) => content === earlyResult);
  expect(position).toBeGreaterThanOrEqual(0);
  const rows =
    (firstFold.valueAt(servedKey, first.callIdx) as readonly ServedRow[] | undefined) ?? [];
  const served = rows.find(({ consumer }) => consumer === first.callRuntimeStageId);
  expect(
    served?.served[0]?.elements?.some(([start, end]) => start <= position && position < end),
  ).toBe(true);

  const laterRows = keyedFold(later.source).valueAt(
    servedKey,
    later.callIdx,
  ) as readonly ServedRow[];
  expect(laterRows.filter(({ consumer }) => consumer === first.callRuntimeStageId)).toEqual([
    served,
  ]);
});

it('records value-free positions even when the saved history key is redacted', async () => {
  const policy: RedactionPolicy = { keys: ['history'] };
  const hiddenInputs = ['private sample alpha', 'a different private sample'];
  const observed = [];
  for (const hidden of hiddenInputs) {
    const { recording, requests } = await recordHistory(false, hidden, policy);
    expect(requests[1]!.messages.some(({ content }) => content === hidden)).toBe(true);
    expect(recording.snapshot.sharedState).toMatchObject({ history: 'REDACTED' });
    const last = epochLocations(recording.snapshot).at(-1)!;
    const rows =
      (keyedFold(last.source).valueAt(servedKey, last.callIdx) as
        | readonly ServedRow[]
        | undefined) ?? [];
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(hidden);
    expect(rows.at(-1)).toEqual({
      kind: 'served',
      version: 1,
      consumer: last.callRuntimeStageId,
      served: [{ key: 'history', elements: [[0, requests[1]!.messages.length]] }],
    });
    observed.push(rows.map(({ served }) => served));
  }
  expect(observed[0]).toEqual(observed[1]);
});

import { expect, it } from 'vitest';
import { NoOpCacheStrategy } from '../../../../src/cache/index.js';
import { Agent, defineTool, isPaused, pauseHere } from '../../../../src/index.js';
import { readCallOccurrenceKey } from '../../../../src/lib/callOccurrence.js';
import { mock } from '../../../../src/llm-providers.js';
import { recordRun } from '../../../../src/observe.js';
import type { LLMMessage } from '../../../../src/provider-contract/types.js';
import { epochLocations, readAfterCall, readAtCall } from '../../../../src/time-travel/index.js';

const reply = { toolCalls: [{ id: 'reused', name: 'sample', args: {} }] };
const sample = defineTool({
  name: 'sample',
  description: 'Read the sample.',
  inputSchema: { type: 'object' },
  execute: () => 'Sample read.',
});

it('commits the accepted consumer and the original positions of tool occurrences with a reused ID', async () => {
  const agent = Agent.create({
    model: 'mock',
    provider: mock({ replies: [reply, reply, { content: 'Finished.' }] }),
    maxIterations: 4,
  })
    .tool(sample)
    .build();
  const recorder = recordRun(agent);
  try {
    expect(await agent.run('Read the samples.')).toBe('Finished.');
    const recording = recorder.toRecording();
    const epochs = epochLocations(recording.snapshot);
    expect(epochs).toHaveLength(3);
    const final = epochs.at(-1)!;
    const start = recording.events.find(
      (event) =>
        event.type === 'agentfootprint.stream.llm_start' &&
        event.meta.runtimeStageId === final.callRuntimeStageId,
    );
    expect(start).toBeDefined();
    const positions = (readAtCall(final, 'history') as LLMMessage[]).flatMap((entry, element) => {
      if (entry.role !== 'tool') return [];
      expect(entry.toolCallId).toBe('reused');
      const occurrence = readCallOccurrenceKey(entry);
      expect(typeof occurrence).toBe('string');
      return [{ occurrence, element }];
    });
    expect(positions).toHaveLength(2);
    expect(positions[0]?.occurrence).not.toBe(positions[1]?.occurrence);
    expect(readAfterCall(final, 'sourceLinkConsumer')).toEqual({
      runId: start!.meta.runId,
      consumer: final.callRuntimeStageId,
      historyPositions: positions,
    });
    expect(readAfterCall(final, 'llmLatestContent')).toBe('Finished.');
    expect(final.log[final.callIdx]!.trace).toContainEqual(
      expect.objectContaining({ path: 'sourceLinkConsumer' }),
    );
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
});

it('drops a paused consumer when the next leg accepts an output without an exact served row', async () => {
  const agent = Agent.create({
    model: 'mock',
    provider: mock({ replies: [reply, { content: 'Finished.' }] }),
    cacheStrategy: {
      name: 'fixture-cache',
      async prepareRequest(request) {
        return {
          request: request.messages.some(({ role }) => role === 'tool')
            ? { ...request, messages: [...request.messages] }
            : request,
          markersApplied: [],
        };
      },
      extractMetrics: new NoOpCacheStrategy().extractMetrics,
    },
  })
    .tool({ ...sample, execute: () => pauseHere({ question: 'Which sample?' }) })
    .build();

  try {
    const paused = await agent.run('Read the sample.');
    if (!isPaused(paused)) throw new Error('Expected a paused sample request.');
    const [first] = epochLocations(agent.getSnapshot());
    expect(first).toBeDefined();
    const firstConsumer = readAfterCall(first!, 'sourceLinkConsumer');
    expect(firstConsumer).toMatchObject({ consumer: first!.callRuntimeStageId });

    const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint)) as typeof paused.checkpoint;
    expect(await agent.resume(checkpoint, 'Blue.')).toBe('Finished.');
    const [next] = epochLocations(agent.getSnapshot());
    expect(next).toBeDefined();
    expect(readAtCall(next!, 'sourceLinkConsumer')).toEqual(firstConsumer);
    expect(readAfterCall(next!, 'sourceLinkConsumer')).toBeUndefined();
    expect(readAfterCall(next!, 'llmLatestContent')).toBe('Finished.');
  } finally {
    await agent.shutdown();
  }
});

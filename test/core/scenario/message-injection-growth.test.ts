import type { CommitBundle } from 'foottrace';
import { expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/observe.js';

const shelf = defineTool({
  name: 'read_shelf',
  description: 'Read the number of objects on a synthetic shelf.',
  inputSchema: {
    type: 'object',
    properties: { shelf: { type: 'integer' } },
    required: ['shelf'],
  },
  execute: ({ shelf }: { shelf: number }) => [{ shelf, count: 4 }],
});

function fieldCount(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  return Object.values(value).reduce<number>((total, child) => total + 1 + fieldCount(child), 0);
}

async function recordInjections(calls: number) {
  const fixture = mock({
    chunkDelayMs: 0,
    replies: [
      ...Array.from({ length: calls - 1 }, (_, index) => ({
        toolCalls: [{ id: `shelf-${index}`, name: shelf.schema.name, args: { shelf: index } }],
      })),
      { content: 'Each shelf has four objects.' },
    ],
  });
  let observedCalls = 0;
  const agent = Agent.create({
    provider: {
      name: fixture.name,
      complete(request, hooks) {
        observedCalls++;
        return fixture.complete(request, hooks);
      },
    },
    model: 'mock',
    maxIterations: calls + 1,
  })
    .tool(shelf)
    .build();
  const recorder = recordRun(agent);
  try {
    expect(await agent.run({ message: 'How many objects are on each shelf?' })).toBe(
      'Each shelf has four objects.',
    );
    expect(observedCalls).toBe(calls);
    const recording = recorder.toRecording();
    expect(
      recording.events.filter(
        (event) =>
          event.type === 'agentfootprint.stream.tool_end' &&
          event.payload.entered &&
          !event.payload.error,
      ),
    ).toHaveLength(calls - 1);

    const snapshot = recording.snapshot as {
      readonly commitValues: string;
      readonly commitLog: readonly CommitBundle[];
    };
    expect(snapshot.commitValues).toBe('delta');
    const writes = snapshot.commitLog.flatMap((bundle) =>
      bundle.trace
        .filter(({ path }) => path === 'messagesInjections')
        .map((entry) => ({
          verb: entry.verb,
          fields: fieldCount({ operand: bundle.overwrite[entry.path] }) + 1 + fieldCount(entry),
        })),
    );
    return {
      verbs: writes.map(({ verb }) => verb),
      fields: writes.reduce((sum, write) => sum + write.fields, 0),
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

it('records growing message injections as a linear series of delta appends', async () => {
  const short = await recordInjections(40);
  const long = await recordInjections(80);

  expect(short.fields).toBeGreaterThan(0);
  expect(long.fields).toBeLessThanOrEqual(2.2 * short.fields);
  expect(short.verbs).toEqual(['set', ...Array.from({ length: 40 }, () => 'append')]);
  expect(long.verbs).toEqual(['set', ...Array.from({ length: 80 }, () => 'append')]);
}, 60_000);

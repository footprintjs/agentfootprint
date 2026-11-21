import { Buffer } from 'node:buffer';
import type { CommitBundle } from 'foottrace';
import { expect, it } from 'vitest';
import { Agent, defineTool, epochLocations } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { recordRun } from '../../../../src/observe.js';

const servedKey = 'sourceLinkServedRows';
const sample = defineTool({
  name: 'sample',
  description: 'Read the sample label.',
  inputSchema: { type: 'object' },
  execute: () => 'blue',
});

/** Measure the serialized contribution of this key's verb and operands only. */
function servedRowBytes(bundle: CommitBundle): number {
  const overwrite = { ...bundle.overwrite };
  const updates = { ...bundle.updates };
  delete overwrite[servedKey];
  delete updates[servedKey];
  const withoutRows = {
    ...bundle,
    overwrite,
    updates,
    trace: bundle.trace.filter(({ path }) => path !== servedKey),
  };
  return Buffer.byteLength(JSON.stringify(bundle)) - Buffer.byteLength(JSON.stringify(withoutRows));
}

it.each([25, 100])(
  'records linear served-row deltas across %i model calls',
  async (modelCalls) => {
    const fixture = mock({
      replies: [
        ...Array.from({ length: modelCalls - 1 }, (_, index) => ({
          toolCalls: [{ id: `sample-${index}`, name: 'sample', args: {} }],
        })),
        { content: 'Done.' },
      ],
    });
    let calls = 0;
    const agent = Agent.create({
      provider: {
        name: fixture.name,
        complete(request, hooks) {
          calls++;
          return fixture.complete(request, hooks);
        },
      },
      model: 'mock',
      maxIterations: modelCalls + 1,
      reactMode: 'classic',
    })
      .tool(sample)
      .build();
    const recorder = recordRun(agent);
    try {
      expect(await agent.run('Read the sample labels.')).toBe('Done.');
      expect(calls).toBe(modelCalls);
      const epochs = epochLocations(recorder.toRecording().snapshot);
      expect(epochs).toHaveLength(modelCalls);
      const logs = new Set(epochs.flatMap(({ runLog, log }) => [runLog, log]));
      const writes = [...logs].flatMap((log) =>
        log.flatMap((bundle) =>
          bundle.trace
            .filter(({ path }) => path === servedKey)
            .map(({ verb }) => ({ bundle, verb })),
        ),
      );
      const writtenBundles = new Set(writes.map(({ bundle }) => bundle));
      const bytes = [...writtenBundles].reduce(
        (total, bundle) => total + servedRowBytes(bundle),
        0,
      );
      const verbCounts: Record<string, number> = {};
      for (const { verb } of writes) verbCounts[verb] = (verbCounts[verb] ?? 0) + 1;
      console.log('served row commit bytes', JSON.stringify({ modelCalls, verbCounts, bytes }));

      expect(writes).toHaveLength(modelCalls);
      expect(writes.map(({ bundle }) => bundle)).toEqual(
        epochs.map(({ log, callIdx }) => log[callIdx]),
      );
      expect(writes.map(({ verb }) => verb)).toEqual([
        'set',
        ...Array.from({ length: modelCalls - 1 }, () => 'append'),
      ]);
      for (const { bundle } of writes) {
        // A folded value would hide an accidental full-list rewrite. Both
        // set and append use overwrite for their raw operand.
        expect(bundle.overwrite[servedKey]).toMatchObject([
          { kind: 'served', consumer: bundle.runtimeStageId },
        ]);
        expect(bundle.updates).not.toHaveProperty(servedKey);
      }
      expect(bytes).toBeGreaterThan(0);
    } finally {
      recorder.stop();
      await agent.shutdown();
    }
  },
  30_000,
);

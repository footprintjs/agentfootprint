import { FlowChartExecutor, flowChart, type FlowSubflowEvent } from 'footprintjs';
import { expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import {
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
  mockEmbedder,
} from '../../../src/memory/index.js';
import type { SnapshotEntry } from '../../../src/memory/causal/types.js';
import type { LLMProvider } from '../../../src/provider-contract/types.js';

it.each(['dynamic', 'dynamic-grouped'] as const)(
  'same-leg sibling mounts keep exact writer evidence in %s charts',
  async (reactMode) => {
    const store = new InMemoryStore();
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const provider: LLMProvider = {
      name: 'scripted',
      async complete(request) {
        const result = request.messages.filter((message) => message.role === 'tool').at(-1);
        if (result !== undefined)
          return {
            content: result.content,
            toolCalls: [],
            usage: { input: 17, output: 5 },
          };
        if (++entered === 2) release();
        await both;
        return {
          content: '',
          toolCalls: [{ id: 'same-call', name: 'private_record', args: {} }],
          usage: { input: 11, output: 3 },
        };
      },
    };
    const shared = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 3,
      reactMode,
      observerDelivery: 'deferred',
    })
      .toolProvider({
        id: 'records',
        list: (context) => [
          defineTool({
            name: 'private_record',
            description: 'Return the caller record.',
            inputSchema: { type: 'object', properties: {} },
            execute: () => 'PRIVATE-' + context.identity?.conversationId,
          }),
        ],
      })
      .memory(
        defineMemory({
          id: 'causal',
          type: MEMORY_TYPES.CAUSAL,
          strategy: {
            kind: MEMORY_STRATEGIES.TOP_K,
            topK: 1,
            threshold: 0,
            embedder: mockEmbedder(),
          },
          store,
          projection: SNAPSHOT_PROJECTIONS.DECISIONS,
        }),
      )
      .build();
    const chart = flowChart('parent', () => undefined, 'parent')
      .addSelectorFunction('both', () => ['a', 'b'], 'both', undefined, { failFast: true })
      .addSubFlowChartBranch('a', shared.getSpec(), 'a', {
        inputMapper: () => ({ message: 'a', identity: { conversationId: 'a' } }),
      })
      .addSubFlowChartBranch('b', shared.getSpec(), 'b', {
        inputMapper: () => ({ message: 'b', identity: { conversationId: 'b' } }),
      })
      .end()
      .build();
    const entries: FlowSubflowEvent[] = [];
    const executor = new FlowChartExecutor(chart);
    executor.attachCombinedRecorder({
      id: 'writer-coordinates',
      onSubflowEntry(event) {
        if (event.mappedInput?.runEvidence !== undefined) entries.push(event);
      },
    });
    try {
      await executor.run();
    } finally {
      release();
    }
    expect(entered).toBe(2);
    expect(entries).toHaveLength(2);
    const runIds: string[] = [],
      sourceIds: string[] = [];
    for (const who of ['a', 'b']) {
      const saved = await store.list<SnapshotEntry>({ conversationId: who });
      const snapshot = saved.entries.map((row) => row.value).find((value) => 'query' in value);
      expect(snapshot).toBeDefined();
      expect(snapshot?.toolCalls?.map((call) => call.resultPreview)).toEqual(['PRIVATE-' + who]);
      expect(snapshot?.tokenUsage).toEqual({ input: 28, output: 8 });
      expect(snapshot?.decisions?.length).toBeGreaterThan(0);
      expect(snapshot).toMatchObject({
        availability: 'observed',
        coverage: {
          entry: { kind: 'mounted', nativeEntry: 'unavailable' },
          priorLegs: 'not-carried',
        },
      });
      const observation = snapshot;
      if (observation === undefined || observation.availability === 'unavailable')
        throw new Error('Expected actual writer observation');
      const coverage = observation.coverage;
      runIds.push(coverage.runId);
      sourceIds.push(coverage.source.runtimeStageId);
      const actual = entries.find(
        (event) =>
          (event.mappedInput?.identity as { conversationId?: string })?.conversationId === who,
      );
      expect(actual).toBeDefined();
      expect(coverage.source).toMatchObject({
        kind: 'stage',
        runId: actual?.traversalContext?.runId,
        runtimeStageId: actual?.traversalContext?.runtimeStageId,
      });
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE-' + (who === 'a' ? 'b' : 'a'));
    }
    expect(new Set(runIds).size).toBe(1);
    expect(new Set(sourceIds).size).toBe(2);
  },
);

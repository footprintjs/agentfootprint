import { describe, it, expect } from 'vitest';
import { FlowChart } from '../../src';
import type { RunnerLike } from '../../src';

describe('FlowChart invariants', () => {
  it('agent count in result matches agents added', async () => {
    const counts = [1, 2, 3, 5];

    for (const n of counts) {
      let builder = FlowChart.create();
      for (let i = 0; i < n; i++) {
        builder = builder.agent(`a${i}`, `Agent${i}`, {
          run: async () => ({ content: `out-${i}` }),
        });
      }
      const result = await builder.build().run('test');
      expect(result.agents).toHaveLength(n);
    }
  });

  it('last agent output is always the pipeline content', async () => {
    const runners: RunnerLike[] = [
      { run: async () => ({ content: 'A' }) },
      { run: async () => ({ content: 'B' }) },
      { run: async () => ({ content: 'FINAL' }) },
    ];

    const pipeline = FlowChart.create()
      .agent('a1', 'A1', runners[0])
      .agent('a2', 'A2', runners[1])
      .agent('a3', 'A3', runners[2])
      .build();

    const result = await pipeline.run('input');
    expect(result.content).toBe('FINAL');
  });

  it('agent results preserve insertion order', async () => {
    const ids = ['alpha', 'beta', 'gamma', 'delta'];
    let builder = FlowChart.create();
    for (const id of ids) {
      builder = builder.agent(id, id, { run: async () => ({ content: id }) });
    }

    const result = await builder.build().run('test');
    expect(result.agents.map((a) => a.id)).toEqual(ids);
  });

  it('each agent receives previous agent output (chain property)', async () => {
    const received: string[] = [];
    const makeRunner = (label: string): RunnerLike => ({
      run: async (msg) => {
        received.push(msg);
        return { content: `${label}(${msg})` };
      },
    });

    const pipeline = FlowChart.create()
      .agent('a', 'A', makeRunner('A'))
      .agent('b', 'B', makeRunner('B'))
      .agent('c', 'C', makeRunner('C'))
      .build();

    await pipeline.run('start');

    expect(received[0]).toBe('start');
    expect(received[1]).toBe('A(start)');
    expect(received[2]).toBe('B(A(start))');
  });

  it('pipeline result latency >= sum of agent latencies', async () => {
    const pipeline = FlowChart.create()
      .agent('a1', 'A1', { run: async () => ({ content: 'x' }) })
      .agent('a2', 'A2', { run: async () => ({ content: 'y' }) })
      .build();

    const result = await pipeline.run('test');
    const sumLatency = result.agents.reduce((s, a) => s + a.latencyMs, 0);
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(sumLatency);
  });
});

import { describe, it, expect } from 'vitest';
import { FlowChart } from '../../src/test-barrel';
import type { RunnerLike } from '../../src/test-barrel';

describe('FlowChart edge cases', () => {
  it('single agent pipeline works', async () => {
    const result = await FlowChart.create()
      .agent('solo', 'Solo', { run: async (m) => ({ content: `solo: ${m}` }) })
      .build()
      .run('hello');

    expect(result.content).toBe('solo: hello');
    expect(result.agents).toHaveLength(1);
  });

  it('handles empty string input', async () => {
    const result = await FlowChart.create()
      .agent('a1', 'A1', { run: async (m) => ({ content: m || 'empty' }) })
      .build()
      .run('');

    expect(result.content).toBe('empty');
  });

  it('handles very long input', async () => {
    const longInput = 'x'.repeat(100_000);
    const result = await FlowChart.create()
      .agent('a1', 'A1', { run: async (m) => ({ content: `len=${m.length}` }) })
      .build()
      .run(longInput);

    expect(result.content).toBe('len=100000');
  });

  it('handles runner that returns empty content', async () => {
    const result = await FlowChart.create()
      .agent('a1', 'A1', { run: async () => ({ content: '' }) })
      .agent('a2', 'A2', { run: async (m) => ({ content: m || 'fallback' }) })
      .build()
      .run('test');

    expect(result.agents[0].content).toBe('');
  });

  it('handles unicode content', async () => {
    const result = await FlowChart.create()
      .agent('a1', 'A1', { run: async () => ({ content: '日本語テスト 🎉' }) })
      .build()
      .run('test');

    expect(result.content).toBe('日本語テスト 🎉');
  });

  it('propagates runner errors', async () => {
    const failingRunner: RunnerLike = {
      run: async () => {
        throw new Error('Runner exploded');
      },
    };

    const pipeline = FlowChart.create().agent('a1', 'A1', failingRunner).build();

    await expect(pipeline.run('test')).rejects.toThrow('Runner exploded');
  });

  it('abort signal option is accepted without error', async () => {
    const controller = new AbortController();

    const runner: RunnerLike = {
      run: async () => ({ content: 'ok' }),
    };

    // Should not throw when signal is provided
    const result = await FlowChart.create()
      .agent('a1', 'A1', runner)
      .build()
      .run('test', { signal: controller.signal });

    expect(result.content).toBe('ok');
  });

  it('handles runner with no getNarrative', async () => {
    const runner: RunnerLike = {
      run: async () => ({ content: 'ok' }),
      // no getNarrative
    };

    const result = await FlowChart.create().agent('a1', 'A1', runner).build().run('test');

    expect(result.agents[0].narrative).toBeUndefined();
  });
});

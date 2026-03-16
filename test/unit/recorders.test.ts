import { describe, it, expect } from 'vitest';
import { LLMRecorder, ScopeCostRecorder as CostRecorder } from '../../src';

describe('LLMRecorder', () => {
  it('tracks LLM call stats from adapter writes', () => {
    const recorder = new LLMRecorder();
    recorder.onStageStart();

    recorder.onWrite({
      key: 'adapterResult',
      value: {
        type: 'final',
        content: 'Hi',
        model: 'gpt-4o',
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    });

    recorder.onStageEnd();

    const stats = recorder.getStats();
    expect(stats.totalCalls).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(50);
    expect(stats.entries[0].model).toBe('gpt-4o');
  });

  it('ignores non-adapter writes', () => {
    const recorder = new LLMRecorder();
    recorder.onWrite({ key: 'messages', value: [] });
    expect(recorder.getTotalCalls()).toBe(0);
  });

  it('tracks multiple calls', () => {
    const recorder = new LLMRecorder();

    recorder.onWrite({
      key: 'adapterResult',
      value: { model: 'a', usage: { inputTokens: 10, outputTokens: 5 } },
    });

    recorder.onWrite({
      key: 'adapterResult',
      value: { model: 'b', usage: { inputTokens: 20, outputTokens: 10 } },
    });

    expect(recorder.getTotalCalls()).toBe(2);
    expect(recorder.getTotalInputTokens()).toBe(30);
    expect(recorder.getTotalOutputTokens()).toBe(15);
  });

  it('clear resets all state', () => {
    const recorder = new LLMRecorder();
    recorder.onWrite({
      key: 'adapterResult',
      value: { model: 'x', usage: { inputTokens: 1, outputTokens: 1 } },
    });
    recorder.clear();
    expect(recorder.getTotalCalls()).toBe(0);
  });
});

describe('CostRecorder', () => {
  it('calculates cost from known model pricing', () => {
    const recorder = new CostRecorder();

    recorder.onWrite({
      key: 'adapterResult',
      value: {
        model: 'gpt-4o',
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      },
    });

    // gpt-4o: $2.5/1M input, $10/1M output
    expect(recorder.getTotalCost()).toBeCloseTo(12.5, 2);
  });

  it('returns zero cost for unknown models', () => {
    const recorder = new CostRecorder();

    recorder.onWrite({
      key: 'adapterResult',
      value: {
        model: 'unknown-model',
        usage: { inputTokens: 1000, outputTokens: 1000 },
      },
    });

    expect(recorder.getTotalCost()).toBe(0);
  });

  it('accepts custom pricing table', () => {
    const recorder = new CostRecorder({
      pricingTable: {
        'custom-model': { input: 1, output: 2 },
      },
    });

    recorder.onWrite({
      key: 'adapterResult',
      value: {
        model: 'custom-model',
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      },
    });

    expect(recorder.getTotalCost()).toBeCloseTo(3, 2);
  });

  it('clear resets entries', () => {
    const recorder = new CostRecorder();
    recorder.onWrite({
      key: 'adapterResult',
      value: { model: 'gpt-4o', usage: { inputTokens: 100, outputTokens: 100 } },
    });
    recorder.clear();
    expect(recorder.getEntries()).toHaveLength(0);
  });
});

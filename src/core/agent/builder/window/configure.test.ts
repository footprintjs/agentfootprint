import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../../../../provider-contract/types.js';
import type { WindowStrategy } from '../../window/strategy.js';
import { setCompaction, setWindowStrategy, type WindowConfigurationPort } from './configure.js';
import { assertDistinctSummarizer, assertWindowNotSet } from './guards.js';

const provider: LLMProvider = {
  name: 'source',
  complete: async () => {
    throw new Error('must not call');
  },
};
const strategy: WindowStrategy = { name: 'unchanged', plan: async () => undefined };

describe('builder window declaration', () => {
  it('keeps dynamic receiver calls and specific act attribution in their original order', () => {
    const order: string[] = [];
    const receiver: WindowConfigurationPort = {
      windowStrategyDoor: '.act({ window })',
      assertNoWindowStrategy(door) {
        expect(this).toBe(receiver);
        order.push(door);
      },
      assertSummarizerIsNotTheAgentItself() {
        expect(this).toBe(receiver);
        order.push('summarizer');
      },
      noteWindowStrategyDoor(door) {
        expect(this).toBe(receiver);
        expect(this.windowStrategyValue).toBe(strategy);
        order.push(door);
        this.windowStrategyDoor = door;
      },
    };
    expect(setWindowStrategy(receiver, strategy, receiver)).toBe(receiver);
    expect(order).toEqual(['window', 'summarizer', '.act({ window })']);
  });

  it('refuses an existing window before reading the proposed strategy', () => {
    const failure = new Error('window already exists');
    const receiver: WindowConfigurationPort = {
      assertNoWindowStrategy() {
        throw failure;
      },
      assertSummarizerIsNotTheAgentItself() {
        throw new Error('must not reach');
      },
      noteWindowStrategyDoor() {
        throw new Error('must not reach');
      },
    };
    const unreadable = new Proxy(strategy, {
      get: () => {
        throw new Error('must not inspect');
      },
    });
    expect(() => setWindowStrategy(receiver, unreadable, receiver)).toThrow(failure);
  });

  it('builds a compaction declaration without making a provider call', () => {
    const receiver: WindowConfigurationPort = {
      assertNoWindowStrategy: () => undefined,
      assertSummarizerIsNotTheAgentItself(billing, label) {
        expect(billing).toEqual({ provider, model: 'summary' });
        expect(label).toBe('AgentBuilder.compaction');
      },
      noteWindowStrategyDoor(door) {
        this.windowStrategyDoor = door;
      },
    };
    expect(
      setCompaction(
        receiver,
        { thresholdTokens: 10, summarizer: provider, model: 'summary' },
        receiver,
      ),
    ).toBe(receiver);
    expect(receiver.windowStrategyValue?.name).toBe('summarize-oldest');
    expect(receiver.windowStrategyDoor).toBe('.compaction()');
  });

  it('compares provider instance and model, and names the door that set a conflict', () => {
    const receiver = { opts: { provider, model: 'main' } };
    expect(() => assertDistinctSummarizer(receiver, undefined, 'test')).not.toThrow();
    expect(() =>
      assertDistinctSummarizer(receiver, { provider, model: 'other' }, 'test'),
    ).not.toThrow();
    expect(() => assertDistinctSummarizer(receiver, { provider, model: 'main' }, 'test')).toThrow(
      "the summarizer is the agent's own provider INSTANCE",
    );
    for (const door of ['window', 'compaction', 'act'] as const) {
      expect(() =>
        assertWindowNotSet(
          { windowStrategyValue: strategy, windowStrategyDoor: '.act({ window })' },
          door,
        ),
      ).toThrow('set by .act({ window })');
    }
  });
});

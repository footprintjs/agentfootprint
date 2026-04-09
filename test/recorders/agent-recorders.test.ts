import { describe, it, expect } from 'vitest';
import { TokenRecorder } from '../../src/recorders/TokenRecorder';
import { CostRecorder } from '../../src/recorders';
import { ToolUsageRecorder } from '../../src/recorders/ToolUsageRecorder';
import { TurnRecorder } from '../../src/recorders/TurnRecorder';
import type { LLMCallEvent, ToolCallEvent } from '../../../src/core';

// ── TokenRecorder ───────────────────────────────────────────

describe('TokenRecorder', () => {
  it('tracks token usage from LLM calls', () => {
    const recorder = new TokenRecorder();
    recorder.onLLMCall({
      model: 'claude-sonnet',
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 250,
      turnNumber: 0,
      loopIteration: 0,
      runtimeStageId: 'call-llm#0',
    });

    const stats = recorder.getStats();
    expect(stats.totalCalls).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(50);
    expect(stats.averageLatencyMs).toBe(250);
  });

  it('accumulates across multiple calls', () => {
    const recorder = new TokenRecorder();
    recorder.onLLMCall({
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 200,
      turnNumber: 0,
      loopIteration: 0,
      runtimeStageId: 'call-llm#0',
    });
    recorder.onLLMCall({
      usage: { inputTokens: 200, outputTokens: 100 },
      latencyMs: 300,
      turnNumber: 0,
      loopIteration: 1,
      runtimeStageId: 'call-llm#1',
    });

    const stats = recorder.getStats();
    expect(stats.totalCalls).toBe(2);
    expect(stats.totalInputTokens).toBe(300);
    expect(stats.totalOutputTokens).toBe(150);
    expect(stats.averageLatencyMs).toBe(250);
  });

  it('getTotalTokens returns sum of input + output', () => {
    const recorder = new TokenRecorder();
    recorder.onLLMCall({
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 0,
      turnNumber: 0,
      loopIteration: 0,
      runtimeStageId: 'call-llm#0',
    });
    expect(recorder.getTotalTokens()).toBe(150);
  });

  it('handles missing usage gracefully', () => {
    const recorder = new TokenRecorder();
    recorder.onLLMCall({ latencyMs: 100, turnNumber: 0, loopIteration: 0 });
    expect(recorder.getStats().totalInputTokens).toBe(0);
    expect(recorder.getStats().totalOutputTokens).toBe(0);
  });

  it('clear resets state', () => {
    const recorder = new TokenRecorder();
    recorder.onLLMCall({
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 0,
      turnNumber: 0,
      loopIteration: 0,
      runtimeStageId: 'call-llm#0',
    });
    recorder.clear();
    expect(recorder.getStats().totalCalls).toBe(0);
  });
});

// ── CostRecorder ────────────────────────────────────────────

describe('CostRecorder (v2)', () => {
  it('calculates cost from pricing table', () => {
    const recorder = new CostRecorder({
      pricingTable: {
        'claude-sonnet': { input: 3, output: 15 },
      },
    });
    recorder.onLLMCall({
      model: 'claude-sonnet',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      latencyMs: 0,
      turnNumber: 0,
      loopIteration: 0,
      runtimeStageId: 'call-llm#0',
    });

    expect(recorder.getTotalCost()).toBe(18); // $3 input + $15 output
  });

  it('returns $0 for unknown models', () => {
    const recorder = new CostRecorder();
    recorder.onLLMCall({
      model: 'unknown-model',
      usage: { inputTokens: 1000, outputTokens: 500 },
      latencyMs: 0,
      turnNumber: 0,
      loopIteration: 0,
      runtimeStageId: 'call-llm#0',
    });
    expect(recorder.getTotalCost()).toBe(0);
  });

  it('accumulates cost across calls', () => {
    const recorder = new CostRecorder({
      pricingTable: { 'test-model': { input: 1, output: 2 } },
    });
    recorder.onLLMCall({
      model: 'test-model',
      usage: { inputTokens: 500_000, outputTokens: 500_000 },
      latencyMs: 0,
      turnNumber: 0,
      loopIteration: 0,
      runtimeStageId: 'call-llm#0',
    });
    recorder.onLLMCall({
      model: 'test-model',
      usage: { inputTokens: 500_000, outputTokens: 500_000 },
      latencyMs: 0,
      turnNumber: 0,
      loopIteration: 1,
      runtimeStageId: 'call-llm#1',
    });

    // 2 calls × ($0.50 input + $1.00 output) = $3.00
    expect(recorder.getTotalCost()).toBe(3);
  });

  it('getEntries returns defensive copy', () => {
    const recorder = new CostRecorder();
    recorder.onLLMCall({ model: 'x', latencyMs: 0, turnNumber: 0, loopIteration: 0 });
    const entries = recorder.getEntries();
    expect(entries).toHaveLength(1);
    expect(recorder.getEntries()).not.toBe(entries); // different array reference
  });

  it('clear resets state', () => {
    const recorder = new CostRecorder({ pricingTable: { m: { input: 1, output: 1 } } });
    recorder.onLLMCall({
      model: 'm',
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
      latencyMs: 0,
      turnNumber: 0,
      loopIteration: 0,
      runtimeStageId: 'call-llm#0',
    });
    recorder.clear();
    expect(recorder.getTotalCost()).toBe(0);
  });
});

// ── ToolUsageRecorder ───────────────────────────────────────

describe('ToolUsageRecorder', () => {
  let toolIdx = 0;
  const makeToolEvent = (name: string, latencyMs: number, error = false): ToolCallEvent => ({
    toolName: name,
    args: {},
    result: { content: error ? 'error' : 'ok', error: error || undefined },
    latencyMs,
    runtimeStageId: `execute-tools#${toolIdx++}`,
  });

  it('tracks tool call counts by name', () => {
    const recorder = new ToolUsageRecorder();
    recorder.onToolCall(makeToolEvent('search', 100));
    recorder.onToolCall(makeToolEvent('search', 200));
    recorder.onToolCall(makeToolEvent('calc', 50));

    const stats = recorder.getStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.byTool['search'].calls).toBe(2);
    expect(stats.byTool['calc'].calls).toBe(1);
  });

  it('tracks errors per tool', () => {
    const recorder = new ToolUsageRecorder();
    recorder.onToolCall(makeToolEvent('search', 100));
    recorder.onToolCall(makeToolEvent('search', 200, true));

    const stats = recorder.getStats();
    expect(stats.totalErrors).toBe(1);
    expect(stats.byTool['search'].errors).toBe(1);
  });

  it('calculates average latency per tool', () => {
    const recorder = new ToolUsageRecorder();
    recorder.onToolCall(makeToolEvent('search', 100));
    recorder.onToolCall(makeToolEvent('search', 300));

    expect(recorder.getStats().byTool['search'].averageLatencyMs).toBe(200);
  });

  it('getToolNames returns unique tool names', () => {
    const recorder = new ToolUsageRecorder();
    recorder.onToolCall(makeToolEvent('a', 0));
    recorder.onToolCall(makeToolEvent('b', 0));
    recorder.onToolCall(makeToolEvent('a', 0));
    expect(recorder.getToolNames()).toEqual(['a', 'b']);
  });

  it('clear resets state', () => {
    const recorder = new ToolUsageRecorder();
    recorder.onToolCall(makeToolEvent('x', 0));
    recorder.clear();
    expect(recorder.getStats().totalCalls).toBe(0);
  });
});

// ── TurnRecorder ────────────────────────────────────────────

describe('TurnRecorder', () => {
  it('tracks turn lifecycle start → complete', () => {
    const recorder = new TurnRecorder();
    recorder.onTurnStart({ turnNumber: 0, message: 'hello' });
    recorder.onTurnComplete({
      turnNumber: 0,
      content: 'hi there',
      messageCount: 2,
      totalLoopIterations: 0,
    });

    const turns = recorder.getTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].status).toBe('completed');
    expect(turns[0].message).toBe('hello');
    expect(turns[0].content).toBe('hi there');
    expect(turns[0].messageCount).toBe(2);
  });

  it('tracks turn lifecycle start → error', () => {
    const recorder = new TurnRecorder();
    recorder.onTurnStart({ turnNumber: 0, message: 'hello' });
    recorder.onError({ phase: 'llm', error: new Error('timeout'), turnNumber: 0 });

    const turns = recorder.getTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].status).toBe('error');
    expect(turns[0].error).toBeInstanceOf(Error);
  });

  it('tracks multiple turns', () => {
    const recorder = new TurnRecorder();
    recorder.onTurnStart({ turnNumber: 0, message: 'first' });
    recorder.onTurnComplete({
      turnNumber: 0,
      content: 'r1',
      messageCount: 2,
      totalLoopIterations: 0,
    });
    recorder.onTurnStart({ turnNumber: 1, message: 'second' });
    recorder.onTurnComplete({
      turnNumber: 1,
      content: 'r2',
      messageCount: 4,
      totalLoopIterations: 1,
    });

    expect(recorder.getCompletedCount()).toBe(2);
    expect(recorder.getErrorCount()).toBe(0);
  });

  it('getCompletedCount and getErrorCount are accurate', () => {
    const recorder = new TurnRecorder();
    recorder.onTurnStart({ turnNumber: 0, message: 'ok' });
    recorder.onTurnComplete({
      turnNumber: 0,
      content: 'ok',
      messageCount: 2,
      totalLoopIterations: 0,
    });
    recorder.onTurnStart({ turnNumber: 1, message: 'fail' });
    recorder.onError({ phase: 'tool', error: 'boom', turnNumber: 1 });

    expect(recorder.getCompletedCount()).toBe(1);
    expect(recorder.getErrorCount()).toBe(1);
  });

  it('records orphaned errors when onTurnStart was never called', () => {
    const recorder = new TurnRecorder();
    // Error fires before turn officially starts (e.g. prompt resolution failure)
    recorder.onError({ phase: 'prompt', error: new Error('prompt failed'), turnNumber: 0 });

    const turns = recorder.getTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].status).toBe('error');
    expect(turns[0].turnNumber).toBe(0);
    expect(turns[0].error).toBeInstanceOf(Error);
    expect(recorder.getErrorCount()).toBe(1);
  });

  it('clear resets state', () => {
    const recorder = new TurnRecorder();
    recorder.onTurnStart({ turnNumber: 0, message: 'hi' });
    recorder.onTurnComplete({
      turnNumber: 0,
      content: 'hey',
      messageCount: 2,
      totalLoopIterations: 0,
    });
    recorder.clear();
    expect(recorder.getTurns()).toEqual([]);
    expect(recorder.getCompletedCount()).toBe(0);
  });
});

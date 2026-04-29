/**
 * Scenario tests — LLMCall end-to-end via MockProvider.
 *
 * Exercises the full pipeline:
 *   Builder → FlowChart → FlowChartExecutor → ContextRecorder +
 *   StreamRecorder → v2 EventDispatcher → consumer listeners.
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

describe('LLMCall — end-to-end', () => {
  it('runs to completion and returns the mock response', async () => {
    const provider = new MockProvider({ reply: 'hello back' });
    const llm = LLMCall.create({ provider, model: 'mock-model' }).system('you are helpful').build();

    const out = await llm.run({ message: 'hi' });
    expect(out).toBe('hello back');
  });

  it('emits stream.llm_start and stream.llm_end during the run', async () => {
    const provider = new MockProvider({ reply: 'ok' });
    const llm = LLMCall.create({ provider, model: 'mock-model' }).system('sys').build();

    const starts = vi.fn();
    const ends = vi.fn();
    llm.on('agentfootprint.stream.llm_start', starts);
    llm.on('agentfootprint.stream.llm_end', ends);

    await llm.run({ message: 'hi' });
    expect(starts).toHaveBeenCalledTimes(1);
    expect(ends).toHaveBeenCalledTimes(1);
    expect(starts.mock.calls[0][0].payload.model).toBe('mock-model');
    expect(ends.mock.calls[0][0].payload.content).toBe('ok');
  });

  it('emits context.injected for system prompt and user message', async () => {
    const provider = new MockProvider({ reply: 'ok' });
    const llm = LLMCall.create({ provider, model: 'mock-model' }).system('You are a tutor').build();

    const injections: string[] = [];
    llm.on('agentfootprint.context.injected', (e) => {
      injections.push(`${e.payload.slot}:${e.payload.source}`);
    });

    await llm.run({ message: 'teach me' });
    // `source: 'base'` — the static system prompt configured at
    // build time is BASELINE, not context engineering. Renamed
    // 2026-04-24 from 'instructions' (misleading) to 'base'.
    expect(injections).toContain('system-prompt:base');
    expect(injections).toContain('messages:user');
  });

  it('emits context.slot_composed once per slot (3 slots)', async () => {
    const provider = new MockProvider({ reply: 'ok' });
    const llm = LLMCall.create({ provider, model: 'mock-model' }).build();

    const composed: string[] = [];
    llm.on('agentfootprint.context.slot_composed', (e) => {
      composed.push(e.payload.slot);
    });
    await llm.run({ message: 'hi' });
    expect(composed.sort()).toEqual(['messages', 'system-prompt', 'tools']);
  });

  it('is reusable: multiple run() calls work on the same instance', async () => {
    const provider = new MockProvider();
    const llm = LLMCall.create({ provider, model: 'mock-model' }).build();

    const r1 = await llm.run({ message: 'first' });
    const r2 = await llm.run({ message: 'second' });
    expect(r1).toBe('echo: first');
    expect(r2).toBe('echo: second');
  });

  it('is composable: toFlowChart() returns a FlowChart for subflow mounting', () => {
    const provider = new MockProvider();
    const llm = LLMCall.create({ provider, model: 'mock-model' }).build();
    const chart = llm.toFlowChart();
    expect(chart).toBeDefined();
    // ComposableRunner contract — can be passed to addSubFlowChart.
    expect(typeof chart).toBe('object');
  });

  it('.on subscriptions fire independently per listener', async () => {
    const provider = new MockProvider({ reply: 'ok' });
    const llm = LLMCall.create({ provider, model: 'mock-model' }).build();

    const a = vi.fn();
    const b = vi.fn();
    llm.on('agentfootprint.stream.llm_end', a);
    llm.on('agentfootprint.stream.llm_end', b);

    await llm.run({ message: 'hi' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('.off removes a listener before the next run', async () => {
    const provider = new MockProvider({ reply: 'ok' });
    const llm = LLMCall.create({ provider, model: 'mock-model' }).build();
    const fn = vi.fn();
    llm.on('agentfootprint.stream.llm_end', fn);
    await llm.run({ message: 'first' });
    llm.off('agentfootprint.stream.llm_end', fn);
    await llm.run({ message: 'second' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('meta.runId differs across runs (demultiplexable)', async () => {
    const provider = new MockProvider();
    const llm = LLMCall.create({ provider, model: 'mock-model' }).build();
    const runIds: string[] = [];
    llm.on('agentfootprint.stream.llm_start', (e) => {
      runIds.push(e.meta.runId);
    });
    await llm.run({ message: '1' });
    await llm.run({ message: '2' });
    expect(runIds).toHaveLength(2);
    expect(runIds[0]).not.toBe(runIds[1]);
  });
});

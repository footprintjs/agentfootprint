/**
 * ROI tests — resource stability across repeated runs.
 *
 * Scope: the same Runner instance used across many runs must not leak
 * listeners, accumulate stale per-run state, or grow heap in proportion
 * to run count. These tests catch subscription churn bugs and forgotten
 * cleanup in the per-run lifecycle.
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

describe('ROI — listener lifecycle across runs', () => {
  it('a single .on() subscription fires exactly once per run across N runs', async () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const handler = vi.fn();
    llm.on('agentfootprint.stream.llm_start', handler);

    const N = 50;
    for (let i = 0; i < N; i++) {
      await llm.run({ message: `r${i}` });
    }

    // Not N*2, not N+1 — exactly N. Proves no per-run duplicate subscription.
    expect(handler).toHaveBeenCalledTimes(N);
  });

  it('off() cleanly removes a listener; subsequent runs do not call it', async () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const handler = vi.fn();
    llm.on('agentfootprint.stream.llm_start', handler);
    await llm.run({ message: 'r1' });
    expect(handler).toHaveBeenCalledTimes(1);

    llm.off('agentfootprint.stream.llm_start', handler);
    await llm.run({ message: 'r2' });
    await llm.run({ message: 'r3' });

    expect(handler).toHaveBeenCalledTimes(1); // stayed at 1
  });

  it('once() fires exactly once across N runs', async () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const handler = vi.fn();
    llm.once('agentfootprint.stream.llm_start', handler);

    for (let i = 0; i < 10; i++) await llm.run({ message: `r${i}` });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('ROI — per-run state isolation', () => {
  it('Agent.run invoked sequentially does not leak history between runs', async () => {
    const agent = Agent.create({
      provider: new MockProvider({
        respond: (req) => {
          // Count user messages in the request — should always be 1 on a fresh run.
          const userCount = req.messages.filter((m) => m.role === 'user').length;
          return `sawUserCount=${userCount}`;
        },
      }),
      model: 'mock',
    })
      .system('')
      .build();

    for (let i = 0; i < 5; i++) {
      const out = await agent.run({ message: `hello ${i}` });
      // Each run must start with exactly one user message — no bleed from prior runs.
      expect(out).toBe('sawUserCount=1');
    }
  });

  it('Agent iteration counter resets between runs', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'done' }),
      model: 'mock',
    })
      .system('')
      .build();

    const iterationEvents: number[][] = [];
    for (let r = 0; r < 3; r++) {
      const iters: number[] = [];
      const off = agent.on('agentfootprint.agent.iteration_start', (e) =>
        iters.push(e.payload.iterIndex),
      );
      await agent.run({ message: `r${r}` });
      off();
      iterationEvents.push(iters);
    }

    // Every run must start its iteration index at 1 — not accumulate.
    for (const iters of iterationEvents) {
      expect(iters[0]).toBe(1);
    }
  });
});

describe('ROI — heap growth sanity (best-effort)', () => {
  it('100 sequential LLMCall runs do not grow heap by >10MB', async () => {
    if (typeof globalThis.gc !== 'function') {
      // Run anyway — test still validates that 100 runs complete cleanly.
      const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
        .system('')
        .build();
      for (let i = 0; i < 100; i++) await llm.run({ message: 'x' });
      expect(true).toBe(true);
      return;
    }

    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    globalThis.gc();
    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < 100; i++) await llm.run({ message: 'x' });

    globalThis.gc();
    const after = process.memoryUsage().heapUsed;
    const growthMb = (after - before) / (1024 * 1024);

    expect(growthMb).toBeLessThan(10);
  });
});

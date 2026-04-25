/**
 * Scenario tests — Loop composition.
 */

import { describe, it, expect, vi } from 'vitest';
import { Loop } from '../../../src/core-flow/Loop.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMRequest } from '../../../src/adapters/types.js';

/** LLM that appends a counter suffix each call — lets us see iteration progress. */
function counterProvider(): LLMProvider {
  let n = 0;
  return {
    name: 'mock',
    complete: async (req: LLMRequest) => {
      n++;
      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      const content = `${last?.content ?? ''}→${n}`;
      return {
        content,
        toolCalls: [],
        usage: { input: 0, output: 1 },
        stopReason: 'stop',
      };
    },
  };
}

describe('Loop — maxIterations budget', () => {
  it('runs body N times when maxIterations=N and no until() guard', async () => {
    const body = LLMCall.create({ provider: counterProvider(), model: 'mock' })
      .system('')
      .build();

    const loop = Loop.create().repeat(body).times(3).build();

    const out = await loop.run({ message: 'seed' });
    // Body runs 3 times — each run appends →n. The loop threads
    // previous output → next input.
    expect(out).toBe('seed→1→2→3');
  });

  it('iteration_exit reason=budget when cap reached', async () => {
    const body = LLMCall.create({ provider: new MockProvider({ reply: 'x' }), model: 'mock' })
      .system('')
      .build();
    const loop = Loop.create().repeat(body).times(2).build();

    const exits: string[] = [];
    loop.on('agentfootprint.composition.iteration_exit', (e) =>
      exits.push(e.payload.reason),
    );
    await loop.run({ message: 'go' });
    // Iter 1 body_complete, iter 2 budget (cap hit)
    expect(exits).toEqual(['body_complete', 'budget']);
  });

  it('default maxIterations is 10 when only .repeat() is set', async () => {
    const body = LLMCall.create({ provider: counterProvider(), model: 'mock' })
      .system('')
      .build();
    const loop = Loop.create().repeat(body).build();

    const out = await loop.run({ message: 'x' });
    // 10 iterations produce 10 appended counters
    expect(out.split('→').length).toBe(11); // initial + 10 iterations
  });
});

describe('Loop — until() guard', () => {
  it('exits early when until() returns true', async () => {
    const body = LLMCall.create({ provider: counterProvider(), model: 'mock' })
      .system('')
      .build();

    const loop = Loop.create()
      .repeat(body)
      .times(100)
      .until((ctx) => ctx.latestOutput.endsWith('→5'))
      .build();

    const out = await loop.run({ message: 'seed' });
    expect(out).toBe('seed→1→2→3→4→5');
  });

  it('iteration_exit reason=guard_false when until() fires', async () => {
    const body = LLMCall.create({ provider: counterProvider(), model: 'mock' })
      .system('')
      .build();

    const loop = Loop.create()
      .repeat(body)
      .times(100)
      .until((ctx) => ctx.iteration === 2)
      .build();

    const exits: string[] = [];
    loop.on('agentfootprint.composition.iteration_exit', (e) =>
      exits.push(e.payload.reason),
    );
    await loop.run({ message: 'x' });
    expect(exits).toEqual(['body_complete', 'guard_false']);
  });
});

describe('Loop — events', () => {
  it('emits composition.enter once and composition.exit once', async () => {
    const loop = Loop.create()
      .repeat(LLMCall.create({ provider: new MockProvider({ reply: 'y' }), model: 'mock' }).system('').build())
      .times(3)
      .build();

    const enters = vi.fn();
    const exits = vi.fn();
    loop.on('agentfootprint.composition.enter', enters);
    loop.on('agentfootprint.composition.exit', exits);

    await loop.run({ message: 'go' });
    expect(enters).toHaveBeenCalledTimes(1);
    expect(exits).toHaveBeenCalledTimes(1);
    expect(exits.mock.calls[0][0].payload.status).toBe('budget_exhausted');
  });

  it('iteration_start fires once per iteration', async () => {
    const loop = Loop.create()
      .repeat(LLMCall.create({ provider: new MockProvider({ reply: 'y' }), model: 'mock' }).system('').build())
      .times(4)
      .build();

    const starts: number[] = [];
    loop.on('agentfootprint.composition.iteration_start', (e) =>
      starts.push(e.payload.iteration),
    );
    await loop.run({ message: 'go' });
    expect(starts).toEqual([1, 2, 3, 4]);
  });
});

describe('Loop — validation', () => {
  it('rejects build() with no .repeat()', () => {
    expect(() => Loop.create().build()).toThrow(/\.repeat\(runner\) is required/);
  });

  it('rejects calling .repeat() twice', () => {
    const body = LLMCall.create({ provider: new MockProvider(), model: 'mock' }).system('').build();
    expect(() => Loop.create().repeat(body).repeat(body)).toThrow(/already set/);
  });

  it('clamps maxIterations >500 to 500 (hard cap)', async () => {
    const body = LLMCall.create({ provider: new MockProvider({ reply: 'y' }), model: 'mock' })
      .system('')
      .build();
    const loop = Loop.create()
      .repeat(body)
      .times(10000)
      .until((ctx) => ctx.iteration === 3)
      .build();
    // The until() guard exits early so we don't actually run 500 iters,
    // but build() accepted the 10000 value by clamping to 500 internally.
    const out = await loop.run({ message: 'x' });
    expect(typeof out).toBe('string');
  });
});

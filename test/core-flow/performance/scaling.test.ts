/**
 * Performance tests — composition scaling.
 *
 * These catch obvious quadratic regressions as child counts grow.
 * Budgets are generous to tolerate CI noise; they catch >10x regressions.
 */

import { describe, it, expect } from 'vitest';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('')
    .build();
}

describe('performance — Sequence scales linearly with step count', () => {
  it('10-step Sequence completes in under 1000ms', async () => {
    let b = Sequence.create();
    for (let i = 0; i < 10; i++) b = b.step(`s${i}`, llm(`R${i}`));
    const seq = b.build();

    const t0 = performance.now();
    await seq.run({ message: 'go' });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
  });
});

describe('performance — Parallel scales with branch count', () => {
  it('8-branch Parallel completes in under 1000ms', async () => {
    let b = Parallel.create();
    for (let i = 0; i < 8; i++) b = b.branch(`b${i}`, llm(`R${i}`));
    const par = b.mergeWithFn((r) => Object.values(r).join(',')).build();

    const t0 = performance.now();
    await par.run({ message: 'go' });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
  });
});

describe('performance — Loop iteration overhead is bounded', () => {
  it('10-iteration Loop completes in under 1000ms', async () => {
    const loop = Loop.create().repeat(llm('step')).times(10).build();

    const t0 = performance.now();
    await loop.run({ message: 'go' });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
  });
});

describe('performance — no quadratic blowup with nested Sequences', () => {
  it('Sequence of Sequences depth 3, 5 steps each ≤ 1500ms', async () => {
    const leaf = () => {
      let b = Sequence.create();
      for (let i = 0; i < 5; i++) b = b.step(`l${i}`, llm(`leaf-${i}`));
      return b.build();
    };
    const mid = () => {
      let b = Sequence.create();
      for (let i = 0; i < 3; i++) b = b.step(`m${i}`, leaf());
      return b.build();
    };
    const outer = Sequence.create().step('o1', mid()).step('o2', mid()).build();

    const t0 = performance.now();
    await outer.run({ message: 'go' });
    const ms = performance.now() - t0;
    // 30 leaf steps × reasonable per-step overhead. Generous for CI.
    expect(ms).toBeLessThan(1500);
  });
});

/**
 * ROI tests — composition stability across repeated runs.
 *
 * Compositions are often reused by consumers (think: request handlers).
 * They must handle many sequential runs without leaking listeners, stale
 * per-run state, or accumulating side effects.
 */

import { describe, it, expect, vi } from 'vitest';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('')
    .build();
}

describe('ROI — Sequence reused across N runs', () => {
  it('produces consistent output for N=20 runs', async () => {
    const seq = Sequence.create().step('a', llm('first')).step('b', llm('second')).build();

    for (let i = 0; i < 20; i++) {
      const out = await seq.run({ message: `r${i}` });
      expect(out).toBe('second');
    }
  });

  it('listener fires exactly once per run (no accumulation)', async () => {
    const seq = Sequence.create().step('a', llm('x')).build();
    const handler = vi.fn();
    seq.on('agentfootprint.composition.enter', handler);

    for (let i = 0; i < 30; i++) await seq.run({ message: `r${i}` });
    expect(handler).toHaveBeenCalledTimes(30);
  });
});

describe('ROI — Parallel reused across N runs', () => {
  it('branchResults does not bleed between runs', async () => {
    const par = Parallel.create()
      .branch('a', llm('A'))
      .branch('b', llm('B'))
      .mergeWithFn((r) => `${Object.keys(r).sort().join(',')}=${Object.values(r).sort().join(',')}`)
      .build();

    for (let i = 0; i < 10; i++) {
      const out = await par.run({ message: `r${i}` });
      // Each run produces the identical merge — no accumulation.
      expect(out).toBe('a,b=A,B');
    }
  });
});

describe('ROI — Conditional reused across N runs', () => {
  it('predicate evaluation is fresh each run', async () => {
    const cond = Conditional.create()
      .when('urgent', (i) => i.message.startsWith('!'), llm('URGENT'))
      .otherwise('normal', llm('NORMAL'))
      .build();

    const outcomes: string[] = [];
    for (let i = 0; i < 20; i++) {
      const msg = i % 3 === 0 ? '!go' : 'go';
      outcomes.push(await cond.run({ message: msg }));
    }
    // Pattern matches 7 urgents (i=0,3,6,...,18), 13 normal.
    const urgents = outcomes.filter((o) => o === 'URGENT').length;
    const normals = outcomes.filter((o) => o === 'NORMAL').length;
    expect(urgents).toBe(7);
    expect(normals).toBe(13);
  });
});

describe('ROI — Loop reused across N runs', () => {
  it('iteration counter resets between runs', async () => {
    const loop = Loop.create().repeat(llm('x')).times(3).build();

    const iterationsByRun: number[] = [];
    for (let run = 0; run < 5; run++) {
      let c = 0;
      const off = loop.on('agentfootprint.composition.iteration_start', () => c++);
      await loop.run({ message: 'go' });
      off();
      iterationsByRun.push(c);
    }
    // Every run: exactly 3 iterations. No drift.
    expect(iterationsByRun).toEqual([3, 3, 3, 3, 3]);
  });
});

describe('ROI — nested composition reused across N runs', () => {
  it('Loop wrapping Sequence runs cleanly 10 times in a row', async () => {
    const inner = Sequence.create().step('s1', llm('A')).step('s2', llm('B')).build();
    const loop = Loop.create().repeat(inner).times(2).build();

    for (let i = 0; i < 10; i++) {
      const out = await loop.run({ message: `r${i}` });
      expect(out).toBe('B');
    }
  });
});

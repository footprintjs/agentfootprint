/**
 * Integration tests — nested compositions.
 *
 * The core claim of core-flow/ is composability: any Runner composes into
 * any composition, and compositions nest cleanly. These tests exercise
 * shapes a real consumer would build.
 */

import { describe, it, expect, vi } from 'vitest';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

const mock = (reply: string) => new MockProvider({ reply });

describe('integration — Sequence of Sequences', () => {
  it('nested Sequence runs steps in depth-first order', async () => {
    const inner = Sequence.create({ id: 'inner' })
      .step(
        'i1',
        LLMCall.create({ provider: mock('I1'), model: 'm' })
          .system('')
          .build(),
      )
      .step(
        'i2',
        LLMCall.create({ provider: mock('I2'), model: 'm' })
          .system('')
          .build(),
      )
      .build();

    const outer = Sequence.create({ id: 'outer' })
      .step(
        'o1',
        LLMCall.create({ provider: mock('O1'), model: 'm' })
          .system('')
          .build(),
      )
      .step('o_inner', inner)
      .step(
        'o2',
        LLMCall.create({ provider: mock('O2'), model: 'm' })
          .system('')
          .build(),
      )
      .build();

    const out = await outer.run({ message: 'go' });
    expect(out).toBe('O2');
  });
});

describe('integration — Parallel branches contain Sequences', () => {
  it('each branch runs its internal sequence; merge sees all outputs', async () => {
    const branchA = Sequence.create({ id: 'branchA' })
      .step(
        'a1',
        LLMCall.create({ provider: mock('A1'), model: 'm' })
          .system('')
          .build(),
      )
      .step(
        'a2',
        LLMCall.create({ provider: mock('A2'), model: 'm' })
          .system('')
          .build(),
      )
      .build();

    const branchB = LLMCall.create({ provider: mock('B-only'), model: 'm' })
      .system('')
      .build();

    const par = Parallel.create()
      .branch('a', branchA)
      .branch('b', branchB)
      .mergeWithFn((r) => `${r.a}|${r.b}`)
      .build();

    const out = await par.run({ message: 'go' });
    expect(out).toBe('A2|B-only');
  });
});

describe('integration — Conditional branches are runners (including compositions)', () => {
  it('chosen branch can itself be a Sequence', async () => {
    const multiStep = Sequence.create()
      .step(
        's1',
        LLMCall.create({ provider: mock('S1'), model: 'm' })
          .system('')
          .build(),
      )
      .step(
        's2',
        LLMCall.create({ provider: mock('S2'), model: 'm' })
          .system('')
          .build(),
      )
      .build();

    const single = LLMCall.create({ provider: mock('single'), model: 'm' })
      .system('')
      .build();

    const cond = Conditional.create()
      .when('multi', (i) => i.message.includes('multi'), multiStep)
      .otherwise('one', single)
      .build();

    expect(await cond.run({ message: 'multi please' })).toBe('S2');
    expect(await cond.run({ message: 'just one' })).toBe('single');
  });

  it('chosen branch can itself be a Parallel', async () => {
    const parallel = Parallel.create()
      .branch(
        'x',
        LLMCall.create({ provider: mock('X'), model: 'm' })
          .system('')
          .build(),
      )
      .branch(
        'y',
        LLMCall.create({ provider: mock('Y'), model: 'm' })
          .system('')
          .build(),
      )
      .mergeWithFn((r) => `par:${r.x},${r.y}`)
      .build();

    const single = LLMCall.create({ provider: mock('single'), model: 'm' })
      .system('')
      .build();

    const cond = Conditional.create()
      .when('multi', (i) => i.message.includes('multi'), parallel)
      .otherwise('one', single)
      .build();

    expect(await cond.run({ message: 'multi please' })).toBe('par:X,Y');
    expect(await cond.run({ message: 'just one' })).toBe('single');
  });
});

describe('integration — Loop wrapping an Agent', () => {
  it('Loop iterates an Agent body until times() exhausts', async () => {
    // Agent that just echoes final content.
    const inner = Agent.create({ provider: mock('echo'), model: 'm' })
      .system('')
      .build();

    const loop = Loop.create().repeat(inner).times(3).build();

    const iterStarts = vi.fn();
    loop.on('agentfootprint.composition.iteration_start', iterStarts);
    const out = await loop.run({ message: 'first' });

    expect(out).toBe('echo');
    expect(iterStarts).toHaveBeenCalledTimes(3);
  });

  it('Loop with until() exits early when predicate fires', async () => {
    const inner = LLMCall.create({ provider: mock('stop'), model: 'm' })
      .system('')
      .build();

    const loop = Loop.create()
      .repeat(inner)
      .times(100)
      .until(({ iteration }) => iteration >= 2)
      .build();

    const iterExits: string[] = [];
    loop.on('agentfootprint.composition.iteration_exit', (e) =>
      iterExits.push((e.payload as { reason: string }).reason),
    );

    await loop.run({ message: 'x' });
    // Iteration 1 completes body, iteration 2 triggers guard_false.
    expect(iterExits).toContain('guard_false');
    expect(iterExits.length).toBeLessThan(100); // never ran the full budget
  });
});

describe('integration — events bubble up from nested layers', () => {
  it('Loop > Sequence > LLMCall: outer Loop receives inner llm_start events', async () => {
    const leaf = LLMCall.create({ provider: mock('x'), model: 'm' })
      .system('')
      .build();
    const seq = Sequence.create().step('s1', leaf).step('s2', leaf).build();
    const loop = Loop.create().repeat(seq).times(2).build();

    const llmStarts = vi.fn();
    loop.on('agentfootprint.stream.llm_start', llmStarts);

    await loop.run({ message: 'hi' });
    // 2 LLMCalls per iteration × 2 iterations = 4 llm_start events.
    expect(llmStarts).toHaveBeenCalledTimes(4);
  });
});

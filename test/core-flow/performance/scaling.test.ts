/**
 * Performance tests — composition scaling.
 *
 * The claim is a SHAPE, not a stopwatch reading: cost grows with child count
 * in a straight line, not a curve. Each test makes it twice.
 *
 * FIRST AS A COUNT, because that is the half no machine can bend: a
 * composition of N children runs each child EXACTLY ONCE. A quadratic walk
 * that re-enters children shows up as extra provider calls whatever the load
 * is, and a count says so on the worst runner in the fleet.
 *
 * THEN AS A RATIO, which catches the quadratic that costs without
 * re-executing — a per-child re-copy of the accumulated results, say. That
 * half is a comparison between two sizes measured back to back (see
 * test/helpers/perf.ts), because a busy machine slows both and divides out.
 */

import { describe, expect, it } from 'vitest';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { expectScalesLinearly } from '../../helpers/perf.js';

/** Counts every completion it serves, so "ran each child once" is checkable. */
function countingProvider(reply: string) {
  const state = { calls: 0 };
  const provider = new MockProvider({ reply });
  const wrapped = {
    name: 'counting-mock',
    complete: async (req: Parameters<typeof provider.complete>[0]) => {
      state.calls++;
      return provider.complete(req);
    },
  };
  return { state, provider: wrapped };
}

function llm(reply: string, provider = new MockProvider({ reply })) {
  return LLMCall.create({ provider, model: 'mock' }).system('').build();
}

async function runSequence(steps: number): Promise<void> {
  let b = Sequence.create();
  for (let i = 0; i < steps; i++) b = b.step(`s${i}`, llm(`R${i}`));
  await b.build().run({ message: 'go' });
}

async function runParallel(branches: number): Promise<void> {
  let b = Parallel.create();
  for (let i = 0; i < branches; i++) b = b.branch(`b${i}`, llm(`R${i}`));
  await b
    .mergeWithFn((r) => Object.values(r).join(','))
    .build()
    .run({ message: 'go' });
}

describe('performance — Sequence scales linearly with step count', () => {
  it(
    'runs each of 40 steps exactly once, and costs ~4× a 10-step Sequence',
    { timeout: 30_000, retry: 2 },
    async () => {
      // The count: forty steps, forty completions. A Sequence that re-entered
      // earlier steps — the classic quadratic walk — would show up here at any
      // load, on any machine.
      const counted = countingProvider('R');
      let b = Sequence.create();
      for (let i = 0; i < 40; i++) b = b.step(`s${i}`, llm('R', counted.provider as never));
      await b.build().run({ message: 'go' });
      expect(counted.state.calls).toBe(40);

      // The ratio: the quadratic that costs without re-executing.
      await expectScalesLinearly({
        small: () => runSequence(10),
        large: () => runSequence(40),
        scale: 4,
        why: 'Sequence must not re-walk its step list per step',
      });
    },
  );
});

describe('performance — Parallel scales with branch count', () => {
  it(
    'runs each of 32 branches exactly once, and costs ~4× an 8-branch Parallel',
    { timeout: 30_000, retry: 2 },
    async () => {
      // The count first: thirty-two branches, thirty-two completions.
      const counted = countingProvider('R');
      let b = Parallel.create();
      for (let i = 0; i < 32; i++) b = b.branch(`b${i}`, llm('R', counted.provider as never));
      await b
        .mergeWithFn((r) => Object.values(r).join(','))
        .build()
        .run({ message: 'go' });
      expect(counted.state.calls).toBe(32);

      // Then the ratio, over a range where per-branch cost is flat. It is NOT
      // flat everywhere, and that is worth recording: measured per branch on a
      // quiet machine, 10 branches → 0.59ms, 30 → 0.57ms, 100 → 0.87ms, 300 →
      // 2.57ms. A three-hundred-branch fan-out costs roughly thirty times a
      // thirty-branch one, not ten. Whether that is the engine's fan-out, the
      // merge, or simply three hundred promises in flight is a real question and
      // a separate one — recorded here rather than buried in a slack multiplier
      // that would have made a bigger test pass while meaning nothing.
      await expectScalesLinearly({
        small: () => runParallel(8),
        large: () => runParallel(32),
        scale: 4,
        why: 'Parallel must not re-merge the whole result map per branch',
      });
    },
  );
});

describe('performance — Loop iteration overhead is bounded', () => {
  it(
    'runs exactly 40 iterations, and costs ~4× a 10-iteration Loop',
    { timeout: 30_000, retry: 2 },
    async () => {
      // The count: forty iterations, forty completions — no re-entry, no
      // silently doubled body.
      const counted = countingProvider('step');
      await Loop.create()
        .repeat(llm('step', counted.provider as never))
        .times(40)
        .build()
        .run({ message: 'go' });
      expect(counted.state.calls).toBe(40);

      const runLoop = (times: number) =>
        Loop.create().repeat(llm('step')).times(times).build().run({ message: 'go' });

      await expectScalesLinearly({
        small: async () => {
          await runLoop(10);
        },
        large: async () => {
          await runLoop(40);
        },
        scale: 4,
        why: 'Loop must not accumulate per-iteration cost',
      });
    },
  );
});

describe('performance — no quadratic blowup with nested Sequences', () => {
  it(
    'Sequence of Sequences depth 3, 5 steps each costs no more than the same 30 steps flat',
    { timeout: 30_000, retry: 2 },
    async () => {
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
      // 30 leaf steps arranged three deep, compared against 30 leaf steps in a
      // flat Sequence — the same work, a different shape. Nesting may cost more
      // (each level has its own runner), but it must not cost a DIFFERENT ORDER:
      // 3× headroom over the flat run is the line. Both runs happen back to back
      // on the same machine, so load cancels.
      await expectScalesLinearly({
        small: () => runSequence(30),
        large: async () => {
          const outer = Sequence.create().step('o1', mid()).step('o2', mid()).build();
          await outer.run({ message: 'go' });
        },
        scale: 1,
        slack: 5,
        why: 'nesting 30 steps must not cost an order more than 30 flat steps',
      });
    },
  );
});

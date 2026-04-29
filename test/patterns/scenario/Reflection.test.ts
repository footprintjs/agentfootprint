/**
 * Reflection pattern — 5 scenario tests.
 * Paper: Madaan et al., 2023 — "Self-Refine: Iterative Refinement with
 * Self-Feedback" (https://arxiv.org/abs/2303.17651).
 */

import { describe, it, expect } from 'vitest';
import { reflection } from '../../../src/patterns/Reflection.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

/** Provider that returns responses in order, with the given sequence. */
function seq(...responses: string[]): LLMProvider {
  let i = 0;
  return {
    name: 'seq',
    complete: async (): Promise<LLMResponse> => ({
      content: responses[Math.min(i++, responses.length - 1)]!,
      toolCalls: [],
      usage: { input: 10, output: 5 },
      stopReason: 'stop',
    }),
  };
}

describe('Reflection', () => {
  it('stops early when the critic emits the DONE marker', async () => {
    // Iter 1: propose "v1" → critique "looks good DONE"
    // Loop until() sees 'DONE' → exits
    const runner = reflection({
      provider: seq('v1', 'looks good DONE'),
      model: 'mock',
      proposerPrompt: 'Write',
      criticPrompt: 'Judge',
      untilCritiqueContains: 'DONE',
      maxIterations: 5,
    });
    let iterations = 0;
    runner.on('agentfootprint.composition.iteration_start', () => iterations++);
    await runner.run({ message: 'prompt' });
    expect(iterations).toBe(1);
  });

  it('runs up to maxIterations when the critic never emits DONE', async () => {
    const runner = reflection({
      provider: seq('v1', 'keep going', 'v2', 'still no', 'v3', 'nope'),
      model: 'mock',
      proposerPrompt: 'Write',
      criticPrompt: 'Judge',
      untilCritiqueContains: 'DONE',
      maxIterations: 3,
    });
    let iterations = 0;
    runner.on('agentfootprint.composition.iteration_start', () => iterations++);
    await runner.run({ message: 'prompt' });
    expect(iterations).toBe(3);
  });

  it('emits iteration_exit with reason=guard_false when the stop marker hits', async () => {
    const runner = reflection({
      provider: seq('draft', 'good DONE'),
      model: 'mock',
      proposerPrompt: 'Write',
      criticPrompt: 'Judge',
      maxIterations: 5,
    });
    const exits: string[] = [];
    runner.on('agentfootprint.composition.iteration_exit', (e) => exits.push(e.payload.reason));
    await runner.run({ message: 'p' });
    expect(exits).toContain('guard_false');
  });

  it('emits iteration_exit with reason=budget when times() is exhausted', async () => {
    const runner = reflection({
      provider: seq('a', 'again', 'b', 'again', 'c', 'again'),
      model: 'mock',
      proposerPrompt: 'Write',
      criticPrompt: 'Judge',
      maxIterations: 2,
    });
    const exits: string[] = [];
    runner.on('agentfootprint.composition.iteration_exit', (e) => exits.push(e.payload.reason));
    await runner.run({ message: 'p' });
    // Last exit should be the budget
    expect(exits[exits.length - 1]).toBe('budget');
  });

  it('supports custom untilCritiqueContains marker', async () => {
    const runner = reflection({
      provider: seq('v1', 'ship it [READY]'),
      model: 'mock',
      proposerPrompt: 'Write',
      criticPrompt: 'Judge',
      untilCritiqueContains: '[READY]',
      maxIterations: 10,
    });
    let iters = 0;
    runner.on('agentfootprint.composition.iteration_start', () => iters++);
    await runner.run({ message: 'q' });
    expect(iters).toBe(1);
  });
});

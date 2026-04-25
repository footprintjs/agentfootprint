/**
 * Debate pattern — 5 scenario tests.
 * Paper: Du et al., 2023 — "Improving Factuality and Reasoning in Language
 * Models through Multiagent Debate" (https://arxiv.org/abs/2305.14325).
 */

import { describe, it, expect } from 'vitest';
import { debate } from '../../../src/patterns/Debate.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

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

describe('Debate', () => {
  it('single-round: Proposer → Critic → Judge; returns Judge verdict', async () => {
    // Call order: [0] proposer, [1] critic, [2] judge
    const runner = debate({
      provider: seq('my-proposal', 'my-critique', 'VERDICT'),
      model: 'mock',
      proposerPrompt: 'propose',
      criticPrompt: 'critique',
      judgePrompt: 'judge',
    });
    const out = await runner.run({ message: 'q' });
    expect(out).toBe('VERDICT');
  });

  it('multi-round: N rounds of Propose+Critique before Judge', async () => {
    // rounds=2 → [0,1] p+c round 1, [2,3] p+c round 2, [4] judge
    const runner = debate({
      provider: seq('p1', 'c1', 'p2', 'c2', 'FINAL'),
      model: 'mock',
      proposerPrompt: 'p',
      criticPrompt: 'c',
      judgePrompt: 'j',
      rounds: 2,
    });
    const out = await runner.run({ message: 'q' });
    expect(out).toBe('FINAL');
  });

  it('rejects rounds < 1', () => {
    expect(() =>
      debate({
        provider: seq(),
        model: 'mock',
        proposerPrompt: 'p',
        criticPrompt: 'c',
        judgePrompt: 'j',
        rounds: 0,
      }),
    ).toThrow(/rounds must be >= 1/);
  });

  it('each round fires 2 llm_start events (proposer + critic)', async () => {
    // rounds=2 → 2*2 + 1 judge = 5 llm_start total
    const runner = debate({
      provider: seq('p1', 'c1', 'p2', 'c2', 'FINAL'),
      model: 'mock',
      proposerPrompt: 'p',
      criticPrompt: 'c',
      judgePrompt: 'j',
      rounds: 2,
    });
    let llmStarts = 0;
    runner.on('agentfootprint.stream.llm_start', () => llmStarts++);
    await runner.run({ message: 'q' });
    expect(llmStarts).toBe(5);
  });

  it('sequencing — proposer writes before critic, before judge', async () => {
    const order: string[] = [];
    const provider: LLMProvider = {
      name: 'observe',
      complete: async (req) => {
        const sys = req.systemPrompt ?? '';
        order.push(sys);
        return {
          content: `resp-${order.length}`,
          toolCalls: [],
          usage: { input: 10, output: 5 },
          stopReason: 'stop',
        };
      },
    };
    const runner = debate({
      provider,
      model: 'mock',
      proposerPrompt: 'PROPOSE',
      criticPrompt: 'CRITIQUE',
      judgePrompt: 'JUDGE',
    });
    await runner.run({ message: 'q' });
    expect(order).toEqual(['PROPOSE', 'CRITIQUE', 'JUDGE']);
  });
});

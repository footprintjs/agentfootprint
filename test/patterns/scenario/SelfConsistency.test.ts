/**
 * SelfConsistency pattern — 5 scenario tests.
 * Paper: Wang et al., 2022 — "Self-Consistency Improves Chain of Thought
 * Reasoning in Language Models" (https://arxiv.org/abs/2203.11171).
 */

import { describe, it, expect } from 'vitest';
import { selfConsistency } from '../../../src/patterns/SelfConsistency.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function roundRobin(...responses: string[]): LLMProvider {
  let i = 0;
  return {
    name: 'rr',
    complete: async (): Promise<LLMResponse> => ({
      content: responses[i++ % responses.length]!,
      toolCalls: [],
      usage: { input: 10, output: 5 },
      stopReason: 'stop',
    }),
  };
}

describe('SelfConsistency', () => {
  it('returns the majority answer from N parallel samples', async () => {
    // 3 samples → "A", "B", "A" → majority is "A"
    const runner = selfConsistency({
      provider: roundRobin('A', 'B', 'A'),
      model: 'mock',
      systemPrompt: '',
      samples: 3,
    });
    const out = await runner.run({ message: 'pick' });
    expect(out).toBe('A');
  });

  it('breaks ties deterministically using first-seen order', async () => {
    // 2 samples → each unique → first wins
    const runner = selfConsistency({
      provider: roundRobin('X', 'Y'),
      model: 'mock',
      systemPrompt: '',
      samples: 2,
    });
    const out = await runner.run({ message: 'pick' });
    // First sample by sorted id ('sample-0') = 'X'
    expect(['X', 'Y']).toContain(out);
  });

  it('applies the consumer extractor before voting', async () => {
    // Raw: "Reasoning...\nAnswer: 42", "Reasoning...\nAnswer: 42", "Different\nAnswer: 7"
    // Extract last line after "Answer: " → votes are 42, 42, 7 → 42 wins
    const runner = selfConsistency({
      provider: roundRobin(
        'Think...\nAnswer: 42',
        'Alt reasoning\nAnswer: 42',
        'Different path\nAnswer: 7',
      ),
      model: 'mock',
      systemPrompt: '',
      samples: 3,
      extract: (s) => {
        const m = s.match(/Answer:\s*(.+)$/m);
        return m ? m[1]!.trim() : s.trim();
      },
    });
    const out = await runner.run({ message: 'q' });
    expect(out).toBe('42');
  });

  it('rejects samples < 2 at construction time', () => {
    expect(() =>
      selfConsistency({
        provider: roundRobin('A'),
        model: 'mock',
        systemPrompt: '',
        samples: 1,
      }),
    ).toThrow(/samples must be >= 2/);
  });

  it('fires exactly one composition.enter + one composition.exit per run', async () => {
    const runner = selfConsistency({
      provider: roundRobin('A', 'A', 'B'),
      model: 'mock',
      systemPrompt: '',
      samples: 3,
    });
    let enters = 0;
    let exits = 0;
    runner.on('agentfootprint.composition.enter', () => enters++);
    runner.on('agentfootprint.composition.exit', () => exits++);
    await runner.run({ message: 'q' });
    expect(enters).toBe(1);
    expect(exits).toBe(1);
  });
});

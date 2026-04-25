/**
 * ToT pattern — 5 scenario tests.
 * Paper: Yao et al., 2023 — "Tree of Thoughts" (https://arxiv.org/abs/2305.10601).
 */

import { describe, it, expect } from 'vitest';
import { tot } from '../../../src/patterns/ToT.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

/**
 * Provider that returns distinct content per call — lets us verify
 * branching + pruning semantics.
 */
function countingProvider(prefix = 't'): LLMProvider {
  let i = 0;
  return {
    name: prefix,
    complete: async (): Promise<LLMResponse> => ({
      content: `${prefix}${i++}`,
      toolCalls: [],
      usage: { input: 10, output: 5 },
      stopReason: 'stop',
    }),
  };
}

describe('ToT', () => {
  it('runs depth * branchingFactor LLM calls total', async () => {
    // depth=2, K=3 → 2 * 3 = 6 total thought LLM calls
    const runner = tot({
      provider: countingProvider('t'),
      model: 'mock',
      thoughtPrompt: 'Generate a thought',
      depth: 2,
      branchingFactor: 3,
      score: (t) => t.length, // arbitrary numeric scorer
    });
    let llmCalls = 0;
    runner.on('agentfootprint.stream.llm_start', () => llmCalls++);
    await runner.run({ message: 'problem' });
    expect(llmCalls).toBe(6);
  });

  it('prunes to top-1 (beamWidth=1 / greedy default)', async () => {
    // With beamWidth=1 and a scorer that prefers longer strings,
    // each iteration keeps the longest survivor.
    let i = 0;
    const lengths = ['short', 'loooong', 'mid'];
    const provider: LLMProvider = {
      name: 'len',
      complete: async (): Promise<LLMResponse> => ({
        content: lengths[i++ % lengths.length]!,
        toolCalls: [],
        usage: { input: 10, output: 5 },
        stopReason: 'stop',
      }),
    };
    const runner = tot({
      provider,
      model: 'mock',
      thoughtPrompt: 'Generate a thought',
      depth: 1,
      branchingFactor: 3,
      score: (t) => t.length,
    });
    const out = await runner.run({ message: 'seed' });
    // Longest of 'short' (5), 'loooong' (7), 'mid' (3) = 'loooong'
    expect(out).toBe('loooong');
  });

  it('supports beamWidth > 1 — survivors are concatenated', async () => {
    let i = 0;
    const variants = ['a', 'bb', 'ccc'];
    const provider: LLMProvider = {
      name: 'v',
      complete: async (): Promise<LLMResponse> => ({
        content: variants[i++ % variants.length]!,
        toolCalls: [],
        usage: { input: 10, output: 5 },
        stopReason: 'stop',
      }),
    };
    const runner = tot({
      provider,
      model: 'mock',
      thoughtPrompt: 'G',
      depth: 1,
      branchingFactor: 3,
      beamWidth: 2,
      score: (t) => t.length,
    });
    const out = await runner.run({ message: 'seed' });
    // Top 2 by length: 'ccc', 'bb' → joined by delimiter
    expect(out).toContain('ccc');
    expect(out).toContain('bb');
  });

  it('rejects depth < 1 at construction time', () => {
    expect(() =>
      tot({
        provider: countingProvider(),
        model: 'mock',
        thoughtPrompt: 'T',
        depth: 0,
        branchingFactor: 2,
        score: () => 0,
      }),
    ).toThrow(/depth must be >= 1/);
  });

  it('rejects branchingFactor < 2 at construction time', () => {
    expect(() =>
      tot({
        provider: countingProvider(),
        model: 'mock',
        thoughtPrompt: 'T',
        depth: 1,
        branchingFactor: 1,
        score: () => 0,
      }),
    ).toThrow(/branchingFactor must be >= 2/);
  });
});

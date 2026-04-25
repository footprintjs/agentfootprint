/**
 * Pattern 01 — SelfConsistency (Wang et al., 2022).
 *
 * Sample N answers in parallel, pick the majority vote.
 * https://arxiv.org/abs/2203.11171
 *
 * Run:  npx tsx examples/v2/patterns/01-self-consistency.ts
 */

import { selfConsistency, MockProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/patterns/01-self-consistency',
  title: 'SelfConsistency (Wang et al., 2022)',
  group: 'v2-patterns',
  description: 'Sample N answers in parallel with higher temperature, vote for the majority. Paper: https://arxiv.org/abs/2203.11171',
  defaultInput: 'What is the answer?',
  providerSlots: ['default'],
  tags: ['v2', 'pattern', 'SelfConsistency', 'voting'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // Mock sampler — rotates through three "answers" with some ties.
  let i = 0;
  const samples = ['42', '42', '43', '42', '41'];
  const provider = new MockProvider({
    respond: () => samples[i++ % samples.length]!,
  });

  const runner = selfConsistency({
    provider,
    model: 'mock',
    systemPrompt:
      'Solve the problem. End your response with just the final number.',
    samples: 5,
    temperature: 0.8, // diversity matters
    // Custom extractor — pull just the number out of each sample.
    extract: (response) => response.trim().split(/\s+/).pop() ?? response.trim(),
  });

  const answer = await runner.run({ message: 'What is the answer?' });
  console.log('Majority answer:', answer);
  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

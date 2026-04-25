/**
 * Pattern 03 — Multi-Agent Debate (Du et al., 2023).
 *
 * Two agents with opposing roles propose and critique across N rounds;
 * a third judge agent renders the verdict.
 * https://arxiv.org/abs/2305.14325
 *
 * Run:  npx tsx examples/v2/patterns/03-debate.ts
 */

import { debate, MockProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/patterns/03-debate',
  title: 'Multi-Agent Debate (Du et al., 2023)',
  group: 'v2-patterns',
  description: 'Proposer and Critic alternate for N rounds; a Judge renders verdict. Paper: https://arxiv.org/abs/2305.14325',
  defaultInput: 'Should we ship feature X?',
  providerSlots: ['default'],
  tags: ['v2', 'pattern', 'Debate', 'multi-agent'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // Per-call canned transcript: proposer, critic, proposer, critic, judge.
  const replies = [
    'P: the proposal is good because X',
    'C: but Y contradicts X',
    'P: Y is actually consistent if Z',
    'C: still, consider edge case W',
    'Judge: proposal is acceptable with the W caveat.',
  ];
  let i = 0;

  const runner = debate({
    provider: new MockProvider({ respond: () => replies[i++ % replies.length]! }),
    model: 'mock',
    proposerPrompt: 'You argue FOR the proposal. Be concise.',
    criticPrompt: 'You argue AGAINST the proposal. Point out flaws.',
    judgePrompt: 'You are an impartial judge. Render the verdict.',
    rounds: 2,
  });

  runner.on('agentfootprint.composition.enter', (e) =>
    console.log(`[${e.payload.kind}:${e.payload.id}] enter`),
  );

  const verdict = await runner.run({ message: 'Should we ship feature X?' });
  console.log('\nVerdict:', verdict);
  return verdict;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

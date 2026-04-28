/**
 * Pattern 02 — Reflection / Self-Refine (Madaan et al., 2023).
 *
 * Iterative: propose → critique → revise. Exits when the critic
 * emits a stop marker OR when the iteration budget is exhausted.
 * https://arxiv.org/abs/2303.17651
 *
 * Run:  npx tsx examples/v2/patterns/02-reflection.ts
 */

import { reflection } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'v2/patterns/02-reflection',
  title: 'Reflection / Self-Refine (Madaan et al., 2023)',
  group: 'v2-patterns',
  description: 'Loop(Propose → Critique) until the critic emits a DONE marker. Paper: https://arxiv.org/abs/2303.17651',
  defaultInput: 'Write a poem about night.',
  providerSlots: ['default'],
  tags: ['v2', 'pattern', 'Reflection', 'Self-Refine'],
};


export async function run(input: string, provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // Mock the conversation: two rounds of "draft + critique", then
  // the critic says DONE.
  const replies = [
    'draft v1: a short poem',
    'good direction but needs imagery',
    'draft v2: a short poem with stars',
    'better — ship it DONE',
  ];
  let i = 0;

  const runner = reflection({
    provider: provider ?? exampleProvider('pattern', { respond: () => replies[i++ % replies.length]! }),
    model: 'mock',
    proposerPrompt: 'Write or revise a short poem about night.',
    criticPrompt:
      'Critique the poem. When it is good enough include the marker DONE.',
    maxIterations: 5,
  });

  runner.on('agentfootprint.composition.iteration_start', (e) =>
    console.log(`▶ refine iteration ${e.payload.iteration}`),
  );
  runner.on('agentfootprint.composition.iteration_exit', (e) =>
    console.log(`■ exit: ${e.payload.reason}`),
  );

  const final = await runner.run({ message: 'Write a poem about night.' });
  console.log('\nFinal:', final);
  return final;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

/**
 * 06 — Loop: iteration with mandatory budget.
 *
 * `Loop` iterates a body runner. Budget is MANDATORY — at least one of
 * `.times(n)`, `.forAtMost(ms)`, or `.until(guard)` must fire. Default
 * is `times(10)`. A hard ceiling of 500 iterations prevents runaway.
 *
 * Run:  npx tsx examples/v2/06-loop.ts
 */

import { Loop, LLMCall, MockProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/core-flow/04-loop',
  title: 'Loop — iteration with mandatory budget',
  group: 'v2-core-flow',
  description: 'Iterate a body runner with a required budget: .times(n), .forAtMost(ms), or .until(guard).',
  defaultInput: 'initial idea',
  providerSlots: ['default'],
  tags: ['v2', 'composition', 'Loop', 'budget', 'until'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // A "thinking" LLM that appends the iteration count each call.
  let iter = 0;
  const think = LLMCall.create({
    provider: new MockProvider({
      respond: () => `Pass ${++iter}: refined idea.`,
    }),
    model: 'mock',
  })
    .system('Refine the proposal one pass at a time.')
    .build();

  // Exit when the body emits a DONE marker — or at 4 iterations, whichever.
  const refiner = Loop.create({ name: 'Refine' })
    .repeat(think)
    .times(4)
    .until(({ iteration, latestOutput }) => {
      console.log(`[guard] iter=${iteration} output=${latestOutput}`);
      return iteration >= 3; // stop after pass 3
    })
    .build();

  refiner.on('agentfootprint.composition.iteration_start', (e) =>
    console.log(`▶ iteration ${e.payload.iteration}`),
  );
  refiner.on('agentfootprint.composition.iteration_exit', (e) =>
    console.log(`■ iteration ${e.payload.iteration} — reason: ${e.payload.reason}`),
  );

  const final = await refiner.run({ message: 'initial idea' });
  console.log('\nFinal:', final);
  return final;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

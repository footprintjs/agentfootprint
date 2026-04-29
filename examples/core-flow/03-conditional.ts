/**
 * 05 — Conditional: predicate-gated routing.
 *
 * `Conditional` picks exactly ONE runner based on predicate order.
 * First matching `.when()` wins. `.otherwise()` is mandatory.
 *
 * Run:  npx tsx examples/05-conditional.ts
 */

import { Conditional, LLMCall } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'core-flow/03-conditional',
  title: 'Conditional — predicate routing',
  group: 'core-flow',
  description: 'Pick one runner via first-match predicate. .otherwise() is mandatory.',
  defaultInput: 'Site is DOWN help!',
  providerSlots: ['default'],
  tags: ['composition', 'Conditional', 'routing'],
};


export async function run(input: string, provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  const urgent = LLMCall.create({
    provider: provider ?? exampleProvider('core-flow', { reply: 'Escalating to on-call engineer.' }),
    model: 'mock',
  })
    .system('You are the urgent-issue bot. Escalate immediately.')
    .build();

  const normal = LLMCall.create({
    provider: provider ?? exampleProvider('core-flow', { reply: "We'll respond within 24 hours." }),
    model: 'mock',
  })
    .system('You are the standard support bot.')
    .build();

  const triage = Conditional.create({ name: 'Triage' })
    .when(
      'urgent',
      (input) => /\b(urgent|asap|outage|down|critical)\b/i.test(input.message),
      urgent,
    )
    .otherwise('normal', normal)
    .build();

  triage.on('agentfootprint.composition.route_decided', (e) =>
    console.log(`[route] chose "${e.payload.chosen}" — ${e.payload.rationale}`),
  );

  const urgentResult = await triage.run({ message: input });
  console.log(urgentResult);
  console.log('---');
  // Demonstrate the fallback branch with a second call that the predicate misses.
  const normalResult = await triage.run({ message: 'question about my plan' });
  console.log(normalResult);

  return { urgentResult, normalResult };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

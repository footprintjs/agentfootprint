/**
 * 03 — Sequence: linear pipeline.
 *
 * `Sequence` chains runners. Each step's string output becomes the next
 * step's `{ message }` input. Use `.pipeVia(fn)` to transform between
 * steps when string-chain isn't what you want.
 *
 * Run:  npx tsx examples/v2/03-sequence.ts
 */

import { Sequence, LLMCall } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'v2/core-flow/01-sequence',
  title: 'Sequence — linear pipeline',
  group: 'v2-core-flow',
  description: 'Chain runners; each step’s string output becomes the next step’s input. Use .pipeVia() to transform between steps.',
  defaultInput: 'my invoice has an error',
  providerSlots: ['default'],
  tags: ['v2', 'composition', 'Sequence', 'pipeVia'],
};


export async function run(input: string, provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  const classify = LLMCall.create({
    provider: provider ?? exampleProvider('core-flow', { reply: 'billing' }),
    model: 'mock',
  })
    .system('Classify the user intent as one word: billing, tech, or general.')
    .build();

  const respond = LLMCall.create({
    provider: provider ?? exampleProvider('core-flow', {
      respond: (req) => {
        const last = [...req.messages].reverse().find((m) => m.role === 'user');
        return `Handled as [${last?.content}] — please hold for the right team.`;
      },
    }),
    model: 'mock',
  })
    .system('You are a support dispatcher. Write a short acknowledgement.')
    .build();

  const pipeline = Sequence.create({ name: 'IntakePipeline' })
    .step('classify', classify)
    .pipeVia((label) => ({ message: `Intent: ${label.trim()}` }))
    .step('respond', respond)
    .build();

  pipeline.on('agentfootprint.composition.enter', (e) =>
    console.log(`[enter] ${e.payload.kind}:${e.payload.id} with ${e.payload.childCount} children`),
  );

  const out = await pipeline.run({ message: 'my invoice has an error' });
  console.log('\nOutput:', out);
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

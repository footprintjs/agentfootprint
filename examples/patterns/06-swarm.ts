/**
 * Pattern 06 — Swarm: multi-agent handoff.
 *
 * A router picks which specialist agent handles the next turn. Each
 * agent's output becomes the next iteration's input. The router can
 * return `undefined` (or a halt sentinel) to stop the chain.
 *
 * Origin: OpenAI Swarm experiment.
 *
 * Run:  npx tsx examples/v2/patterns/06-swarm.ts
 */

import { swarm, LLMCall, MockProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/patterns/06-swarm',
  title: 'Swarm — multi-agent handoff (OpenAI Swarm)',
  group: 'v2-patterns',
  description: 'Fixed agent roster + route() function; Loop(Conditional(agent-select)) until route returns undefined.',
  defaultInput: 'my invoice is wrong',
  providerSlots: ['default'],
  tags: ['v2', 'pattern', 'Swarm', 'handoff'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // Three specialist agents — each tagged so we can see hand-offs.
  const billing = LLMCall.create({
    provider: new MockProvider({ reply: '[billing] refund eligibility confirmed' }),
    model: 'mock',
  })
    .system('You handle billing questions only.')
    .build();

  const tech = LLMCall.create({
    provider: new MockProvider({ reply: '[tech] system status is normal' }),
    model: 'mock',
  })
    .system('You handle technical questions only.')
    .build();

  const triage = LLMCall.create({
    provider: new MockProvider({ reply: 'refund please' }),
    model: 'mock',
  })
    .system('You classify user requests and forward them.')
    .build();

  const router = swarm({
    agents: [
      { id: 'triage', runner: triage },
      { id: 'billing', runner: billing },
      { id: 'tech', runner: tech },
    ],
    // Route function — pure sync over the current message. First turn goes
    // to triage, then to billing or tech based on content, then halts.
    route: (input) => {
      const msg = input.message.toLowerCase();
      if (msg.includes('[billing]')) return undefined; // billing done → halt
      if (msg.includes('[tech]')) return undefined; // tech done → halt
      if (msg.includes('refund') || msg.includes('bill')) return 'billing';
      if (msg.includes('status') || msg.includes('error')) return 'tech';
      return 'triage'; // first turn
    },
    maxHandoffs: 5,
  });

  router.on('agentfootprint.composition.iteration_start', (e) =>
    console.log(`▶ handoff ${e.payload.iteration}`),
  );

  const final = await router.run({ message: 'my invoice is wrong' });
  console.log('\nFinal response:', final);
  return final;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

/**
 * Pattern 07 — llmSwarm: the hand-off decision made by an LLM.
 *
 * `swarm()` asks you for a sync `route()` function. `llmSwarm()` asks an
 * LLM instead: each agent's own `description` becomes its line in the
 * router's prompt, and the router answers with validated JSON —
 * `{ agentId?, message, reason? }`. No `agentId` means "done", and the
 * swarm halts on that message.
 *
 * Watch the run: every decision arrives as a `route_decided` event with
 * the model's own reason attached. (That reason stays in the trace — it
 * is never fed back into a prompt.)
 *
 * Run:  npx tsx examples/patterns/07-llm-swarm.ts
 */

import { llmSwarm, LLMCall } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'patterns/07-llm-swarm',
  title: 'llmSwarm — LLM-decided hand-offs',
  group: 'patterns',
  description:
    'Roster with descriptions → router prompt; the LLM answers {agentId?, message, reason?} and the swarm dispatches on it. No agentId = final answer.',
  defaultInput: 'my invoice is wrong and I want a refund',
  providerSlots: ['default'],
  tags: ['pattern', 'Swarm', 'routing', 'handoff'],
};

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  // The two specialists. Each answers in its own voice and tags itself so
  // the hand-off is visible in the output.
  const billing = LLMCall.create({
    provider:
      provider ??
      exampleProvider('pattern', { reply: '[billing] refund approved — 3 business days.' }),
    model: 'mock',
  })
    .system('You handle billing questions only. Be brief.')
    .build();

  const tech = LLMCall.create({
    provider:
      provider ?? exampleProvider('pattern', { reply: '[tech] all systems are healthy.' }),
    model: 'mock',
  })
    .system('You handle technical questions only. Be brief.')
    .build();

  // The router's own model. Routing is plumbing, so the mock answers
  // instantly rather than acting out LLM latency. With a real provider
  // injected, the roster prompt does this work for you.
  const routerProvider =
    provider ??
    exampleProvider('pattern', {
      thinkingMs: 0,
      respond: (req) => {
        const last = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        // A specialist has answered → wrap up.
        if (last.startsWith('[billing]') || last.startsWith('[tech]')) {
          return JSON.stringify({ message: last, reason: 'the specialist answered' });
        }
        if (/invoice|refund|bill|charge/i.test(last)) {
          return JSON.stringify({
            agentId: 'billing',
            message: last,
            reason: 'the message is money-shaped',
          });
        }
        return JSON.stringify({ agentId: 'tech', message: last, reason: 'sounds technical' });
      },
    });

  // #region llm-swarm
  const desk = llmSwarm({
    provider: routerProvider,
    model: 'mock',
    agents: [
      {
        id: 'billing',
        description: 'Invoices, refunds, charges and payment methods.',
        runner: billing,
      },
      {
        id: 'tech',
        description: 'Login problems, error messages and outages.',
        runner: tech,
      },
    ],
    maxHandoffs: 4,
  });
  // #endregion llm-swarm

  desk.on('agentfootprint.composition.route_decided', (e) => {
    // Only the router's decisions carry evidence; the swarm's own
    // Conditional announces the branch it dispatched.
    if (e.payload.evidence !== undefined) {
      console.log(`▶ router → ${e.payload.chosen}  (${e.payload.rationale ?? ''})`);
    }
  });

  const answer = await desk.run({ message: input });
  console.log('\nFinal answer:', answer);
  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

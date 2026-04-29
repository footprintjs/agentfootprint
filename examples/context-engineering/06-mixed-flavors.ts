/**
 * 06 — Mixed flavors: all 4 sugar factories in one agent.
 *
 * Compact reference showing every flavor in one place. Shorter than
 * 05-dynamic-react because the goal here is the SHAPE of using all
 * four together — not the multi-iteration morph.
 */

import {
  Agent,
  defineFact,
  defineInstruction,
  defineSkill,
  defineSteering,
  defineTool,
  mock,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/06-mixed-flavors',
  title: 'Mixed flavors — all 4 in one agent',
  group: 'context-engineering',
  description:
    'One agent with steering + instruction + skill + fact registered side-by-side. ' +
    'Same Injection primitive underneath; different observable flavor tags.',
  defaultInput: 'help me reset my password',
  providerSlots: ['default'],
  tags: ['context-engineering', 'showcase', 'all-flavors'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const accountSkill = defineSkill({
    id: 'account',
    description: 'Use for password resets, profile updates, account questions.',
    body: 'Confirm the user\'s identity (last 4 digits of payment method) before resetting.',
    tools: [
      defineTool({
        name: 'send_reset_email',
        description: 'Send a password reset email.',
        inputSchema: { type: 'object', properties: { email: { type: 'string' } } },
        execute: () => 'Reset email sent.',
      }),
    ],
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'Sure — let me look up your account.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a customer support assistant.')
    // Always-on policy
    .steering(defineSteering({
      id: 'tone',
      prompt: 'Be friendly. Confirm understanding before taking action.',
    }))
    // Predicate-gated nudge
    .instruction(defineInstruction({
      id: 'urgent',
      activeWhen: (ctx) => /urgent|asap|emergency/i.test(ctx.userMessage),
      prompt: 'The user marked this urgent — prioritize the fastest path to resolution.',
    }))
    // LLM-activated body + tools
    .skill(accountSkill)
    // Developer-supplied data
    .fact(defineFact({
      id: 'user',
      data: 'User: Alice Chen (alice@example.com). Plan: Pro. Last login: 2 days ago.',
    }))
    .fact(defineFact({
      id: 'support-hours',
      data: 'Live agent escalation available 24/7. Refunds processed within 3 business days.',
    }))
    .build();

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

/**
 * 05 — Dynamic ReAct: context that morphs across iterations.
 *
 * The marquee example for the InjectionEngine. An agent's context
 * (system prompt + tools + facts) is re-evaluated every iteration —
 * it's not the same on iteration N as on iteration N-1.
 *
 * This file shows three flavors of dynamism in one agent:
 *   1. Skill activation — LLM calls read_skill('pii') → next iteration
 *      gets the PII handling body
 *   2. on-tool-return-style instruction — when redact_pii runs, an
 *      instruction fires for the next iteration only
 *   3. Iteration-counter rule — a steering nudge that only kicks in
 *      after iteration 2
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
  id: 'context-engineering/05-dynamic-react',
  title: 'Dynamic ReAct — context morphs each iteration',
  group: 'context-engineering',
  description:
    'Skills activate, instructions fire after specific tools, facts ' +
    'evolve. Each iteration\'s prompt + tools is DIFFERENT from the ' +
    'last. The library\'s marquee pattern.',
  defaultInput: 'My account is alice@example.com — please refund $42',
  providerSlots: ['default'],
  tags: ['context-engineering', 'dynamic-react', 'showcase'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const redactPii = defineTool({
    name: 'redact_pii',
    description: 'Redact personally-identifiable info (emails, phones).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    execute: ({ text }: { text: string }) =>
      text.replace(/[\w.-]+@[\w.-]+/g, '[EMAIL]').replace(/\d{3}-\d{4}/g, '[PHONE]'),
  });

  // Always-on baseline policy
  const safety = defineSteering({
    id: 'safety',
    prompt: 'Never expose raw PII (emails, phone numbers) in your final answer.',
  });

  // Activates AFTER the LLM calls redact_pii, for the next iteration only
  // (predicate inspects ctx.lastToolResult — naturally one-shot since the
  //  next iteration's lastToolResult will be different).
  // #region on-tool-return
  const postPii = defineInstruction({
    id: 'post-pii',
    description: 'Brief reminder to use the redacted text, not the original.',
    activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
    prompt: 'Use the redacted text in your reply. Do not paraphrase the original.',
  });
  // #endregion on-tool-return

  // LLM-activated body + tools — loaded only when the LLM asks
  const billingSkill = defineSkill({
    id: 'billing',
    description: 'Read for refunds / charges. Unlocks process_refund.',
    body: 'When refunding: redact PII first using redact_pii, THEN call process_refund.',
    tools: [
      defineTool({
        name: 'process_refund',
        description: 'Issue a refund. Args: { amount: number }.',
        inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
        execute: ({ amount }: { amount: number }) => `Refund of $${amount} issued.`,
      }),
    ],
  });

  // Iteration-counter rule
  const focusReminder = defineInstruction({
    id: 'focus',
    activeWhen: (ctx) => ctx.iteration >= 3,
    prompt: 'You have been working on this turn for several iterations. Wrap up the response now.',
  });

  // Plain fact
  const userProfile = defineFact({
    id: 'user-profile',
    data: 'User: Alice Chen. Plan: Pro.',
  });

  // Scripted mock — reproduces a 4-iteration Dynamic ReAct flow
  let iter = 0;
  const scriptedProvider = provider ?? mock({
    respond: () => {
      iter++;
      switch (iter) {
        case 1:
          return {
            content: 'Loading billing skill.',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'billing' } }],
            usage: { input: 30, output: 8 },
            stopReason: 'tool_use',
          };
        case 2:
          return {
            content: 'Redacting PII first.',
            toolCalls: [{ id: 'c2', name: 'redact_pii', args: { text: 'alice@example.com refund $42' } }],
            usage: { input: 60, output: 8 },
            stopReason: 'tool_use',
          };
        case 3:
          return {
            content: 'Issuing refund.',
            toolCalls: [{ id: 'c3', name: 'process_refund', args: { amount: 42 } }],
            usage: { input: 90, output: 6 },
            stopReason: 'tool_use',
          };
        default:
          return {
            content: 'Done. Refund of $42 issued for [EMAIL]. You should see it within 3-5 business days.',
            toolCalls: [],
            usage: { input: 100, output: 22 },
            stopReason: 'stop',
          };
      }
    },
  });

  const agent = Agent.create({
    provider: scriptedProvider,
    model: 'mock',
    maxIterations: 6,
  })
    .system('You are a customer support assistant.')
    .steering(safety)
    .skill(billingSkill)
    .instruction(postPii)
    .instruction(focusReminder)
    .fact(userProfile)
    .build();

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

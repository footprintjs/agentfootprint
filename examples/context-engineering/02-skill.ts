/**
 * 02 — Skill: LLM-activated body + tools.
 *
 * `defineSkill` produces an Injection with a `llm-activated` trigger.
 * Behind the scenes the Agent auto-attaches a `read_skill` tool when
 * Skills are registered. When the LLM calls `read_skill('billing')`,
 * the Skill's body lands in the next iteration's system prompt and
 * any `inject.tools` become available in the tools slot.
 *
 * Skills stay active for the rest of the turn (`agent.run()` call).
 * Each new turn starts with no Skills active — the LLM has to read
 * the catalog and decide what to activate.
 */

import {
  Agent,
  defineSkill,
  defineTool,
  mock,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/02-skill',
  title: 'Skill — LLM-activated body + tools',
  group: 'context-engineering',
  description:
    'LLM calls read_skill() to load a body of guidance + unlock tools. ' +
    'Active for the rest of the turn.',
  defaultInput: 'I need a refund for order #42',
  providerSlots: ['default'],
  tags: ['context-engineering', 'skill', 'llm-activated'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const refundTool = defineTool({
    name: 'process_refund',
    description: 'Issue a refund for an order. Args: { orderId: string }.',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
    execute: async ({ orderId }: { orderId: string }) =>
      `Refund issued for order ${orderId}: $42.99 to original payment method.`,
  });

  const billingSkill = defineSkill({
    id: 'billing',
    description: 'Read for refund / charge / billing questions. Unlocks process_refund.',
    body: 'When handling billing: confirm the order id, then call process_refund. Always state the amount + payment method in the final reply.',
    tools: [refundTool],
  });

  // Two-iteration mock: first turn the LLM "asks for billing skill" via
  // read_skill('billing'); second turn it uses process_refund.
  let iter = 0;
  const scriptedProvider = provider ?? mock({
    respond: () => {
      iter++;
      if (iter === 1) {
        return {
          content: 'Let me load billing help.',
          toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'billing' } }],
          usage: { input: 20, output: 10 },
          stopReason: 'tool_use',
        };
      }
      if (iter === 2) {
        return {
          content: 'Issuing refund now.',
          toolCalls: [{ id: 'c2', name: 'process_refund', args: { orderId: '42' } }],
          usage: { input: 40, output: 12 },
          stopReason: 'tool_use',
        };
      }
      return {
        content: 'Refund processed: $42.99 returned to your original payment method.',
        toolCalls: [],
        usage: { input: 60, output: 15 },
        stopReason: 'stop',
      };
    },
  });

  const agent = Agent.create({
    provider: scriptedProvider,
    model: 'mock',
    maxIterations: 5,
  })
    .system('You are a customer support assistant.')
    .skill(billingSkill)
    .build();

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

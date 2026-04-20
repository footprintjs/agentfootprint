/**
 * Instructions — conditional context injection. `defineInstruction()`
 * injects into all 3 LLM API positions: system prompt, tools, and
 * tool-result recency window.
 */

import { Agent, mock, defineTool, defineInstruction } from 'agentfootprint';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli';

export const meta: ExampleMeta = {
  id: 'runtime-features/instructions/01-basic',
  title: 'defineInstruction — conditional context injection',
  group: 'runtime-features',
  description: 'Inject prompt/tools/guidance conditionally via defineInstruction().',
  defaultInput: 'I want a refund for order ORD-42',
  providerSlots: ['default'],
  tags: ['instructions', 'defineInstruction', 'runtime'],
};

const lookupOrder = defineTool({
  id: 'lookup_order',
  description: 'Look up an order.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  handler: async ({ orderId }: { orderId: string }) => ({
    content: JSON.stringify({ orderId, status: 'shipped', amount: 299 }),
  }),
});

const refundInstruction = defineInstruction({
  id: 'refund-policy',
  description: 'Refund policy guidance',
  prompt: 'Refund policy: items over $200 require manager approval.',
  onToolResult: [
    {
      id: 'refund-check',
      when: (ctx) => ctx.toolId === 'lookup_order',
      text: 'Check if the order amount exceeds the $200 refund threshold.',
    },
  ],
});

const defaultMock = (): LLMProvider =>
  mock([
    { content: '', toolCalls: [{ id: 'tc1', name: 'lookup_order', arguments: { orderId: 'ORD-42' } }] },
    { content: 'Order ORD-42 shipped for $299. Refund requires manager approval per policy.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const agent = Agent.create({ provider: provider ?? defaultMock() })
    .system('You are a support agent.')
    .tool(lookupOrder)
    .instruction(refundInstruction)
    .build();

  const result = await agent.run(input);
  return { content: result.content };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

/**
 * Sample 17: Instructions — Conditional Context Injection
 *
 * defineInstruction() injects context into the 3 LLM API positions:
 * system prompt, tools, and tool-result recency window.
 *
 * Run: npx tsx examples/orchestration/17-instructions.ts
 */
import { Agent, mock, defineTool, defineInstruction } from 'agentfootprint';

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
  onToolResult: [{
    id: 'refund-check',
    when: (ctx) => ctx.toolId === 'lookup_order',
    text: 'Check if the order amount exceeds the $200 refund threshold.',
  }],
});

export async function run() {
  const agent = Agent.create({
    provider: mock([
      { content: '', toolCalls: [{ id: 'tc1', name: 'lookup_order', arguments: { orderId: 'ORD-42' } }] },
      { content: 'Order ORD-42 shipped for $299. Refund requires manager approval per policy.' },
    ]),
  })
    .system('You are a support agent.')
    .tool(lookupOrder)
    .instruction(refundInstruction)
    .build();

  const result = await agent.run('I want a refund for order ORD-42');
  console.log(`Response: ${result.content}`);
}

if (process.argv[1] === import.meta.filename) {
  run().then(() => console.log('Done.'));
}

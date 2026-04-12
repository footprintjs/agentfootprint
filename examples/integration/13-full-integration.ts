/**
 * Sample 13: Full Integration
 *
 * RAG + Agent + tools combined — shows how concepts compose.
 */
import { Agent, RAG, mock, mockRetriever, defineTool } from 'agentfootprint';

const lookupTool = defineTool({
  id: 'lookup_order',
  description: 'Look up order details',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  handler: async ({ orderId }: { orderId: string }) => ({ content: JSON.stringify({ orderId, status: 'shipped', total: '$49.99' }) }),
});

export async function run(input: string) {
  // Build a RAG runner for document lookup
  const ragRunner = RAG
    .create({
      provider: mock([{ content: 'The return policy allows refunds within 30 days.' }]),
      retriever: mockRetriever([{
        chunks: [{ content: 'Return policy: 30-day refund window for all purchases.', score: 0.9, metadata: {} }],
      }]),
    })
    .system('Answer from docs:')
    .build();

  // Build an agent with a tool
  const agentRunner = Agent
    .create({ provider: mock([
      { content: 'Let me look that up.', toolCalls: [{ id: '1', name: 'lookup_order', arguments: { orderId: 'ORD-123' } }] },
      { content: 'Your order ORD-123 has been shipped. Total was $49.99.' },
    ]) })
    .system('You are a support agent.')
    .tool(lookupTool)
    .build();

  const result = await agentRunner.run(input);
  return { content: result.content };
}

if (process.argv[1] === import.meta.filename) {
  run('Where is my order ORD-123?').then(console.log);
}

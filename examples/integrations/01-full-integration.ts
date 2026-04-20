/**
 * Full integration — RAG + Agent + tools composed. Shows how the seven
 * concepts work together in a realistic end-to-end flow.
 */

import { Agent, RAG, mock, mockRetriever, defineTool } from 'agentfootprint';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'integrations/01-full-integration',
  title: 'Full integration — RAG + Agent + tools',
  group: 'integrations',
  description: 'End-to-end composition: retrieval, agent loop, tool call, final answer.',
  defaultInput: 'Where is my order ORD-123?',
  providerSlots: ['default'],
  tags: ['integration', 'full-stack', 'RAG', 'Agent'],
};

const lookupTool = defineTool({
  id: 'lookup_order',
  description: 'Look up order details',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  handler: async ({ orderId }: { orderId: string }) => ({
    content: JSON.stringify({ orderId, status: 'shipped', total: '$49.99' }),
  }),
});

const defaultMock = (): LLMProvider =>
  mock([
    {
      content: 'Let me look that up.',
      toolCalls: [{ id: '1', name: 'lookup_order', arguments: { orderId: 'ORD-123' } }],
    },
    { content: 'Your order ORD-123 has been shipped. Total was $49.99.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const p = provider ?? defaultMock();

  // RAG runner for doc lookup — reference pattern; not wired into the agent here.
  const ragRunner = RAG.create({
    provider: mock([{ content: 'The return policy allows refunds within 30 days.' }]),
    retriever: mockRetriever([
      {
        chunks: [
          {
            content: 'Return policy: 30-day refund window for all purchases.',
            score: 0.9,
            metadata: {},
          },
        ],
      },
    ]),
  })
    .system('Answer from docs:')
    .build();

  void ragRunner;

  const agentRunner = Agent.create({ provider: p })
    .system('You are a support agent.')
    .tool(lookupTool)
    .build();

  const result = await agentRunner.run(input);
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

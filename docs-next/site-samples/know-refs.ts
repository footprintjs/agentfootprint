import { mock } from 'agentfootprint/providers';

export const sent: string[] = [];
export const received: number[] = [];
let call = 0;
const provider = mock({
  respond: (request) => {
    const said = JSON.stringify(request.messages);
    sent.push(said);
    call += 1;
    if (call === 1) return { content: '', toolCalls: [{ id: 'c1', name: 'get_sales', args: {} }] };
    if (call === 2) {
      const ticket = /art_[A-Za-z0-9_-]+/.exec(said)?.[0] ?? 'none';
      return { content: '', toolCalls: [{ id: 'c2', name: 'summarize', args: { sales: ticket } }] };
    }
    return { content: 'Done.' };
  },
});

// #region code
import { Agent, defineTool, inMemoryArtifacts } from 'agentfootprint';

// 48,000 rows. Past the threshold, the store keeps them and the model gets a short ticket.
const getSales = defineTool({
  name: 'get_sales',
  description: 'Fetch the Q3 sales rows (large).',
  inputSchema: { type: 'object', properties: {} },
  execute: () => Array.from({ length: 48_000 }, (_, i) => ({ order: i, amount: (i % 97) + 1 })),
});

// This argument is a ticket. The tool receives the data behind it.
const summarize = defineTool<{ sales: string }, string>({
  name: 'summarize',
  description: 'Summarize sales rows.',
  inputSchema: { type: 'object', properties: { sales: { type: 'string' } }, required: ['sales'] },
  wants: { sales: 'tool-result/get_sales' },
  execute: ({ sales }) => {
    received.push((JSON.parse(sales) as unknown[]).length);
    return 'summary';
  },
});

const agent = Agent.create({
  provider,
  model: 'mock',
  artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2_000 } },
})
  .tool(getSales)
  .tool(summarize)
  .build();
// #endregion code

await agent.run({ message: 'Summarize Q3.' });

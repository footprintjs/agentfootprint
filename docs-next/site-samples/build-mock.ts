// #region code
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const getRefund = defineTool<{ orderId: string }, unknown>({
  name: 'get_refund',
  description: 'Look up a refund by order id.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
  execute: ({ orderId }) => ({ orderId, status: 'pending' }),
});

// A scripted model: free, offline, and the same every time.
const provider = mock({
  replies: [
    { toolCalls: [{ id: 'c1', name: 'get_refund', args: { orderId: 'A-1042' } }] },
    { content: 'Your refund for A-1042 is still pending.' },
  ],
});

const agent = Agent.create({ provider, model: 'mock' })
  .system('You answer refund questions.')
  .tool(getRefund)
  .build();

const answer = await agent.run({ message: 'Where is my refund for A-1042?' });
// #endregion code

export { answer };

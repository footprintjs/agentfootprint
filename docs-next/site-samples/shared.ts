import { defineTool } from 'agentfootprint';

export const getRefund = defineTool<{ orderId: string }, unknown>({
  name: 'get_refund',
  description: 'Look up a refund by order id.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
  execute: ({ orderId }) => ({ orderId, status: 'pending' }),
});

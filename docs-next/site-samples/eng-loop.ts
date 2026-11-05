import { mock } from 'agentfootprint/providers';
import { defineTool } from 'agentfootprint';

export const ran: string[] = [];
const getRefund = defineTool<{ orderId: string }, unknown>({
  name: 'get_refund',
  description: 'Look up a refund by order id.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
  execute: ({ orderId }) => {
    ran.push(orderId);
    return { orderId, status: 'pending', internalNote: 'flagged' };
  },
});
export const sent: string[] = [];
let call = 0;
const provider = mock({
  respond: (request) => {
    sent.push(JSON.stringify(request.messages));
    call += 1;
    if (call === 1) return { content: '', toolCalls: [{ id: 'c1', name: 'get_refund', args: { orderId: 'nonsense' } }] };
    if (call === 2) return { content: '', toolCalls: [{ id: 'c2', name: 'get_refund', args: { orderId: 'A-1042' } }] };
    return { content: 'Still pending, as PROJECT-BLUEJAY said.' };
  },
});

// #region code
import { Agent, allow, deny, slidingWindow, type MessageMiddleware, type ToolMiddleware } from 'agentfootprint';

const scrubCards: MessageMiddleware = {
  name: 'scrub-cards',
  onMessage: (message) => {
    const clean = message.content.replace(/\b\d{4}[ -]\d{4}\b/g, '[card]');
    return clean === message.content ? allow() : allow(clean, 'masked a card number');
  },
};

const knownOrdersOnly: ToolMiddleware = {
  name: 'known-orders-only',
  onToolCall: (call) => (/^A-\d{4}$/.test(String(call.args.orderId)) ? allow() : deny('order ids look like A-1042')),
};

const dropInternalNotes: ToolMiddleware = {
  name: 'drop-internal-notes',
  onToolResult: (call) => {
    const { internalNote: _hidden, ...safe } = call.result as Record<string, unknown>;
    return allow(safe, 'removed the internal note');
  },
};

const noCodenames: MessageMiddleware = {
  name: 'no-codenames',
  onMessage: (message) => {
    const clean = message.content.replace(/PROJECT-BLUEJAY/g, 'our review team');
    return clean === message.content ? allow() : allow(clean, 'internal codename');
  },
};

const agent = Agent.create({ provider, model: 'mock' })
  .tool(getRefund)
  .act({
    input: [scrubCards], //             the message, before the run commits it
    beforeTool: [knownOrdersOnly], //   every call, before it is dispatched
    afterTool: [dropInternalNotes], //  every result, before the model reads it
    window: slidingWindow({ keepRecentTurns: 12 }), // what the model still sees
    output: [noCodenames], //           the answer, before the caller gets it
  })
  .build();
// #endregion code

export const answer = await agent.run({ message: 'My card is 4242 4242. Where is my refund?' });

import { mock } from 'agentfootprint/providers';

export const flagged: string[] = [];
export const stops: unknown[] = [];
export const checked: unknown[] = [];
let call = 0;
const provider = mock({
  respond: () => {
    call += 1;
    if (call === 1) return { content: '', toolCalls: [{ id: 'a', name: 'search_orders', args: {} }] };
    if (call === 2) return { content: '', toolCalls: [{ id: 'b', name: 'get_refund', args: { orderId: 'Z-9999' } }] };
    return { content: 'Refund C-2291 is complete.', toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'content_filter' };
  },
});

// #region code
import { Agent, defineTool } from 'agentfootprint';

const searchOrders = defineTool({
  name: 'search_orders',
  description: 'Find a customer’s orders.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => [{ orderId: 'A-1042' }],
});

const getRefund = defineTool({
  name: 'get_refund',
  description: 'Look up a refund.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] }, // the wrong shape never runs
  argumentsFrom: ['search_orders'], // its input should come from that tool
  resultColumns: { orderId: 'string', amount: 'number' }, // what its rows should hold
  execute: () => [{ orderId: 'A-1042', amount: 'a lot' }],
});

const agent = Agent.create({ provider, model: 'mock', checkColumnTypes: 'warn' })
  .tool(searchOrders)
  .tool(getRefund)
  .namesAndNumbersFromEvidence() // every name and number in the answer
  .build();

// Findings from the model and from tools arrive on one stream.
agent.on('agentfootprint.integrity.context_error', (event) => flagged.push(event.payload.kind));

// What the provider itself said, such as 'refusal' or 'content_filter'.
agent.on('agentfootprint.stream.llm_end', (event) => stops.push(event.payload.stopReason));
// #endregion code

agent.on('agentfootprint.agent.evidence_checked', (event) => checked.push(event.payload));
export const answer = await agent.run({ message: 'Where is my refund?' });

/* Arguments of the wrong shape: the tool never runs. */
export const invalid: unknown[] = [];
export const ranWithBadArgs = { count: 0 };
const strict = defineTool({
  name: 'get_refund',
  description: 'Look up a refund.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
  execute: () => {
    ranWithBadArgs.count += 1;
    return 'x';
  },
});
let strictCall = 0;
const strictAgent = Agent.create({
  provider: mock({
    respond: () => {
      strictCall += 1;
      return strictCall === 1 ? { content: '', toolCalls: [{ id: 'a', name: 'get_refund', args: { orderId: 42 } }] } : { content: 'Sorry.' };
    },
  }),
  model: 'mock',
})
  .tool(strict)
  .build();
strictAgent.on('agentfootprint.validation.args_invalid', (event) => invalid.push(event.payload.toolName));
await strictAgent.run({ message: 'go' });

/* An id the run produced, whose lookup came back empty: an advisory. */
export const advisories: string[] = [];
const find = defineTool({ name: 'find_order', description: 'Find an order.', inputSchema: { type: 'object', properties: {} }, execute: () => ({ orderId: 'A-1042' }) });
const lookup = defineTool({
  name: 'lookup_order',
  description: 'Look an order up.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  argumentsFrom: ['find_order'],
  execute: () => [],
});
let emptyCall = 0;
const emptyAgent = Agent.create({
  provider: mock({
    respond: () => {
      emptyCall += 1;
      if (emptyCall === 1) return { content: '', toolCalls: [{ id: 'a', name: 'find_order', args: {} }] };
      if (emptyCall === 2) return { content: '', toolCalls: [{ id: 'b', name: 'lookup_order', args: { orderId: 'A-1042' } }] };
      return { content: 'Nothing found.' };
    },
  }),
  model: 'mock',
  noticeEmptyLookups: true,
})
  .tool(find)
  .tool(lookup)
  .build();
emptyAgent.on('agentfootprint.integrity.context_error', (event) => advisories.push(event.payload.kind));
await emptyAgent.run({ message: 'go' });

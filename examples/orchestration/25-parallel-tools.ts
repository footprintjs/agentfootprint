/**
 * Sample 25: Parallel Tool Execution Within a Turn
 *
 * When the LLM requests multiple independent tool calls in one turn, firing them
 * concurrently (instead of sequentially) can shave hundreds of ms off the turn.
 *
 * `.parallelTools(true)` on the Agent builder flips execution from `for (call of calls)`
 * to `Promise.all(calls.map(...))`. Result messages are still appended in the order the
 * LLM requested — only the wait changes.
 *
 *   Sequential: getCustomer (80ms) → getOrders (120ms) → getProduct (60ms)  ≈ 260ms
 *   Parallel:   Promise.all([getCustomer, getOrders, getProduct])           ≈ 120ms
 */
import { Agent, mock, defineTool } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getCustomer = defineTool({
  id: 'get_customer',
  description: 'Fetch customer record',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  handler: async () => {
    await delay(80);
    return { content: JSON.stringify({ name: 'Alice Chen', tier: 'premium' }) };
  },
});

const getOrders = defineTool({
  id: 'get_orders',
  description: 'Fetch recent orders',
  inputSchema: { type: 'object', properties: { customerId: { type: 'string' } } },
  handler: async () => {
    await delay(120);
    return { content: JSON.stringify({ orders: [{ id: 'ORD-1', amount: 129.99 }] }) };
  },
});

const getProduct = defineTool({
  id: 'get_product',
  description: 'Fetch product info',
  inputSchema: { type: 'object', properties: { sku: { type: 'string' } } },
  handler: async () => {
    await delay(60);
    return { content: JSON.stringify({ sku: 'WIDGET-A', price: 49.99, stock: 42 }) };
  },
});

export async function run(input: string) {
  const obs = agentObservability();

  const agent = Agent.create({
    provider: mock([
      {
        content: 'Let me gather context in parallel.',
        toolCalls: [
          { id: 'c1', name: 'get_customer', arguments: { id: 'cust-42' } },
          { id: 'c2', name: 'get_orders', arguments: { customerId: 'cust-42' } },
          { id: 'c3', name: 'get_product', arguments: { sku: 'WIDGET-A' } },
        ],
      },
      { content: 'Alice Chen (premium) has 1 recent order for WIDGET-A — 42 in stock.' },
    ]),
  })
    .system('You are a support agent. Gather context tools in parallel when independent.')
    .tools([getCustomer, getOrders, getProduct])
    .parallelTools(true) //  ← the toggle
    .recorder(obs)
    .build();

  const start = Date.now();
  const result = await agent.run(input);
  const elapsedMs = Date.now() - start;

  return {
    content: result.content,
    elapsedMs,
    tools: obs.tools(),
  };
}

if (process.argv[1] === import.meta.filename) {
  run('what do we know about customer cust-42?').then((r) => {
    console.log(r);
    console.log(`\nElapsed: ${r.elapsedMs}ms  (sequential would be ~260ms)`);
  });
}

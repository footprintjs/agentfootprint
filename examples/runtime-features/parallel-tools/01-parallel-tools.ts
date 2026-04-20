/**
 * .parallelTools(true) — execute independent tool calls concurrently
 * within a single turn via Promise.all, instead of sequentially.
 *
 *   Sequential: getCustomer (80ms) → getOrders (120ms) → getProduct (60ms)  ≈ 260ms
 *   Parallel:   Promise.all([getCustomer, getOrders, getProduct])           ≈ 120ms
 *
 * Result messages are appended in the order the LLM requested — only the wait changes.
 */

import { Agent, mock, defineTool } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli';

export const meta: ExampleMeta = {
  id: 'runtime-features/parallel-tools/01-parallel-tools',
  title: 'Parallel tool execution within a turn',
  group: 'runtime-features',
  description: 'Independent tool calls in one turn execute concurrently via Promise.all.',
  defaultInput: 'what do we know about customer cust-42?',
  providerSlots: ['default'],
  tags: ['parallel-tools', 'performance', 'runtime'],
};

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

const defaultMock = (): LLMProvider =>
  mock([
    {
      content: 'Let me gather context in parallel.',
      toolCalls: [
        { id: 'c1', name: 'get_customer', arguments: { id: 'cust-42' } },
        { id: 'c2', name: 'get_orders', arguments: { customerId: 'cust-42' } },
        { id: 'c3', name: 'get_product', arguments: { sku: 'WIDGET-A' } },
      ],
    },
    { content: 'Alice Chen (premium) has 1 recent order for WIDGET-A — 42 in stock.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const obs = agentObservability();

  const agent = Agent.create({ provider: provider ?? defaultMock() })
    .system('You are a support agent. Gather context tools in parallel when independent.')
    .tools([getCustomer, getOrders, getProduct])
    .parallelTools(true)
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

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

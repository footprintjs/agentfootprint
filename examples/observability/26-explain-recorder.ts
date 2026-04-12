/**
 * Sample 26: ExplainRecorder — Collect Grounding Evidence
 *
 * Captures sources (tool results), claims (LLM responses), and
 * decisions (tool calls) during traversal. No post-processing.
 *
 * Run: npx tsx examples/observability/26-explain-recorder.ts
 */
import { Agent, mock, defineTool } from 'agentfootprint';
import { ExplainRecorder } from 'agentfootprint/observe';

const lookupOrder = defineTool({
  id: 'lookup_order',
  description: 'Look up an order by ID.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
  handler: async (input) => ({
    content: JSON.stringify({ orderId: (input as Record<string, string>).orderId, status: 'shipped', amount: 299 }),
  }),
});

export async function run() {
  const explain = new ExplainRecorder();

  const agent = Agent.create({
    provider: mock([
      { content: '', toolCalls: [{ id: 'tc1', name: 'lookup_order', arguments: { orderId: 'ORD-1003' } }] },
      { content: 'Your order ORD-1003 has shipped. Total: $299.' },
    ]),
  })
    .system('You are a support agent.')
    .tool(lookupOrder)
    .recorder(explain)
    .build();

  await agent.run('Check order ORD-1003');

  const sources = explain.getSources();
  console.log(`Sources: ${sources.length}`);
  console.log(`  Tool: ${sources[0]?.toolName}, Result: ${sources[0]?.result}`);

  const claims = explain.getClaims();
  console.log(`Claims: ${claims.length}`);
  console.log(`  Content: ${claims[0]?.content}`);

  const report = explain.explain();
  console.log(`Iterations: ${report.iterations.length}`);
  console.log(`Decisions: ${report.decisions.length}`);
  console.log(`Summary: ${report.summary}`);
}

if (process.argv[1] === import.meta.filename) {
  run().then(() => console.log('Done.'));
}

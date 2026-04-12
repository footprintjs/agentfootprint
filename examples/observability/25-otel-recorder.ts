/**
 * Sample 25: Observability Recorders — Cost, Token, Turn Tracking
 *
 * Shows CostRecorder, TokenRecorder, and TurnRecorder working together.
 * These values would normally be exported as OTel span attributes.
 *
 * Run: npx tsx examples/observability/25-otel-recorder.ts
 */
import { Agent, mock, defineTool } from 'agentfootprint';
import { CostRecorder, TokenRecorder, TurnRecorder } from 'agentfootprint/observe';

const searchTool = defineTool({
  id: 'search',
  description: 'Search.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async (input) => ({ content: `Result: ${(input as Record<string, string>).q}` }),
});

export async function run() {
  const cost = new CostRecorder();
  const tokens = new TokenRecorder();
  const turns = new TurnRecorder();

  const agent = Agent.create({
    provider: mock([
      { content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'footprintjs' } }] },
      { content: 'FootprintJS is a flowchart library.' },
    ]),
  })
    .system('Search and answer.')
    .tool(searchTool)
    .recorder(cost)
    .recorder(tokens)
    .recorder(turns)
    .build();

  await agent.run('What is footprintjs?');

  console.log('Metrics:');
  console.log(`  Turns: ${turns.getCompletedCount()}`);
  console.log(`  LLM calls: ${tokens.getStats().totalCalls}`);
  console.log(`  Total cost: $${cost.getTotalCost().toFixed(4)}`);
}

if (process.argv[1] === import.meta.filename) {
  run().then(() => console.log('Done.'));
}

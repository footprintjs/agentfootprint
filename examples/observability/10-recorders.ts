/**
 * Sample 10: Recorders Overview
 *
 * agentObservability() — one call for tokens, tools, cost, and grounding.
 * Wraps TokenRecorder + ToolUsageRecorder + CostRecorder + ExplainRecorder.
 */
import { Agent, mock, defineTool } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';

const lookupTool = defineTool({
  id: 'lookup',
  description: 'Look up a fact',
  inputSchema: { type: 'object', properties: { topic: { type: 'string' } } },
  handler: async ({ topic }: { topic: string }) => ({ content: `${topic}: 42` }),
});

export async function run(input: string) {
  const obs = agentObservability();

  const runner = Agent
    .create({ provider: mock([
      { content: 'Let me look that up.', toolCalls: [{ id: '1', name: 'lookup', arguments: { topic: 'answer' } }] },
      { content: 'The answer is 42.' },
    ]) })
    .system('You are a helpful assistant.')
    .tool(lookupTool)
    .recorder(obs)
    .build();

  await runner.run(input);

  return {
    tokens: obs.tokens(),
    tools: obs.tools(),
    cost: obs.cost(),
    explain: obs.explain(),
  };
}

if (process.argv[1] === import.meta.filename) {
  run('What is the answer?').then(console.log);
}

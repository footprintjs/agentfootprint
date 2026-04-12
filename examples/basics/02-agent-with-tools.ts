/**
 * Sample 02: Agent with Tools
 *
 * Agent builder + tools + agentObservability — full ReAct loop.
 * The LLM calls a tool, gets results, then produces a final answer.
 */
import { Agent, mock, defineTool } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web for information',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  handler: async ({ query }: { query: string }) => ({ content: `Results for "${query}": AI is transformative, ML powers modern apps` }),
});

export async function run(input: string) {
  const obs = agentObservability();

  const runner = Agent
    .create({ provider: mock([
      { content: 'Let me search for that.', toolCalls: [{ id: '1', name: 'search', arguments: { query: 'artificial intelligence' } }] },
      { content: 'Based on my research: AI is transformative technology that powers modern applications.' },
    ]) })
    .system('You are a research assistant. Use the search tool to find information.')
    .tool(searchTool)
    .recorder(obs)
    .build();

  const result = await runner.run(input);
  return { content: result.content, tokens: obs.tokens(), tools: obs.tools(), cost: obs.cost() };
}

if (process.argv[1] === import.meta.filename) {
  run('Tell me about AI.').then(console.log);
}

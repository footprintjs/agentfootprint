/**
 * Sample 18: Streaming Events — Real-Time Lifecycle
 *
 * The 9-event discriminated union for building CLI/web/mobile UX.
 * Events fire for tool lifecycle (start/end), LLM lifecycle (start/end),
 * and turn boundaries.
 *
 * Run: npx tsx examples/orchestration/18-streaming-events.ts
 */
import { Agent, mock, defineTool } from 'agentfootprint';
import type { AgentStreamEvent } from 'agentfootprint';

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async (input) => ({ content: `Results for ${(input as Record<string, string>).q}` }),
});

export async function run() {
  const events: AgentStreamEvent[] = [];

  const agent = Agent.create({
    provider: mock([
      { content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'weather SF' } }] },
      { content: 'It is 72°F in San Francisco.' },
    ]),
  })
    .system('You search and answer.')
    .tool(searchTool)
    .build();

  await agent.run('What is the weather in SF?', { onEvent: (e) => events.push(e) });

  console.log('Events received:');
  for (const e of events) console.log(`  ${e.type}`);
  console.log(`Total: ${events.length} events`);
}

if (process.argv[1] === import.meta.filename) {
  run().then(() => console.log('Done.'));
}

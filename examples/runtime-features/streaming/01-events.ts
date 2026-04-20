/**
 * Streaming — the 9-event AgentStreamEvent union for building real-time
 * UX (CLI / web / mobile). Events fire for turn, LLM, and tool lifecycles.
 */

import { Agent, mock, defineTool } from 'agentfootprint';
import type { AgentStreamEvent, LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli';

export const meta: ExampleMeta = {
  id: 'runtime-features/streaming/01-events',
  title: 'AgentStreamEvent — lifecycle events',
  group: 'runtime-features',
  description: 'Subscribe to the 9-event discriminated union during agent execution.',
  defaultInput: 'What is the weather in SF?',
  providerSlots: ['default'],
  tags: ['streaming', 'AgentStreamEvent', 'runtime'],
};

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async (input) => ({ content: `Results for ${(input as Record<string, string>).q}` }),
});

const defaultMock = (): LLMProvider =>
  mock([
    { content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'weather SF' } }] },
    { content: 'It is 72°F in San Francisco.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const events: AgentStreamEvent[] = [];

  const agent = Agent.create({ provider: provider ?? defaultMock() })
    .system('You search and answer.')
    .tool(searchTool)
    .build();

  await agent.run(input, { onEvent: (e) => events.push(e) });

  return {
    eventTypes: events.map((e) => e.type),
    totalEvents: events.length,
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

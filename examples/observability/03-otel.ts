/**
 * CostRecorder + TokenRecorder + TurnRecorder — the OTel-style metrics
 * bundle. In production these values become OTel span attributes.
 */

import { Agent, mock, defineTool } from 'agentfootprint';
import { CostRecorder, TokenRecorder, TurnRecorder } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'observability/03-otel',
  title: 'Cost + Token + Turn recorders',
  group: 'observability',
  description: 'OTel-style metrics bundle — cost, tokens, turns.',
  defaultInput: 'What is footprintjs?',
  providerSlots: ['default'],
  tags: ['observability', 'otel', 'metrics', 'cost'],
};

const searchTool = defineTool({
  id: 'search',
  description: 'Search.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async (input) => ({ content: `Result: ${(input as Record<string, string>).q}` }),
});

const defaultMock = (): LLMProvider =>
  mock([
    { content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'footprintjs' } }] },
    { content: 'FootprintJS is a flowchart library.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const cost = new CostRecorder();
  const tokens = new TokenRecorder();
  const turns = new TurnRecorder();

  const agent = Agent.create({ provider: provider ?? defaultMock() })
    .system('Search and answer.')
    .tool(searchTool)
    .recorder(cost)
    .recorder(tokens)
    .recorder(turns)
    .build();

  await agent.run(input);

  return {
    turns: turns.getCompletedCount(),
    llmCalls: tokens.getStats().totalCalls,
    totalCost: cost.getTotalCost(),
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

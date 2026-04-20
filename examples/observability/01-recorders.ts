/**
 * agentObservability() — one call for tokens, tools, cost, and grounding.
 * Bundles TokenRecorder + ToolUsageRecorder + CostRecorder + ExplainRecorder.
 */

import { Agent, mock, defineTool } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'observability/01-recorders',
  title: 'agentObservability() — one-call bundle',
  group: 'observability',
  description: 'Tokens, tools, cost, and grounding — all recorders in one attachment.',
  defaultInput: 'What is the answer?',
  providerSlots: ['default'],
  tags: ['observability', 'recorders'],
};

const lookupTool = defineTool({
  id: 'lookup',
  description: 'Look up a fact',
  inputSchema: { type: 'object', properties: { topic: { type: 'string' } } },
  handler: async ({ topic }: { topic: string }) => ({ content: `${topic}: 42` }),
});

const defaultMock = (): LLMProvider =>
  mock([
    { content: 'Let me look that up.', toolCalls: [{ id: '1', name: 'lookup', arguments: { topic: 'answer' } }] },
    { content: 'The answer is 42.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const obs = agentObservability();

  const runner = Agent.create({ provider: provider ?? defaultMock() })
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

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

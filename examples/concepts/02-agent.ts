/**
 * Agent — LLMCall + a tool-use loop (ReAct). The agent calls tools
 * repeatedly until it decides it has enough information to respond.
 *
 * This is the second rung. The shape is identical to LLMCall — you just
 * add `.tool(...)` and the loop appears automatically.
 */

import { Agent, mock, defineTool } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'concepts/02-agent',
  title: 'Agent with a tool (ReAct)',
  group: 'concepts',
  description: 'Agent calls a tool, reads the result, then produces a final answer.',
  defaultInput: 'What is 17 + 25?',
  providerSlots: ['default'],
  tags: ['Agent', 'tools', 'ReAct'],
};

// Deterministic tool — easy to verify the agent's grounding.
const addTool = defineTool({
  id: 'add',
  description: 'Add two integers and return the sum.',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
  },
  handler: async ({ a, b }: { a: number; b: number }) => ({ content: String(a + b) }),
});

const defaultMock = (): LLMProvider =>
  mock([
    {
      content: 'Let me compute that.',
      toolCalls: [{ id: 'tc1', name: 'add', arguments: { a: 17, b: 25 } }],
    },
    { content: 'The sum of 17 and 25 is 42.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const obs = agentObservability();

  const runner = Agent.create({ provider: provider ?? defaultMock() })
    .system('You are a math assistant. Use the add tool for arithmetic.')
    .tool(addTool)
    .recorder(obs)
    .build();

  const result = await runner.run(input);
  return {
    content: result.content,
    iterations: result.iterations,
    tokens: obs.tokens(),
    tools: obs.tools(),
    cost: obs.cost(),
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

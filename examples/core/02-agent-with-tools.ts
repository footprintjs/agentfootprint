/**
 * 02 — Agent with tools: ReAct loop + tool execution.
 *
 * `Agent` is the full ReAct primitive. Each iteration:
 *   LLM call → route → [tool-calls → loop] or [final answer].
 * Tools register with a JSON schema + execute function.
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'v2/core/02-agent-with-tools',
  title: 'Agent + tools (ReAct)',
  group: 'v2-core',
  description:
    'Agent primitive with a tool registry. Each iteration: LLM call → route → tool-calls loop, or final.',
  defaultInput: 'Weather in SF?',
  providerSlots: ['default'],
  tags: ['v2', 'primitive', 'Agent', 'tools', 'ReAct'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const agent = Agent.create({
    // 'feature' kind drives the smart tool-call flow: first iteration
    // calls the first registered tool, second returns a final answer.
    // No per-example scripted respond needed.
    provider: provider ?? exampleProvider('feature'),
    model: 'mock',
    maxIterations: 5,
  })
    .system('You answer weather questions using the `weather` tool.')
    .tool({
      schema: {
        name: 'weather',
        description: 'Get current weather for a city.',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
      execute: async (args) => `${(args as { city: string }).city}: sunny, 72°F`,
    })
    .build();

  agent.on('agentfootprint.stream.tool_start', (e) =>
    console.log(`→ tool ${e.payload.toolName}(${JSON.stringify(e.payload.args)})`),
  );
  agent.on('agentfootprint.stream.tool_end', (e) =>
    console.log(`← tool result: ${e.payload.result}`),
  );
  agent.on('agentfootprint.agent.turn_end', (e) =>
    console.log(
      `\n[done] ${e.payload.iterationCount} iterations, ${e.payload.totalInputTokens}+${e.payload.totalOutputTokens} tokens`,
    ),
  );

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') {
    throw new Error('Agent paused — this example has no pauseHere tool.');
  }
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

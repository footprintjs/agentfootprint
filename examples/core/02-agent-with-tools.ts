/**
 * 02 — Agent with tools: ReAct loop + tool execution.
 *
 * `Agent` is the full ReAct primitive. Each iteration:
 *   LLM call → route → [tool-calls → loop] or [final answer].
 * Tools register with a JSON schema + execute function.
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

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

/** Scripted mock — first call requests a tool, second returns the final answer. */
function scriptedProvider(): LLMProvider {
  return {
    name: 'weather-mock',
    complete: async (req) => {
      const hasToolResult = req.messages.some((m) => m.role === 'tool');
      if (hasToolResult) {
        return {
          content: 'Based on the lookup, the weather is sunny at 72°F.',
          toolCalls: [],
          usage: { input: 30, output: 20 },
          stopReason: 'stop',
        };
      }
      return {
        content: "I'll look that up.",
        toolCalls: [{ id: 'c1', name: 'weather', args: { city: 'SF' } }],
        usage: { input: 20, output: 10 },
        stopReason: 'tool_use',
      };
    },
  };
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const agent = Agent.create({
    provider: provider ?? scriptedProvider(),
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

/**
 * 02 — Agent with tools: ReAct loop + tool execution.
 *
 * `Agent` is the full ReAct primitive. Each iteration:
 *   LLM call → route → [tool-calls → loop] or [final answer].
 * Tools register with a JSON schema + execute function.
 */

import { Agent, type LLMProvider, type LLMRequest, type LLMResponse } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'core/02-agent-with-tools',
  title: 'Agent + tools (ReAct)',
  group: 'core',
  description:
    'Agent primitive with a tool registry. Each iteration: LLM call → route → tool-calls loop, or final.',
  defaultInput: 'Weather in SF?',
  providerSlots: ['default'],
  tags: ['primitive', 'Agent', 'tools', 'ReAct'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const agent = Agent.create({
    // The default smart-mock would call `weather` with empty args. This
    // tool needs a `city`, so we supply a respond that extracts it from
    // the user's message ("Weather in SF?" → "SF") on iteration 1, then
    // returns a final answer once the tool result has landed.
    provider: provider ?? exampleProvider('feature', { respond: weatherRespond }),
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

function weatherRespond(req: LLMRequest): Partial<LLMResponse> {
  const lastTool = [...req.messages].reverse().find((m) => m.role === 'tool');
  if (lastTool) return { content: `Got it — ${String(lastTool.content ?? '').trim()}` };

  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
  const city = text.match(/in\s+([A-Z][A-Za-z]+)/)?.[1] ?? 'San Francisco';

  return {
    content: '',
    toolCalls: [{ id: 'call-weather-1', name: 'weather', args: { city } }],
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

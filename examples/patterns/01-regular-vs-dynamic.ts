/**
 * AgentPattern — Regular (default) vs Dynamic ReAct loop.
 *
 * Regular: SystemPrompt / Messages / Tools resolve ONCE before the loop;
 *          each iteration only re-runs CallLLM → Parse → Route → ExecuteTools.
 * Dynamic: All three slots re-evaluate EACH iteration — strategies see
 *          updated `messages` and `loopCount` and can return different
 *          prompt / tools / memory based on what just happened.
 *
 * Use Dynamic when you need progressive authorization, adaptive prompts,
 * or context-dependent tool sets. Otherwise stay on Regular — cheaper.
 */

import { Agent, AgentPattern, mock, defineTool, TokenRecorder, ToolUsageRecorder } from 'agentfootprint';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'patterns/01-regular-vs-dynamic',
  title: 'Regular vs Dynamic ReAct loop',
  group: 'patterns',
  description: 'AgentPattern controls which slots re-evaluate each loop iteration.',
  defaultInput: 'What is the weather in San Francisco?',
  providerSlots: ['default'],
  tags: ['AgentPattern', 'Regular', 'Dynamic', 'ReAct'],
};

const weatherTool = defineTool({
  id: 'get-weather',
  description: 'Get current weather for a city',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
  handler: async ({ city }: { city: string }) => ({
    content: `${city}: 72°F, sunny with a light breeze`,
  }),
});

const unitsTool = defineTool({
  id: 'convert-units',
  description: 'Convert temperature between Fahrenheit and Celsius',
  inputSchema: {
    type: 'object',
    properties: { temp: { type: 'number' }, from: { type: 'string' } },
  },
  handler: async ({ temp, from }: { temp: number; from: string }) => {
    const result = from === 'F' ? ((temp - 32) * 5) / 9 : (temp * 9) / 5 + 32;
    const to = from === 'F' ? 'C' : 'F';
    return { content: `${temp}°${from} = ${Math.round(result)}°${to}` };
  },
});

const defaultMock = (): LLMProvider =>
  mock([
    {
      content: 'Let me check the weather first.',
      toolCalls: [{ id: 'tc-1', name: 'get-weather', arguments: { city: 'San Francisco' } }],
    },
    {
      content: 'Now let me convert to Celsius.',
      toolCalls: [{ id: 'tc-2', name: 'convert-units', arguments: { temp: 72, from: 'F' } }],
    },
    { content: 'San Francisco is 72°F (22°C), sunny with a light breeze.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const tokens = new TokenRecorder();
  const toolUsage = new ToolUsageRecorder();

  // Build the same agent twice: once Regular, once Dynamic.
  // The narrative differs because Dynamic re-runs the SystemPrompt /
  // Messages / Tools subflows on every iteration.
  const buildAgent = (pattern: AgentPattern) =>
    Agent.create({ provider: provider ?? defaultMock(), name: `weather-agent-${pattern}` })
      .system('You are a weather assistant. Convert temperatures to both F and C.')
      .tool(weatherTool)
      .tool(unitsTool)
      .pattern(pattern)
      .recorder(tokens)
      .recorder(toolUsage)
      .maxIterations(5)
      .build();

  // Run only Regular for the CLI demo (Dynamic would re-prompt the same
  // mock and loop — better demonstrated against a real provider).
  const regular = buildAgent(AgentPattern.Regular);
  const result = await regular.run(input);

  return {
    pattern: 'Regular',
    content: result.content,
    iterations: result.iterations,
    tokenStats: tokens.getStats(),
    toolStats: toolUsage.getStats(),
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

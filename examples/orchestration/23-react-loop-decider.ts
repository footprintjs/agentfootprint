/**
 * Sample 23: Agent ReAct Loop — RouteResponse Decider
 *
 * Demonstrates the agent loop's decider architecture:
 *   ParseResponse -> RouteResponse(decider)
 *     |-- 'tool-calls' -> ExecuteTools subflow
 *     '-- 'final'      -> Finalize ($break)
 *
 * The RouteResponse decider is visible in the flowchart as a diamond.
 * The narrative shows WHY each branch was chosen (tool-calls vs final).
 *
 * This demo uses mock() — no API key required.
 */
import { Agent, mock, defineTool, TokenRecorder, ToolUsageRecorder } from 'agentfootprint';

const weatherTool = defineTool({
  id: 'get-weather',
  description: 'Get current weather for a city',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
  },
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

export async function run(input: string) {
  const tokens = new TokenRecorder();
  const toolUsage = new ToolUsageRecorder();

  // Mock LLM: two tool calls then final answer
  // Turn 1: Agent calls get-weather
  // Turn 2: Agent calls convert-units
  // Turn 3: Final answer (no tools) — RouteResponse routes to 'final'
  const provider = mock([
    {
      content: 'Let me check the weather first.',
      toolCalls: [{ id: 'tc-1', name: 'get-weather', arguments: { city: 'San Francisco' } }],
    },
    {
      content: 'Now let me convert that to Celsius.',
      toolCalls: [{ id: 'tc-2', name: 'convert-units', arguments: { temp: 72, from: 'F' } }],
    },
    {
      content: 'San Francisco is currently 72°F (22°C), sunny with a light breeze. Perfect weather!',
    },
  ]);

  const agent = Agent.create({ provider, name: 'weather-agent' })
    .system('You are a weather assistant. Always convert temperatures to both F and C.')
    .tool(weatherTool)
    .tool(unitsTool)
    .recorder(tokens)
    .recorder(toolUsage)
    .maxIterations(5)
    .build();

  const result = await agent.run(input);

  // Verify no message duplication from the decider pattern
  const systemCount = result.messages.filter((m: any) => m.role === 'system').length;
  const userCount = result.messages.filter((m: any) => m.role === 'user').length;
  const toolCount = result.messages.filter((m: any) => m.role === 'tool').length;

  return {
    content: result.content,
    iterations: result.iterations,
    messages: {
      total: result.messages.length,
      system: systemCount,
      user: userCount,
      tool: toolCount,
      noDuplicates: systemCount === 1 && userCount === 1,
    },
    tokenStats: tokens.getStats(),
    toolStats: toolUsage.getStats(),
    narrative: agent.getNarrative(),
  };
}

if (process.argv[1] === import.meta.filename) {
  run('What is the weather in San Francisco?').then((r) => console.log(JSON.stringify(r, null, 2)));
}

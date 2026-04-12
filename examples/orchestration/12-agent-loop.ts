/**
 * Sample 12: agentLoop() — The Core Engine
 *
 * The lowest-level API. Wire providers and recorders yourself.
 * Agent, FlowChart, Swarm are all built on top of this.
 *
 * Run: npx tsx examples/orchestration/12-agent-loop.ts
 */
import { agentLoop, mock, defineTool } from 'agentfootprint';
import { staticPrompt, fullHistory, staticTools, noTools } from 'agentfootprint/providers';
import { TurnRecorder, TokenRecorder } from 'agentfootprint/observe';
import type { AgentLoopConfig } from 'agentfootprint';

export async function run() {
  const basicConfig: AgentLoopConfig = {
    promptProvider: staticPrompt('You are a helpful assistant.'),
    messageStrategy: fullHistory(),
    toolProvider: noTools(),
    llmProvider: mock([{ content: 'Hello! How can I help?' }]),
    maxIterations: 10,
    recorders: [],
    name: 'basic-agent',
  };

  const result = await agentLoop(basicConfig, 'Hello');
  console.log(`Basic: ${result.content} (${result.loopIterations} iteration)`);

  const weatherTool = defineTool({
    id: 'weather',
    description: 'Get current weather.',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    handler: async (input) => ({ content: `${(input as Record<string, string>).city}: 72F, sunny` }),
  });

  const toolConfig: AgentLoopConfig = {
    promptProvider: staticPrompt('You check the weather.'),
    messageStrategy: fullHistory(),
    toolProvider: staticTools([weatherTool]),
    llmProvider: mock([
      { content: 'Checking.', toolCalls: [{ id: 'tc1', name: 'weather', arguments: { city: 'SF' } }] },
      { content: 'San Francisco is 72F and sunny!' },
    ]),
    maxIterations: 10,
    recorders: [],
    name: 'weather-agent',
  };

  const toolResult = await agentLoop(toolConfig, 'Weather in SF?');
  console.log(`With tools: ${toolResult.content} (${toolResult.loopIterations} iterations)`);

  const turns = new TurnRecorder();
  const tokens = new TokenRecorder();
  const observedConfig: AgentLoopConfig = {
    promptProvider: staticPrompt('Be concise.'),
    messageStrategy: fullHistory(),
    toolProvider: noTools(),
    llmProvider: mock([{ content: 'OK.' }]),
    maxIterations: 10,
    recorders: [turns, tokens],
    name: 'observed',
  };

  await agentLoop(observedConfig, 'Hi');
  console.log(`Observed: ${turns.getCompletedCount()} turns, ${tokens.getStats().totalCalls} calls`);
}

if (process.argv[1] === import.meta.filename) {
  run().then(() => console.log('Done.'));
}

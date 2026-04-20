/**
 * agentLoop() — the lowest-level API. Wire the providers and recorders
 * yourself. Agent, FlowChart, Swarm, RAG are all built on top of this.
 *
 * Reach for this when you need a shape the high-level builders don't
 * support — otherwise use Agent/Swarm/etc. which are less to get wrong.
 */

import { agentLoop, mock, defineTool } from 'agentfootprint';
import { staticPrompt, fullHistory, staticTools, noTools } from 'agentfootprint/providers';
import { TurnRecorder, TokenRecorder } from 'agentfootprint/observe';
import type { AgentLoopConfig, LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'advanced/01-agent-loop',
  title: 'agentLoop() — the engine layer',
  group: 'advanced',
  description: 'Wire providers and recorders manually. What Agent/Swarm wrap internally.',
  defaultInput: '',
  providerSlots: ['default'],
  tags: ['advanced', 'agentLoop', 'engine'],
};

export async function run(_input: string, provider?: LLMProvider) {
  // ── Config 1: Basic, no tools ────────────────────────────────
  const basic = await agentLoop(
    {
      promptProvider: staticPrompt('You are a helpful assistant.'),
      messageStrategy: fullHistory(),
      toolProvider: noTools(),
      llmProvider: provider ?? mock([{ content: 'Hello! How can I help?' }]),
      maxIterations: 10,
      recorders: [],
      name: 'basic-agent',
    } as AgentLoopConfig,
    'Hello',
  );

  // ── Config 2: With a tool ────────────────────────────────────
  const weatherTool = defineTool({
    id: 'weather',
    description: 'Get current weather.',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    handler: async (input) => ({
      content: `${(input as Record<string, string>).city}: 72F, sunny`,
    }),
  });

  const withTool = await agentLoop(
    {
      promptProvider: staticPrompt('You check the weather.'),
      messageStrategy: fullHistory(),
      toolProvider: staticTools([weatherTool]),
      llmProvider:
        provider ??
        mock([
          {
            content: 'Checking.',
            toolCalls: [{ id: 'tc1', name: 'weather', arguments: { city: 'SF' } }],
          },
          { content: 'San Francisco is 72F and sunny!' },
        ]),
      maxIterations: 10,
      recorders: [],
      name: 'weather-agent',
    } as AgentLoopConfig,
    'Weather in SF?',
  );

  // ── Config 3: With recorders ─────────────────────────────────
  const turns = new TurnRecorder();
  const tokens = new TokenRecorder();
  await agentLoop(
    {
      promptProvider: staticPrompt('Be concise.'),
      messageStrategy: fullHistory(),
      toolProvider: noTools(),
      llmProvider: provider ?? mock([{ content: 'OK.' }]),
      maxIterations: 10,
      recorders: [turns, tokens],
      name: 'observed',
    } as AgentLoopConfig,
    'Hi',
  );

  return {
    basic: { content: basic.content, iterations: basic.loopIterations },
    withTool: { content: withTool.content, iterations: withTool.loopIterations },
    observed: { turns: turns.getCompletedCount(), calls: tokens.getStats().totalCalls },
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

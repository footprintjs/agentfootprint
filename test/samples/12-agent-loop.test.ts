/**
 * Sample 12: agentLoop() — The Core Engine
 *
 * The lowest-level API. Wire providers and recorders yourself.
 * Agent, FlowChart, Swarm are all built on top of this.
 *
 * Use agentLoop when you need full control over the loop configuration.
 */
import { describe, it, expect } from 'vitest';
import {
  agentLoop,
  mock,
  staticPrompt,
  templatePrompt,
  skillBasedPrompt,
  defineTool,
} from '../../src/test-barrel';
import type { AgentLoopConfig } from '../../src/test-barrel';
import {
  fullHistory,
  slidingWindow,
  staticTools,
  noTools,
  withToolPairSafety,
} from '../../src/providers';
import { TurnRecorder, TokenRecorder } from '../../src/recorders/v2';

describe('Sample 12: agentLoop', () => {
  it('basic: prompt + messages + LLM', async () => {
    const config: AgentLoopConfig = {
      promptProvider: staticPrompt('You are a helpful assistant.'),
      messageStrategy: fullHistory(),
      toolProvider: noTools(),
      llmProvider: mock([{ content: 'Hello! How can I help?' }]),
      maxIterations: 10,
      recorders: [],
      name: 'basic-agent',
    };

    const result = await agentLoop(config, 'Hello');
    expect(result.content).toBe('Hello! How can I help?');
    expect(result.loopIterations).toBe(1);
  });

  it('with tools: LLM calls a tool, then responds', async () => {
    const weatherTool = defineTool({
      id: 'weather',
      description: 'Get current weather.',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      handler: async (input) => ({ content: `${input.city}: 72°F, sunny` }),
    });

    const config: AgentLoopConfig = {
      promptProvider: staticPrompt('You check the weather.'),
      messageStrategy: fullHistory(),
      toolProvider: staticTools([weatherTool]),
      llmProvider: mock([
        {
          content: 'Checking weather.',
          toolCalls: [{ id: 'tc1', name: 'weather', arguments: { city: 'SF' } }],
        },
        { content: 'San Francisco is 72°F and sunny!' },
      ]),
      maxIterations: 10,
      recorders: [],
      name: 'weather-agent',
    };

    const result = await agentLoop(config, 'Weather in SF?');
    expect(result.content).toContain('72°F');
    expect(result.loopIterations).toBe(2);
  });

  it('multi-turn: pass history between calls', async () => {
    const config: AgentLoopConfig = {
      promptProvider: staticPrompt('Remember the conversation.'),
      messageStrategy: fullHistory(),
      toolProvider: noTools(),
      llmProvider: mock([
        { content: 'Hi! I am AI.' },
        { content: 'You said hello and asked about me.' },
      ]),
      maxIterations: 10,
      recorders: [],
      name: 'multi-turn',
    };

    // Turn 1
    const turn1 = await agentLoop(config, 'Hello, who are you?');
    expect(turn1.content).toBe('Hi! I am AI.');

    // Turn 2 — pass previous history
    const turn2 = await agentLoop(config, 'What did I ask?', {
      history: turn1.messages,
      turnNumber: 1,
    });
    expect(turn2.content).toContain('said hello');
    expect(turn2.messages).toHaveLength(4); // 2 per turn
  });

  it('with recorders: observe execution', async () => {
    const turns = new TurnRecorder();
    const tokens = new TokenRecorder();

    const config: AgentLoopConfig = {
      promptProvider: staticPrompt('Be concise.'),
      messageStrategy: fullHistory(),
      toolProvider: noTools(),
      llmProvider: mock([{ content: 'OK.' }]),
      maxIterations: 10,
      recorders: [turns, tokens],
      name: 'observed',
    };

    await agentLoop(config, 'Hi');

    expect(turns.getCompletedCount()).toBe(1);
    expect(tokens.getStats().totalCalls).toBe(1);
  });

  it('with dynamic prompt: adapts per turn', async () => {
    const config: AgentLoopConfig = {
      promptProvider: skillBasedPrompt(
        [
          {
            id: 'code',
            content: 'You write clean code.',
            match: (ctx) => ctx.message.includes('code'),
          },
        ],
        { base: 'You are an assistant.' },
      ),
      messageStrategy: slidingWindow({ maxMessages: 20 }),
      toolProvider: noTools(),
      llmProvider: mock([{ content: 'Here is the code.' }]),
      maxIterations: 10,
      recorders: [],
      name: 'dynamic',
    };

    const result = await agentLoop(config, 'Write some code');
    expect(result.content).toBe('Here is the code.');
  });
});

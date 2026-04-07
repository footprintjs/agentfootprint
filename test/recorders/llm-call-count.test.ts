import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src/index';
import { agentObservability } from '../../src/observe.barrel';

describe('LLM call count via agentObservability', () => {
  it('counts 2 LLM calls when agent uses one tool', async () => {
    const provider = mock([
      // Call 1: decide to use tool
      { content: '', toolCalls: [{ id: 'tc1', name: 'get_time', arguments: {} }] },
      // Call 2: final response
      { content: 'The time is 3pm', usage: { inputTokens: 100, outputTokens: 50 } },
    ]);

    const tool = defineTool({
      id: 'get_time',
      description: 'Get current time',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ content: 'It is 3:00 PM' }),
    });

    const obs = agentObservability();
    const agent = Agent.create({ provider })
      .system('You are helpful')
      .tool(tool)
      .recorder(obs)
      .build();

    const result = await agent.run('What time is it?');

    expect(result.content).toBe('The time is 3pm');
    expect(obs.tokens().totalCalls).toBe(2);
  });

  it('counts 1 LLM call when agent answers directly (no tools)', async () => {
    const provider = mock([{ content: 'Hello!', usage: { inputTokens: 10, outputTokens: 5 } }]);

    const obs = agentObservability();
    const agent = Agent.create({ provider }).system('You are helpful').recorder(obs).build();

    await agent.run('Hi');

    expect(obs.tokens().totalCalls).toBe(1);
    expect(obs.tokens().totalInputTokens).toBe(10);
    expect(obs.tokens().totalOutputTokens).toBe(5);
  });
});

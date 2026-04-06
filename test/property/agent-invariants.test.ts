import { describe, it, expect } from 'vitest';
import {
  Agent,
  mock,
  defineTool,
  normalizeAdapterResponse,
  executeToolCalls,
  ToolRegistry,
} from '../../src/test-barrel';
import type { LLMResponse, Message } from '../../src/test-barrel';

describe('Property: Agent state isolation across runs', () => {
  it('each run starts with fresh loop count', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'First' }, { content: 'Second' }]),
    }).build();

    const r1 = await agent.run('msg1');
    const r2 = await agent.run('msg2');

    expect(r1.iterations).toBe(0);
    expect(r2.iterations).toBe(0);
  });

  it('conversation history grows monotonically across runs', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'A' }, { content: 'B' }, { content: 'C' }]),
    }).build();

    const r1 = await agent.run('msg1');
    const r2 = await agent.run('msg2');
    const r3 = await agent.run('msg3');

    expect(r1.messages.length).toBeLessThan(r2.messages.length);
    expect(r2.messages.length).toBeLessThan(r3.messages.length);
  });
});

describe('Property: Tool execution ordering', () => {
  it('tool results appear in same order as tool calls', async () => {
    const registry = new ToolRegistry();
    for (let i = 0; i < 5; i++) {
      registry.register(
        defineTool({
          id: `tool-${i}`,
          description: `Tool ${i}`,
          inputSchema: {},
          handler: async () => ({ content: `result-${i}` }),
        }),
      );
    }

    const toolCalls = Array.from({ length: 5 }, (_, i) => ({
      id: `tc-${i}`,
      name: `tool-${i}`,
      arguments: {},
    }));

    const msgs: Message[] = [{ role: 'user', content: 'go' }];
    const result = await executeToolCalls(toolCalls, registry, msgs);

    // Tool results should be in order after the original message
    for (let i = 0; i < 5; i++) {
      expect(result[i + 1].content).toBe(`result-${i}`);
    }
  });

  it('executeToolCalls result length equals input length + tool count', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'x',
        description: 'X',
        inputSchema: {},
        handler: async () => ({ content: 'ok' }),
      }),
    );

    for (let n = 0; n <= 10; n++) {
      const toolCalls = Array.from({ length: n }, (_, i) => ({
        id: `tc-${i}`,
        name: 'x',
        arguments: {},
      }));
      const msgs: Message[] = [{ role: 'user', content: 'go' }];
      const result = await executeToolCalls(toolCalls, registry, msgs);
      expect(result.length).toBe(1 + n);
    }
  });
});

describe('Property: normalizeAdapterResponse is pure', () => {
  it('same input always produces same output', () => {
    const response: LLMResponse = {
      content: 'Hello',
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'test',
    };

    const r1 = normalizeAdapterResponse(response);
    const r2 = normalizeAdapterResponse(response);
    expect(r1).toEqual(r2);
  });

  it('does not mutate input', () => {
    const response: LLMResponse = {
      content: 'Hello',
      toolCalls: [{ id: 'tc', name: 'x', arguments: {} }],
    };
    const original = JSON.parse(JSON.stringify(response));
    normalizeAdapterResponse(response);
    expect(response).toEqual(original);
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  normalizeAdapterResponse,
  executeToolCalls,
  ToolRegistry,
  defineTool,
} from '../../src/test-barrel';
import type { LLMResponse } from '../../src/test-barrel';

describe('normalizeAdapterResponse', () => {
  it('returns "final" result when no tool calls', () => {
    const response: LLMResponse = {
      content: 'Hello!',
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'gpt-4o',
    };
    const result = normalizeAdapterResponse(response);
    expect(result.type).toBe('final');
    expect(result.content).toBe('Hello!');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.model).toBe('gpt-4o');
  });

  it('returns "tools" result when tool calls present', () => {
    const response: LLMResponse = {
      content: 'Let me search.',
      toolCalls: [{ id: 'tc-1', name: 'search', arguments: { q: 'test' } }],
      usage: { inputTokens: 20, outputTokens: 10 },
      model: 'claude-3-opus',
    };
    const result = normalizeAdapterResponse(response);
    expect(result.type).toBe('tools');
    if (result.type === 'tools') {
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('search');
    }
  });

  it('returns "final" when toolCalls is empty array', () => {
    const response: LLMResponse = {
      content: 'Done.',
      toolCalls: [],
    };
    const result = normalizeAdapterResponse(response);
    expect(result.type).toBe('final');
  });

  it('defaults content to empty string for tools result', () => {
    const response = {
      content: undefined as any,
      toolCalls: [{ id: 'tc-1', name: 'x', arguments: {} }],
    } as LLMResponse;
    const result = normalizeAdapterResponse(response);
    expect(result.type).toBe('tools');
    expect(result.content).toBe('');
  });

  it('preserves undefined usage and model', () => {
    const response: LLMResponse = { content: 'Hi' };
    const result = normalizeAdapterResponse(response);
    expect(result.usage).toBeUndefined();
    expect(result.model).toBeUndefined();
  });
});

describe('executeToolCalls', () => {
  it('executes tools and appends results to messages', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'echo',
        description: 'Echo back',
        inputSchema: {},
        handler: async (args) => ({ content: `echo: ${JSON.stringify(args)}` }),
      }),
    );

    const toolCalls = [{ id: 'tc-1', name: 'echo', arguments: { msg: 'hello' } }];
    const messages = [{ role: 'user' as const, content: 'test' }];
    const result = await executeToolCalls(toolCalls, registry, messages);

    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('tool');
    expect(result[1].content).toContain('echo:');
  });

  it('returns error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const toolCalls = [{ id: 'tc-1', name: 'missing', arguments: {} }];
    const result = await executeToolCalls(toolCalls, registry, []);

    expect(result).toHaveLength(1);
    const parsed = JSON.parse(result[0].content);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toContain("'missing' not found");
  });

  it('catches tool handler errors', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'broken',
        description: 'Broken',
        inputSchema: {},
        handler: () => {
          throw new Error('boom');
        },
      }),
    );

    const toolCalls = [{ id: 'tc-1', name: 'broken', arguments: {} }];
    const result = await executeToolCalls(toolCalls, registry, []);

    expect(result).toHaveLength(1);
    const parsed = JSON.parse(result[0].content);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toBe('boom');
  });

  it('does not mutate original messages array', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'tool',
        description: 'Tool',
        inputSchema: {},
        handler: async () => ({ content: 'ok' }),
      }),
    );

    const original = [{ role: 'user' as const, content: 'hi' }];
    const originalLength = original.length;
    await executeToolCalls([{ id: 'tc-1', name: 'tool', arguments: {} }], registry, original);

    expect(original.length).toBe(originalLength);
  });

  it('handles multiple tool calls in order', async () => {
    const order: string[] = [];
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'a',
        description: 'A',
        inputSchema: {},
        handler: async () => {
          order.push('a');
          return { content: 'a-result' };
        },
      }),
    );
    registry.register(
      defineTool({
        id: 'b',
        description: 'B',
        inputSchema: {},
        handler: async () => {
          order.push('b');
          return { content: 'b-result' };
        },
      }),
    );

    const toolCalls = [
      { id: 'tc-1', name: 'a', arguments: {} },
      { id: 'tc-2', name: 'b', arguments: {} },
    ];
    const result = await executeToolCalls(toolCalls, registry, []);

    expect(order).toEqual(['a', 'b']);
    expect(result).toHaveLength(2);
  });
});

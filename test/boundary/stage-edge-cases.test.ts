import { describe, it, expect, vi } from 'vitest';
import {
  Agent,
  LLMCall,
  mock,
  defineTool,
  createCallLLMStage,
  parseResponseStage,
  normalizeAdapterResponse,
  executeToolCalls,
  ToolRegistry,
} from '../../src/test-barrel';
import type { LLMResponse } from '../../src/test-barrel';
import type { TypedScope } from 'footprintjs';
import type { RAGState } from '../../src/scope/types';

function mockScope(initial: Partial<RAGState> = {}): TypedScope<RAGState> {
  const obj: any = { ...initial };
  obj.$getValue = vi.fn((key: string) => obj[key]);
  obj.$setValue = vi.fn((key: string, value: unknown) => {
    obj[key] = value;
  });
  return obj as TypedScope<RAGState>;
}

describe('Boundary: normalizeAdapterResponse edge cases', () => {
  it('handles response with no content field', () => {
    const response = {} as LLMResponse;
    const result = normalizeAdapterResponse(response);
    expect(result.type).toBe('final');
    expect(result.content).toBeUndefined();
  });

  it('handles response with undefined toolCalls', () => {
    const response: LLMResponse = { content: 'Hi', toolCalls: undefined };
    const result = normalizeAdapterResponse(response);
    expect(result.type).toBe('final');
  });
});

describe('Boundary: executeToolCalls edge cases', () => {
  it('handles empty tool calls array', async () => {
    const registry = new ToolRegistry();
    const result = await executeToolCalls([], registry, []);
    expect(result).toEqual([]);
  });

  it('handles tool that returns empty string', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'empty',
        description: 'E',
        inputSchema: {},
        handler: async () => ({ content: '' }),
      }),
    );
    const result = await executeToolCalls(
      [{ id: 'tc', name: 'empty', arguments: {} }],
      registry,
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('');
  });

  it('handles tool that throws non-Error', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'str-throw',
        description: 'T',
        inputSchema: {},
        handler: () => {
          throw 'string-error'; // eslint-disable-line no-throw-literal
        },
      }),
    );
    const result = await executeToolCalls(
      [{ id: 'tc', name: 'str-throw', arguments: {} }],
      registry,
      [],
    );
    const parsed = JSON.parse(result[0].content);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toBe('string-error');
  });
});

describe('Boundary: parseResponse with error types', () => {
  it('includes error code in thrown message', () => {
    const scope = mockScope({
      adapterResult: {
        type: 'error',
        code: 'context_length_exceeded',
        message: 'Too many tokens',
        retryable: false,
      },
    });
    expect(() => parseResponseStage(scope)).toThrow('context_length_exceeded');
  });
});

describe('Boundary: LLMCall with signal/timeout', () => {
  it('passes signal to executor', async () => {
    const controller = new AbortController();
    controller.abort();

    const caller = LLMCall.create({ provider: mock([{ content: 'Hi' }]) }).build();
    await expect(caller.run('test', { signal: controller.signal })).rejects.toThrow();
  });
});

describe('Boundary: Agent with zero tool registrations', () => {
  it('runs without tools successfully', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'No tools needed.' }]),
    }).build();

    const result = await agent.run('Hello');
    expect(result.content).toBe('No tools needed.');
    expect(result.iterations).toBe(0);
  });
});

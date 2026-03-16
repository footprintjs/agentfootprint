import { describe, it, expect, vi } from 'vitest';
import {
  promptAssemblyStage,
  parseResponseStage,
  createSeedScopeStage,
  createHandleResponseStage,
  createCallLLMStage,
  finalizeStage,
  AgentScope,
  ToolRegistry,
  defineTool,
  mock,
} from '../../src';
import type { ScopeFacade } from 'footprintjs';
import type { Message, AdapterResult } from '../../src';

function mockScope(initial: Record<string, unknown> = {}): ScopeFacade {
  const store: Record<string, unknown> = { ...initial };
  return {
    getValue: vi.fn((key: string) => store[key]),
    setValue: vi.fn((key: string, value: unknown) => {
      store[key] = value;
    }),
    updateValue: vi.fn(),
    deleteValue: vi.fn(),
    getArgs: vi.fn(() => ({})),
    attachRecorder: vi.fn(),
  } as unknown as ScopeFacade;
}

describe('promptAssemblyStage', () => {
  it('prepends system message when configured', () => {
    const scope = mockScope({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'Be helpful',
    });
    promptAssemblyStage(scope);
    expect(scope.setValue).toHaveBeenCalled();
    const call = (scope.setValue as any).mock.calls.find((c: any) => c[0] === 'messages');
    expect(call[1][0].role).toBe('system');
    expect(call[1][0].content).toBe('Be helpful');
  });

  it('does not prepend if system message already present', () => {
    const scope = mockScope({
      messages: [
        { role: 'system', content: 'Existing' },
        { role: 'user', content: 'Hi' },
      ],
      systemPrompt: 'Be helpful',
    });
    promptAssemblyStage(scope);
    // Should not have written messages since system already first
    const msgCalls = (scope.setValue as any).mock.calls.filter((c: any) => c[0] === 'messages');
    expect(msgCalls).toHaveLength(0);
  });

  it('does nothing when no system prompt', () => {
    const scope = mockScope({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    promptAssemblyStage(scope);
    const msgCalls = (scope.setValue as any).mock.calls.filter((c: any) => c[0] === 'messages');
    expect(msgCalls).toHaveLength(0);
  });
});

describe('parseResponseStage', () => {
  it('throws when no adapter result', () => {
    const scope = mockScope();
    expect(() => parseResponseStage(scope)).toThrow('no adapter result');
  });

  it('throws on error adapter result', () => {
    const scope = mockScope({
      adapterResult: {
        type: 'error',
        code: 'rate_limit',
        message: 'Too many requests',
        retryable: true,
      },
    });
    expect(() => parseResponseStage(scope)).toThrow('rate_limit');
  });

  it('parses final result correctly', () => {
    const scope = mockScope({
      adapterResult: { type: 'final', content: 'Hello!' },
      messages: [],
    });
    parseResponseStage(scope);
    const parsedCall = (scope.setValue as any).mock.calls.find(
      (c: any) => c[0] === 'parsedResponse',
    );
    expect(parsedCall[1].hasToolCalls).toBe(false);
    expect(parsedCall[1].content).toBe('Hello!');
  });

  it('parses tools result correctly', () => {
    const toolCalls = [{ id: 'tc-1', name: 'search', arguments: { q: 'test' } }];
    const scope = mockScope({
      adapterResult: { type: 'tools', content: 'Searching...', toolCalls },
      messages: [],
    });
    parseResponseStage(scope);
    const parsedCall = (scope.setValue as any).mock.calls.find(
      (c: any) => c[0] === 'parsedResponse',
    );
    expect(parsedCall[1].hasToolCalls).toBe(true);
    expect(parsedCall[1].toolCalls).toEqual(toolCalls);
  });

  it('appends assistant message to conversation', () => {
    const scope = mockScope({
      adapterResult: { type: 'final', content: 'Response' },
      messages: [{ role: 'user', content: 'Question' }],
    });
    parseResponseStage(scope);
    const msgCall = (scope.setValue as any).mock.calls.find((c: any) => c[0] === 'messages');
    expect(msgCall[1]).toHaveLength(2);
    expect(msgCall[1][1].role).toBe('assistant');
  });
});

describe('createSeedScopeStage', () => {
  it('initializes all agent state', () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'search',
        description: 'Search',
        inputSchema: {},
        handler: async () => ({ content: 'ok' }),
      }),
    );

    const stage = createSeedScopeStage({
      agentConfig: {
        name: 'test',
        systemPrompt: 'Be helpful',
        maxIterations: 5,
        toolIds: ['search'],
      },
      toolRegistry: registry,
      userMsg: 'Hello',
    });

    const scope = mockScope();
    stage(scope);

    const calls = (scope.setValue as any).mock.calls;
    const keys = calls.map((c: any) => c[0]);
    expect(keys).toContain('systemPrompt');
    expect(keys).toContain('toolDescriptions');
    expect(keys).toContain('messages');
    expect(keys).toContain('loopCount');
    expect(keys).toContain('maxIterations');
  });

  it('includes existing messages when provided', () => {
    const existing: Message[] = [
      { role: 'user', content: 'previous' },
      { role: 'assistant', content: 'reply' },
    ];

    const stage = createSeedScopeStage({
      agentConfig: { name: 'test', maxIterations: 10, toolIds: [] },
      toolRegistry: new ToolRegistry(),
      userMsg: 'New message',
      existingMessages: existing,
    });

    const scope = mockScope();
    stage(scope);

    const msgCall = (scope.setValue as any).mock.calls.find((c: any) => c[0] === 'messages');
    expect(msgCall[1]).toHaveLength(3); // 2 existing + 1 new
    expect(msgCall[1][2].content).toBe('New message');
  });
});

describe('finalizeStage', () => {
  it('extracts last assistant message as result', () => {
    const scope = mockScope({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Final answer' },
      ],
    });
    finalizeStage(scope);
    const resultCall = (scope.setValue as any).mock.calls.find((c: any) => c[0] === 'result');
    expect(resultCall[1]).toBe('Final answer');
  });

  it('sets empty string when no assistant message', () => {
    const scope = mockScope({ messages: [{ role: 'user', content: 'Hi' }] });
    finalizeStage(scope);
    const resultCall = (scope.setValue as any).mock.calls.find((c: any) => c[0] === 'result');
    expect(resultCall[1]).toBe('');
  });
});

describe('createCallLLMStage', () => {
  it('calls provider and writes adapter result', async () => {
    const provider = mock([{ content: 'Response' }]);
    const stage = createCallLLMStage(provider);

    const scope = mockScope({
      messages: [{ role: 'user', content: 'Hi' }],
      toolDescriptions: [],
    });

    await stage(scope);

    const resultCall = (scope.setValue as any).mock.calls.find(
      (c: any) => c[0] === 'adapterResult',
    );
    expect(resultCall[1].type).toBe('final');
    expect(resultCall[1].content).toBe('Response');
  });
});

describe('createHandleResponseStage', () => {
  it('calls breakPipeline when no tool calls', async () => {
    const registry = new ToolRegistry();
    const stage = createHandleResponseStage(registry);
    const breakPipeline = vi.fn();

    const scope = mockScope({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: 'Done' },
      loopCount: 0,
      maxIterations: 10,
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Done' },
      ],
    });

    await stage(scope, breakPipeline);
    expect(breakPipeline).toHaveBeenCalled();
  });

  it('executes tools and does not break when tool calls present', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'tool',
        description: 'T',
        inputSchema: {},
        handler: async () => ({ content: 'result' }),
      }),
    );
    const stage = createHandleResponseStage(registry);
    const breakPipeline = vi.fn();

    const scope = mockScope({
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc-1', name: 'tool', arguments: {} }],
        content: 'Calling tool',
      },
      loopCount: 0,
      maxIterations: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await stage(scope, breakPipeline);
    expect(breakPipeline).not.toHaveBeenCalled();
    // Should have incremented loop count
    const loopCall = (scope.setValue as any).mock.calls.find((c: any) => c[0] === 'loopCount');
    expect(loopCall[1]).toBe(1);
  });

  it('finalizes when max iterations reached even with tool calls', async () => {
    const registry = new ToolRegistry();
    const stage = createHandleResponseStage(registry);
    const breakPipeline = vi.fn();

    const scope = mockScope({
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc-1', name: 'tool', arguments: {} }],
        content: 'Still working',
      },
      loopCount: 5,
      maxIterations: 5,
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Still working' },
      ],
    });

    await stage(scope, breakPipeline);
    expect(breakPipeline).toHaveBeenCalled();
  });
});

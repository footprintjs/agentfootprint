import { describe, it, expect, vi } from 'vitest';
import {
  parseResponseStage,
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


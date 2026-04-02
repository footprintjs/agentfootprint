import { describe, it, expect, vi } from 'vitest';
import {
  parseResponseStage,
  createCallLLMStage,
  finalizeStage,
  ToolRegistry,
  defineTool,
  mock,
} from '../../src';
import type { TypedScope } from 'footprintjs';
import type { Message, AdapterResult } from '../../src';
import type { RAGState } from '../../src/scope/types';

function mockScope(initial: Partial<RAGState> = {}): TypedScope<RAGState> {
  const obj: any = { ...initial };
  obj.$getValue = vi.fn((key: string) => obj[key]);
  obj.$setValue = vi.fn((key: string, value: unknown) => {
    obj[key] = value;
  });
  return obj as TypedScope<RAGState>;
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
    expect(scope.parsedResponse.hasToolCalls).toBe(false);
    expect(scope.parsedResponse.content).toBe('Hello!');
  });

  it('parses tools result correctly', () => {
    const toolCalls = [{ id: 'tc-1', name: 'search', arguments: { q: 'test' } }];
    const scope = mockScope({
      adapterResult: { type: 'tools', content: 'Searching...', toolCalls },
      messages: [],
    });
    parseResponseStage(scope);
    expect(scope.parsedResponse.hasToolCalls).toBe(true);
    expect(scope.parsedResponse.toolCalls).toEqual(toolCalls);
  });

  it('appends assistant message to conversation', () => {
    const scope = mockScope({
      adapterResult: { type: 'final', content: 'Response' },
      messages: [{ role: 'user', content: 'Question' }],
    });
    parseResponseStage(scope);
    expect(scope.messages).toHaveLength(2);
    expect(scope.messages[1].role).toBe('assistant');
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
    expect(scope.result).toBe('Final answer');
  });

  it('sets empty string when no assistant message', () => {
    const scope = mockScope({ messages: [{ role: 'user', content: 'Hi' }] });
    finalizeStage(scope);
    expect(scope.result).toBe('');
  });
});

describe('createCallLLMStage', () => {
  it('calls provider and writes adapter result', async () => {
    const provider = mock([{ content: 'Response' }]);
    const stage = createCallLLMStage(provider);

    const scope = mockScope({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    await stage(scope);

    expect(scope.adapterResult.type).toBe('final');
    expect((scope.adapterResult as any).content).toBe('Response');
  });
});

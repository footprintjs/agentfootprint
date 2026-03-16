import { describe, it, expect } from 'vitest';
import { mock, userMessage } from '../../src';

describe('MockAdapter', () => {
  it('returns scripted responses in order', async () => {
    const adapter = mock([{ content: 'First' }, { content: 'Second' }]);

    const r1 = await adapter.chat([userMessage('Hi')]);
    expect(r1.content).toBe('First');

    const r2 = await adapter.chat([userMessage('Again')]);
    expect(r2.content).toBe('Second');
  });

  it('throws when responses exhausted', async () => {
    const adapter = mock([{ content: 'Only one' }]);
    await adapter.chat([userMessage('Hi')]);

    await expect(adapter.chat([userMessage('Again')])).rejects.toThrow('no more responses');
  });

  it('returns tool calls when scripted', async () => {
    const adapter = mock([
      {
        content: 'Calling tool.',
        toolCalls: [{ id: '1', name: 'search', arguments: { q: 'test' } }],
      },
    ]);

    const response = await adapter.chat([userMessage('Search')]);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].name).toBe('search');
    expect(response.finishReason).toBe('tool_calls');
  });

  it('tracks call count and messages', async () => {
    const adapter = mock([{ content: 'A' }, { content: 'B' }]);

    await adapter.chat([userMessage('First')]);
    await adapter.chat([userMessage('Second')]);

    expect(adapter.getCallCount()).toBe(2);
    expect(adapter.getCall(0)?.messages[0].content).toBe('First');
    expect(adapter.getCall(1)?.messages[0].content).toBe('Second');
  });

  it('reset clears call history and restarts responses', async () => {
    const adapter = mock([{ content: 'Hello' }]);

    await adapter.chat([userMessage('Hi')]);
    expect(adapter.getCallCount()).toBe(1);

    adapter.reset();
    expect(adapter.getCallCount()).toBe(0);

    const r = await adapter.chat([userMessage('Hi again')]);
    expect(r.content).toBe('Hello');
  });

  it('provides default usage when not specified', async () => {
    const adapter = mock([{ content: 'Hi' }]);
    const r = await adapter.chat([userMessage('Hello')]);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('uses custom usage when specified', async () => {
    const adapter = mock([{ content: 'Hi', usage: { inputTokens: 100, outputTokens: 200 } }]);
    const r = await adapter.chat([userMessage('Hello')]);
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 200 });
  });

  it('getAllCalls returns readonly array', async () => {
    const adapter = mock([{ content: 'Hi' }]);
    await adapter.chat([userMessage('Hello')]);
    const calls = adapter.getAllCalls();
    expect(calls).toHaveLength(1);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { StreamEmitter, SSEFormatter } from '../../src';
import type { StreamEvent } from '../../src';

describe('StreamEmitter', () => {
  it('emits token events to subscribers', () => {
    const emitter = new StreamEmitter();
    const events: StreamEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.emitToken('Hello');
    emitter.emitToken(' world');

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'token', content: 'Hello' });
    expect(events[1]).toEqual({ type: 'token', content: ' world' });
  });

  it('emits tool call events', () => {
    const emitter = new StreamEmitter();
    const events: StreamEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.emitToolCallStart('search', { q: 'test' });
    emitter.emitToolResult('search', 'Found 5 results');

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('tool_call_start');
    expect(events[1].type).toBe('tool_result');
  });

  it('emits done and error events', () => {
    const emitter = new StreamEmitter();
    const events: StreamEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.emitDone('Final answer');
    emitter.emitError('Something broke');

    expect(events[0]).toEqual({ type: 'done', response: 'Final answer' });
    expect(events[1]).toEqual({ type: 'error', message: 'Something broke' });
  });

  it('supports unsubscribe', () => {
    const emitter = new StreamEmitter();
    const events: StreamEvent[] = [];
    const unsub = emitter.on((e) => events.push(e));

    emitter.emitToken('A');
    unsub();
    emitter.emitToken('B');

    expect(events).toHaveLength(1);
  });

  it('swallows handler errors', () => {
    const emitter = new StreamEmitter();
    emitter.on(() => {
      throw new Error('Handler crash');
    });
    const events: StreamEvent[] = [];
    emitter.on((e) => events.push(e));

    // Should not throw
    emitter.emitToken('test');
    expect(events).toHaveLength(1);
  });
});

describe('SSEFormatter', () => {
  it('formats a token event as SSE', () => {
    const sse = SSEFormatter.format({ type: 'token', content: 'Hi' });
    expect(sse).toBe('event: token\ndata: {"type":"token","content":"Hi"}\n\n');
  });

  it('formats multiple events', () => {
    const events: StreamEvent[] = [
      { type: 'token', content: 'A' },
      { type: 'done', response: 'B' },
    ];
    const result = SSEFormatter.formatAll(events);
    expect(result).toContain('event: token');
    expect(result).toContain('event: done');
  });
});

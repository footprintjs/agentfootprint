import { describe, it, expect } from 'vitest';
import { StreamEmitter, SSEFormatter } from '../../src';
import type { AgentStreamEvent } from '../../src';

describe('StreamEmitter', () => {
  it('emits events to subscribers', () => {
    const emitter = new StreamEmitter();
    const events: AgentStreamEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.emit({ type: 'token', content: 'Hello' });
    emitter.emit({ type: 'token', content: ' world' });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'token', content: 'Hello' });
    expect(events[1]).toEqual({ type: 'token', content: ' world' });
  });

  it('emits tool lifecycle events', () => {
    const emitter = new StreamEmitter();
    const events: AgentStreamEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.emit({ type: 'tool_start', toolName: 'search', toolCallId: 'tc-1', args: { q: 'test' } });
    emitter.emit({ type: 'tool_end', toolName: 'search', toolCallId: 'tc-1', result: 'Found 5', latencyMs: 42 });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('tool_start');
    expect(events[1].type).toBe('tool_end');
  });

  it('emits turn and error events', () => {
    const emitter = new StreamEmitter();
    const events: AgentStreamEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.emit({ type: 'turn_end', content: 'Final', iterations: 2 });
    emitter.emit({ type: 'error', phase: 'llm', message: 'Broke' });

    expect(events[0]).toEqual({ type: 'turn_end', content: 'Final', iterations: 2 });
    expect(events[1]).toEqual({ type: 'error', phase: 'llm', message: 'Broke' });
  });

  it('supports unsubscribe', () => {
    const emitter = new StreamEmitter();
    const events: AgentStreamEvent[] = [];
    const unsub = emitter.on((e) => events.push(e));

    emitter.emit({ type: 'token', content: 'A' });
    unsub();
    emitter.emit({ type: 'token', content: 'B' });

    expect(events).toHaveLength(1);
  });

  it('swallows handler errors', () => {
    const emitter = new StreamEmitter();
    emitter.on(() => { throw new Error('Handler crash'); });
    const events: AgentStreamEvent[] = [];
    emitter.on((e) => events.push(e));

    emitter.emit({ type: 'token', content: 'test' });
    expect(events).toHaveLength(1);
  });
});

describe('SSEFormatter', () => {
  it('formats a token event as SSE', () => {
    const sse = SSEFormatter.format({ type: 'token', content: 'Hi' });
    expect(sse).toBe('event: token\ndata: {"type":"token","content":"Hi"}\n\n');
  });

  it('formats multiple events', () => {
    const events: AgentStreamEvent[] = [
      { type: 'token', content: 'A' },
      { type: 'turn_end', content: 'B', iterations: 1 },
    ];
    const result = SSEFormatter.formatAll(events);
    expect(result).toContain('event: token');
    expect(result).toContain('event: turn_end');
  });
});

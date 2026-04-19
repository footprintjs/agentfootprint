/**
 * StreamEventRecorder — 5-pattern tests.
 *
 * Unit:     forwards matching events to handler; ignores unrelated emits
 * Boundary: undefined payload / missing payload is tolerated
 * Scenario: full LLM + tool + token event sequence flows through
 * Property: handler called exactly once per matching emit
 * Security: handler errors are isolated; unknown event names skip cleanly
 */
import { describe, it, expect, vi } from 'vitest';
import type { EmitEvent } from 'footprintjs';
import {
  createStreamEventRecorder,
  STREAM_EMIT_PREFIX,
} from '../../src/streaming/StreamEventRecorder';
import type { AgentStreamEvent } from '../../src/streaming/StreamEmitter';

const makeEmit = (name: string, payload: unknown): EmitEvent =>
  ({
    name,
    payload,
    timestamp: Date.now(),
    stageName: 'test',
    runtimeStageId: 'test#0',
    subflowPath: '',
    pipelineId: 'test',
  } as EmitEvent);

// ── Unit ────────────────────────────────────────────────────

describe('StreamEventRecorder — unit', () => {
  it('forwards a matching emit as an AgentStreamEvent to the handler', () => {
    const handler = vi.fn();
    const rec = createStreamEventRecorder(handler);
    const event: AgentStreamEvent = { type: 'llm_start', iteration: 1 };
    rec.onEmit?.(makeEmit(`${STREAM_EMIT_PREFIX}llm_start`, event));
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('ignores emits that do not match the stream prefix', () => {
    const handler = vi.fn();
    const rec = createStreamEventRecorder(handler);
    rec.onEmit?.(makeEmit('agentfootprint.llm.request', { iteration: 1 }));
    rec.onEmit?.(makeEmit('myapp.custom', { x: 1 }));
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('StreamEventRecorder — boundary', () => {
  it('undefined payload is skipped without invoking the handler', () => {
    const handler = vi.fn();
    const rec = createStreamEventRecorder(handler);
    rec.onEmit?.(makeEmit(`${STREAM_EMIT_PREFIX}llm_end`, undefined));
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts custom recorder id override', () => {
    const rec = createStreamEventRecorder(() => {}, 'my-custom-id');
    expect(rec.id).toBe('my-custom-id');
  });

  it('default recorder id is stable and documented', () => {
    const rec = createStreamEventRecorder(() => {});
    expect(rec.id).toBe('agentfootprint-stream');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('StreamEventRecorder — scenario', () => {
  it('forwards a full turn sequence in order', () => {
    const received: AgentStreamEvent[] = [];
    const rec = createStreamEventRecorder((e) => received.push(e));

    const sequence: Array<[string, AgentStreamEvent]> = [
      [`${STREAM_EMIT_PREFIX}llm_start`, { type: 'llm_start', iteration: 1 }],
      [
        `${STREAM_EMIT_PREFIX}tool_start`,
        { type: 'tool_start', toolName: 'search', toolCallId: 'tc1', args: { q: 'x' } },
      ],
      [
        `${STREAM_EMIT_PREFIX}tool_end`,
        {
          type: 'tool_end',
          toolName: 'search',
          toolCallId: 'tc1',
          result: 'ok',
          latencyMs: 10,
        },
      ],
      [
        `${STREAM_EMIT_PREFIX}llm_end`,
        {
          type: 'llm_end',
          iteration: 1,
          toolCallCount: 1,
          content: 'done',
          latencyMs: 25,
        },
      ],
    ];

    for (const [name, event] of sequence) {
      rec.onEmit?.(makeEmit(name, event));
    }

    expect(received.map((e) => e.type)).toEqual(['llm_start', 'tool_start', 'tool_end', 'llm_end']);
  });
});

// ── Property ────────────────────────────────────────────────

describe('StreamEventRecorder — property', () => {
  it('invokes handler exactly once per matching emit, never for non-matching', () => {
    const handler = vi.fn();
    const rec = createStreamEventRecorder(handler);

    const matching = [
      makeEmit(`${STREAM_EMIT_PREFIX}llm_start`, { type: 'llm_start', iteration: 1 }),
      makeEmit(`${STREAM_EMIT_PREFIX}token`, { type: 'token', content: 'hi' }),
      makeEmit(`${STREAM_EMIT_PREFIX}llm_end`, { type: 'llm_end', iteration: 1, content: 'x' }),
    ];
    const nonMatching = [
      makeEmit('agentfootprint.llm.request', {}),
      makeEmit('agentfootprint.llm.response', {}),
      makeEmit('log.debug.x', {}),
    ];

    for (const e of [...matching, ...nonMatching]) rec.onEmit?.(e);
    expect(handler).toHaveBeenCalledTimes(matching.length);
  });

  it('payload passed verbatim — no clone, no transform', () => {
    const handler = vi.fn();
    const rec = createStreamEventRecorder(handler);
    const event = { type: 'llm_start', iteration: 5 } as AgentStreamEvent;
    rec.onEmit?.(makeEmit(`${STREAM_EMIT_PREFIX}llm_start`, event));
    // Identity-compare — the recorder forwards the payload reference unchanged
    expect(handler.mock.calls[0][0]).toBe(event);
  });
});

// ── Security ────────────────────────────────────────────────

describe('StreamEventRecorder — security', () => {
  it('handler throwing does NOT propagate — agent must not crash', () => {
    const rec = createStreamEventRecorder(() => {
      throw new Error('consumer bug');
    });
    // Should NOT throw
    expect(() =>
      rec.onEmit?.(makeEmit(`${STREAM_EMIT_PREFIX}llm_start`, { type: 'llm_start', iteration: 1 })),
    ).not.toThrow();
  });

  it('handler throwing does not stop subsequent emits from being forwarded', () => {
    let count = 0;
    const rec = createStreamEventRecorder(() => {
      count++;
      if (count === 1) throw new Error('transient');
    });
    for (let i = 0; i < 3; i++) {
      rec.onEmit?.(makeEmit(`${STREAM_EMIT_PREFIX}llm_start`, { type: 'llm_start', iteration: i }));
    }
    // All three attempts went through — error isolation must not disable the recorder.
    expect(count).toBe(3);
  });

  it('event name prefix boundary — "agentfootprint.streamFOO" does NOT match (must be exact prefix)', () => {
    const handler = vi.fn();
    const rec = createStreamEventRecorder(handler);
    // `agentfootprint.stream` without trailing "." accidentally — our
    // prefix is `agentfootprint.stream.`, but `startsWith` would also
    // match a hypothetical `agentfootprint.streamy` etc. Pin current
    // behavior.
    rec.onEmit?.(makeEmit(`${STREAM_EMIT_PREFIX}token`, { type: 'token', content: 'ok' }));
    rec.onEmit?.(makeEmit('agentfootprint.streamy.token', { type: 'token', content: 'bad' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

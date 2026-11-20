import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import type { AgentfootprintEvent, AgentfootprintEventMap } from '../../src/events/registry.js';
import {
  encodeSSE,
  SSEFormatter,
  toSSE,
  type SseFraming,
  type ToSSEOptions,
} from '../../src/hosting/stream.js';

const heartbeatMs = 50;
const heartbeat = ': ping\n\n';

/** This source exposes only the event port. One heartbeat bounds a failed read and releases it. */
async function read(stream: AsyncIterable<string>) {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    if (chunk === heartbeat) return { closed: false, chunks };
    chunks.push(chunk);
  }
  return { closed: true, chunks };
}

function eventPort(replayed?: AgentfootprintEvent) {
  const listeners = new Set<(event: AgentfootprintEvent) => void>();
  let subscribed = 0;
  let released = 0;
  return {
    on(_pattern: '*', listener: (event: AgentfootprintEvent) => void) {
      listeners.add(listener);
      subscribed += 1;
      if (replayed !== undefined) listener(replayed);
      return () => {
        released += 1;
        listeners.delete(listener);
      };
    },
    emit(...events: AgentfootprintEvent[]) {
      for (const event of events) {
        for (const listener of listeners) listener(event);
      }
    },
    subscriptions: () => ({ active: listeners.size, subscribed, released }),
  };
}

function at(stage: string) {
  return {
    runId: 'one-recording',
    runtimeStageId: `step-a/${stage}#1`,
    subflowPath: ['step-a'],
    compositionPath: ['Sequence:sample'],
    wallClockMs: 1,
    runOffsetMs: 1,
  };
}

function token(content: string): AgentfootprintEventMap['agentfootprint.stream.token'] {
  return {
    type: 'agentfootprint.stream.token',
    meta: at('call'),
    payload: { content, iteration: 1, tokenIndex: 0 },
  };
}

function end(finalContent: string): AgentfootprintEventMap['agentfootprint.agent.turn_end'] {
  return {
    type: 'agentfootprint.agent.turn_end',
    meta: at('final'),
    payload: {
      finalContent,
      turnIndex: 0,
      totalInputTokens: 1,
      totalOutputTokens: 1,
      durationMs: 1,
      iterationCount: 1,
    },
  };
}

const frame = (event: AgentfootprintEvent) => encodeSSE(event.type, event);

describe('toSSE start lifecycle with an event-only source', () => {
  it('subscribes before calling start exactly once and accepts a foreign thenable', async () => {
    const port = eventPort(token('prior invocation'));
    const first = token('synchronous event');
    let starts = 0;
    let thenReads = 0;
    let thenCalls = 0;
    const thenable = {
      get then() {
        thenReads += 1;
        return function (this: unknown, resolve: (value: string) => void) {
          expect(this).toBe(thenable);
          expect(port.subscriptions().active).toBe(1);
          thenCalls += 1;
          resolve('result from another promise implementation');
        };
      },
    };
    const stream = toSSE(port, {
      heartbeatMs,
      start: () => {
        starts += 1;
        expect(port.subscriptions()).toEqual({ active: 1, subscribed: 1, released: 0 });
        port.emit(first);
        return thenable as unknown as Promise<string>;
      },
    });
    expect(starts).toBe(0);
    expect(await read(stream)).toEqual({ closed: true, chunks: [frame(first)] });
    expect({ starts, thenReads, thenCalls }).toEqual({ starts: 1, thenReads: 1, thenCalls: 1 });
    expect(port.subscriptions()).toEqual({ active: 0, subscribed: 1, released: 1 });
  });

  const invalidStarts = {
    'a synchronous throw': () => {
      throw new Error('private synchronous exception');
    },
    'a nonpromise result': () => 17,
    'an object with a noncallable then': () => ({ then: 17 }),
    'a throwing then getter': () => ({
      get then(): never {
        throw new Error('private getter exception');
      },
    }),
  };

  it.each(Object.entries(invalidStarts))('releases the port on %s', async (_label, start) => {
    const port = eventPort();
    let calls = 0;
    const stream = toSSE(port, {
      heartbeatMs,
      start: () => {
        calls += 1;
        return start() as unknown as Promise<unknown>;
      },
    });
    expect(await read(stream)).toEqual({ closed: true, chunks: [] });
    expect(calls).toBe(1);
    expect(port.subscriptions()).toEqual({ active: 0, subscribed: 1, released: 1 });
  });

  it.each(['full', 'text'] as const)(
    'keeps private fulfilled values and rejection reasons out of identical %s output',
    async (format) => {
      const port = eventPort();
      const { type, payload } = end('served standing line');
      const olderEnd = { type, payload } as AgentfootprintEvent;
      const events = [token('served '), olderEnd, token('transcript')];
      const expected = {
        closed: true,
        chunks: format === 'full' ? events.map(frame) : ['served ', 'transcript'],
      };
      for (const reject of [false, true]) {
        for (const hidden of ['private one', 'private two']) {
          const value = { hidden };
          const error = new Error(hidden);
          let invocation: Promise<typeof value> | undefined;
          expect(
            await read(
              toSSE(port, {
                heartbeatMs,
                format,
                start: () => {
                  port.emit(...events);
                  invocation = reject ? Promise.reject(error) : Promise.resolve(value);
                  return invocation;
                },
              }),
            ),
          ).toEqual(expected);
          if (reject) await expect(invocation).rejects.toBe(error);
          else await expect(invocation).resolves.toBe(value);
          expect(port.subscriptions().active).toBe(0);
        }
      }
      expect(port.subscriptions()).toEqual({ active: 0, subscribed: 4, released: 4 });
    },
  );

  it.each(['full', 'text'] as const)(
    'settles %s output even when the filter drops every event',
    async (format) => {
      const port = eventPort();
      const events = [token('first'), end('child end'), token('last')];
      const seen: AgentfootprintEvent[] = [];
      const result = await read(
        toSSE(port, {
          heartbeatMs,
          format,
          filter: (event) => {
            seen.push(event);
            return false;
          },
          start: async () => port.emit(...events),
        }),
      );
      expect(result).toEqual({ closed: true, chunks: [] });
      expect(seen).toEqual(events);
      expect(port.subscriptions()).toEqual({ active: 0, subscribed: 1, released: 1 });
    },
  );

  it('releases the subscription on an early break and lets the invocation finish', async () => {
    const port = eventPort();
    const gate = Promise.withResolvers<void>();
    const first = token('first');
    const later = token('later');
    const seen: AgentfootprintEvent[] = [];
    let invocation: Promise<string> | undefined;
    try {
      for await (const chunk of toSSE(port, {
        heartbeatMs,
        filter: (event) => {
          seen.push(event);
          return true;
        },
        start: () => {
          port.emit(first);
          invocation = gate.promise.then(() => {
            port.emit(later);
            return 'completed after the reader left';
          });
          return invocation;
        },
      })) {
        expect(chunk).toBe(frame(first));
        break;
      }
      expect(port.subscriptions()).toEqual({ active: 0, subscribed: 1, released: 1 });
    } finally {
      gate.resolve();
    }
    await expect(invocation).resolves.toBe('completed after the reader left');
    expect(seen).toEqual([first]);
  });

  it('drains admitted frames after settlement before reusing the same port', async () => {
    const port = eventPort();
    const gate = Promise.withResolvers<void>();
    const first = token('first');
    const last = token('last');
    const endOfChild = end('child end');
    const skipped = token('skip');
    const later = token('after settlement');
    const seen: AgentfootprintEvent[] = [];
    const framing: SseFraming<AgentfootprintEvent> = {
      contentType: 'text/event-stream',
      frame: (event, at) => `${at.sequence}. ${frame(event)}`,
    };
    const stream = new SSEFormatter(port, {
      framing,
      heartbeatMs,
      start: () => {
        port.emit(first);
        return gate.promise;
      },
      filter: (event) => {
        seen.push(event);
        return event !== skipped;
      },
    }).stream();
    const iterator = stream[Symbol.asyncIterator]();
    try {
      expect(await iterator.next()).toEqual({ value: `1. ${frame(first)}`, done: false });
      port.emit(endOfChild, skipped, last);
      gate.resolve();
      await setImmediate();
      port.emit(later);
      expect(await read({ [Symbol.asyncIterator]: () => iterator })).toEqual({
        closed: true,
        chunks: [`2. ${frame(endOfChild)}`, `3. ${frame(last)}`],
      });
      expect(seen).toEqual([first, endOfChild, skipped, last]);
    } finally {
      gate.resolve();
      await iterator.return?.();
    }
    expect(port.subscriptions()).toEqual({ active: 0, subscribed: 1, released: 1 });

    const next = token('second run');
    expect(
      await read(toSSE(port, { framing, heartbeatMs, start: async () => port.emit(next) })),
    ).toEqual({ closed: true, chunks: [`1. ${frame(next)}`] });
    expect(port.subscriptions()).toEqual({ active: 0, subscribed: 2, released: 2 });
  });

  it('keeps exact no-start legacy output after invocation-bound streaming on the same port', async () => {
    const port = eventPort();
    const run = [token('first member'), end('first end'), token('second member')];
    const options = { heartbeatMs } satisfies ToSSEOptions;
    const full = read(toSSE(port, options));
    port.emit(...run.slice(0, 2));
    expect(await full).toEqual({ closed: true, chunks: run.slice(0, 2).map(frame) });

    expect(await read(toSSE(port, { ...options, start: async () => port.emit(...run) }))).toEqual({
      closed: true,
      chunks: run.map(frame),
    });

    const text = read(toSSE(port, { ...options, format: 'text' }));
    port.emit(...run.slice(0, 2));
    expect(await text).toEqual({ closed: true, chunks: ['first member'] });
    expect(port.subscriptions()).toEqual({ active: 0, subscribed: 3, released: 3 });
  });
});

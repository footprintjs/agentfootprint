/**
 * The SSE framing seam — `toSSE`'s frames are a STRATEGY.
 *
 * Pins: the default strategy (`agentfootprintSse`) writes exactly the frames
 * `toSSE` always wrote (`encodeSSE(event.type, event)`), so nothing changes for
 * an existing caller; `eventName` still renames the default's event line; a
 * framing of the caller's own is used for every frame; and the two contradictory
 * combinations are refused by name instead of one option silently winning.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/core/Agent.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import {
  agentfootprintSse,
  encodeSSE,
  toSSE,
  type SseFraming,
  type ToSSEOptions,
} from '../../src/hosting/stream.js';

const agent = () =>
  Agent.create({
    provider: mock({ reply: 'framed answer', chunkDelayMs: 0 }),
    model: 'mock',
    maxIterations: 1,
  }).build();

/** Run once while `toSSE` streams; the frames, and the events the run dispatched. */
async function stream(options: ToSSEOptions = {}) {
  const a = agent();
  const events: AgentfootprintEvent[] = [];
  a.on('*', (e) => events.push(e));
  const frames: string[] = [];
  const collect = (async () => {
    for await (const frame of toSSE(a, options)) frames.push(frame);
  })();
  await a.run({ message: 'hi' });
  await collect;
  return { frames, events };
}

describe('SSE framing — the default strategy', () => {
  it('agentfootprintSse is the frame toSSE has always written', () => {
    const event = {
      type: 'agentfootprint.stream.token',
      payload: { content: 'x' },
    } as unknown as AgentfootprintEvent;
    expect(agentfootprintSse.contentType).toBe('text/event-stream');
    expect(agentfootprintSse.frame(event)).toBe(encodeSSE('agentfootprint.stream.token', event));
  });

  it('toSSE with no framing writes exactly those frames, event for event', async () => {
    const { frames, events } = await stream();
    const upToTurnEnd = events.slice(
      0,
      events.findIndex((e) => e.type === 'agentfootprint.agent.turn_end') + 1,
    );
    expect(frames).toEqual(upToTurnEnd.map((e) => encodeSSE(e.type, e)));
  });

  it('eventName still names the default framing’s event line', async () => {
    const { frames } = await stream({ eventName: (e) => e.type.replace('agentfootprint.', '') });
    expect(frames.length).toBeGreaterThan(0);
    expect(
      frames.every((f) => f.startsWith('event: ') && !f.startsWith('event: agentfootprint.')),
    ).toBe(true);
  });
});

describe('SSE framing — a strategy of the caller’s own', () => {
  it('frames every event with the strategy it was given', async () => {
    const counted: SseFraming<AgentfootprintEvent> = {
      contentType: 'text/event-stream',
      frame: (e) => `data: ${e.type}\n\n`,
    };
    const { frames } = await stream({ framing: counted });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => /^data: agentfootprint\.[a-z_]+\.[a-z_]+\n\n$/.test(f))).toBe(true);
  });

  it('refuses a framing beside eventName, and beside the text format — by name', async () => {
    const framing: SseFraming<AgentfootprintEvent> = {
      contentType: 'text/event-stream',
      frame: () => '',
    };
    const first = (options: ToSSEOptions) => toSSE(agent(), options)[Symbol.asyncIterator]().next();
    await expect(first({ framing, eventName: (e) => e.type })).rejects.toThrow(
      /`framing` and `eventName`/,
    );
    await expect(first({ framing, format: 'text' })).rejects.toThrow(/format: 'text'/);
  });
});

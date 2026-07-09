/**
 * Scenario tests — `Agent.run({ correlationId, traceId })` (D20/P1).
 *
 * `EventMeta.correlationId`/`traceId` already existed (src/events/types.ts)
 * and `buildEventMeta` already forwarded them from `RunContext`
 * (src/bridge/eventMeta.ts) — but `Agent.createExecutor()` built
 * `currentRunContext` without ever reading them, so every event's meta
 * was permanently `correlationId: undefined`. This closes that gap: an
 * optional `AgentRunOptions.correlationId`/`traceId` passed to `run()`
 * now lands in `currentRunContext` and is stamped on every emitted event.
 *
 * Cross-tier motivation (vizfootprint x3 spike): a caller threading one
 * join key across viz → agent → downstream systems needs the agent's own
 * event stream to carry that same id — previously impossible without
 * smuggling it through tool args.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';

describe('Agent.run — correlationId / traceId threading (D20/P1)', () => {
  it('stamps correlationId + traceId onto every emitted event when set on run()', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hello back' }),
      model: 'mock',
    })
      .system('be helpful')
      .build();

    const seen: AgentfootprintEvent[] = [];
    const off = agent.on('*', (ev) => seen.push(ev));

    const out = await agent.run(
      { message: 'hi' },
      { correlationId: 'corr-xyz-1', traceId: 'trace-xyz-1' },
    );
    off();

    expect(out).toBe('hello back');
    expect(seen.length).toBeGreaterThan(0);
    for (const ev of seen) {
      expect(ev.meta.correlationId).toBe('corr-xyz-1');
      expect(ev.meta.traceId).toBe('trace-xyz-1');
    }
  });

  it('leaves correlationId + traceId absent (undefined) when not supplied', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hello back' }),
      model: 'mock',
    })
      .system('be helpful')
      .build();

    const seen: AgentfootprintEvent[] = [];
    const off = agent.on('*', (ev) => seen.push(ev));

    await agent.run({ message: 'hi' });
    off();

    expect(seen.length).toBeGreaterThan(0);
    for (const ev of seen) {
      expect(ev.meta.correlationId).toBeUndefined();
      expect(ev.meta.traceId).toBeUndefined();
    }
  });

  it('does not leak a correlationId from a prior run into the next un-tagged run', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hello back' }),
      model: 'mock',
    })
      .system('be helpful')
      .build();

    await agent.run({ message: 'hi' }, { correlationId: 'corr-first' });

    const seen: AgentfootprintEvent[] = [];
    const off = agent.on('*', (ev) => seen.push(ev));
    await agent.run({ message: 'hi again' });
    off();

    expect(seen.length).toBeGreaterThan(0);
    for (const ev of seen) {
      expect(ev.meta.correlationId).toBeUndefined();
    }
  });

  it('falls back to options.env.traceId when traceId is not set directly', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hello back' }),
      model: 'mock',
    })
      .system('be helpful')
      .build();

    const seen: AgentfootprintEvent[] = [];
    const off = agent.on('*', (ev) => seen.push(ev));
    await agent.run({ message: 'hi' }, { env: { traceId: 'trace-from-env' } });
    off();

    expect(seen.length).toBeGreaterThan(0);
    for (const ev of seen) {
      expect(ev.meta.traceId).toBe('trace-from-env');
    }
  });

  it('an explicit traceId wins over options.env.traceId', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hello back' }),
      model: 'mock',
    })
      .system('be helpful')
      .build();

    const seen: AgentfootprintEvent[] = [];
    const off = agent.on('*', (ev) => seen.push(ev));
    await agent.run(
      { message: 'hi' },
      { traceId: 'trace-explicit', env: { traceId: 'trace-from-env' } },
    );
    off();

    expect(seen.length).toBeGreaterThan(0);
    for (const ev of seen) {
      expect(ev.meta.traceId).toBe('trace-explicit');
    }
  });
});

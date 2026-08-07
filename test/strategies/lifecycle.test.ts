/**
 * Strategy lifecycle (8.12.0) — 7-pattern tests.
 *
 * The seam: `enable.*` returns a handle (the same `Unsubscribe` function,
 * carrying `flush()` / `stop()`), `agent.shutdown()` drains everything enabled
 * on a runner, and a `WeakMap` refcount decides who may stop a shared
 * strategy.
 *
 *   P1 Unit         — the handle IS the unsubscribe, and carries flush/stop
 *   P2 Boundary     — unsubscribe never stops; stop waits for the last one
 *   P3 Scenario     — agent.shutdown() drains, agent still usable after
 *   P4 Property     — stop delivered at most once under any interleaving
 *   P5 Security     — a throwing flush/stop never escapes into shutdown
 *   P6 Performance  — shutdown on a quiet runner costs ~nothing
 *   P7 ROI          — `await handle.flush()` drains a DETACHED export in one
 *                     line: the thing that was impossible before 8.12.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createMicrotaskBatchDriver } from 'footprintjs/detach';

import { EventDispatcher } from '../../src/events/dispatcher.js';
import { attachCostStrategy, attachObservabilityStrategy } from '../../src/strategies/attach.js';
import {
  isStopped,
  subscriptionCount,
  stopStrategyIfUnused,
} from '../../src/strategies/lifecycle.js';
import type { ObservabilityStrategy } from '../../src/strategies/types.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { Agent } from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';

// ── Helpers ──────────────────────────────────────────────────────────

interface Recording extends ObservabilityStrategy {
  readonly exported: AgentfootprintEvent[];
  readonly buffered: AgentfootprintEvent[];
  flushes: number;
  stops: number;
}

/** A strategy that BUFFERS, so "did the flush happen" is observable. */
function recordingStrategy(name = 'recording'): Recording {
  const exported: AgentfootprintEvent[] = [];
  const buffered: AgentfootprintEvent[] = [];
  return {
    name,
    capabilities: { events: true },
    exported,
    buffered,
    flushes: 0,
    stops: 0,
    exportEvent(event: AgentfootprintEvent) {
      buffered.push(event);
    },
    flush(): Promise<void> {
      this.flushes += 1;
      exported.push(...buffered.splice(0));
      return Promise.resolve();
    },
    stop(): void {
      this.stops += 1;
    },
  } as Recording;
}

const event = (i = 0): AgentfootprintEvent =>
  ({
    type: 'agentfootprint.agent.turn_start',
    payload: { userPrompt: `p${i}` },
    meta: { runId: 'r', runtimeStageId: `s#${i}` },
  } as unknown as AgentfootprintEvent);

const turnEnd = (): AgentfootprintEvent =>
  ({
    type: 'agentfootprint.agent.turn_end',
    payload: { finalContent: 'done' },
    meta: { runId: 'r', runtimeStageId: 'end#0' },
  } as unknown as AgentfootprintEvent);

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('strategy handle — P1 unit', () => {
  it('P1 the handle is still the unsubscribe function, and carries flush/stop', () => {
    const dispatcher = new EventDispatcher();
    const strategy = recordingStrategy();
    const handle = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });

    expect(typeof handle).toBe('function');
    expect(typeof handle.flush).toBe('function');
    expect(typeof handle.stop).toBe('function');

    dispatcher.dispatch(event());
    expect(strategy.buffered).toHaveLength(1);
    handle(); // the old call — detach
    dispatcher.dispatch(event(1));
    expect(strategy.buffered).toHaveLength(1);
  });

  it('P1 enable.* with no strategy returns a handle whose flush/stop are no-ops', async () => {
    const dispatcher = new EventDispatcher();
    const handle = attachObservabilityStrategy(dispatcher, {});
    await expect(handle.flush()).resolves.toBeUndefined();
    expect(() => handle.stop()).not.toThrow();
    expect(() => handle()).not.toThrow();
  });

  it('P1 flush() ships what the strategy buffered', async () => {
    const dispatcher = new EventDispatcher();
    const strategy = recordingStrategy();
    const handle = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    dispatcher.dispatch(event());
    dispatcher.dispatch(event(1));
    expect(strategy.exported).toHaveLength(0);
    await handle.flush();
    expect(strategy.exported).toHaveLength(2);
    handle();
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('strategy handle — P2 boundary', () => {
  it('P2 unsubscribing NEVER stops the strategy (the compatibility law)', () => {
    const dispatcher = new EventDispatcher();
    const strategy = recordingStrategy();
    const handle = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    handle();
    expect(strategy.stops).toBe(0);
    expect(isStopped(strategy)).toBe(false);
  });

  it('P2 the audit-export pattern: unsubscribe, re-enable, still recording', () => {
    const dispatcher = new EventDispatcher();
    const strategy = recordingStrategy();
    const first = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    dispatcher.dispatch(event(1));
    first();
    // Same instance, enabled again — exactly what examples/features/19 does.
    const second = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    dispatcher.dispatch(event(2));
    expect(strategy.buffered).toHaveLength(2);
    second();
  });

  it('P2 stop() waits for the LAST subscription; a shared strategy is not blinded', () => {
    const a = new EventDispatcher();
    const b = new EventDispatcher();
    const strategy = recordingStrategy();
    const onA = attachObservabilityStrategy(a, { strategy, tier: 'firehose' });
    const onB = attachObservabilityStrategy(b, { strategy, tier: 'firehose' });
    expect(subscriptionCount(strategy)).toBe(2);

    onA();
    onA.stop(); // runner A is done with it — but B still is not
    expect(strategy.stops).toBe(0);
    b.dispatch(event());
    expect(strategy.buffered).toHaveLength(1);

    onB();
    onB.stop();
    expect(strategy.stops).toBe(1);
  });

  it('P2 unsubscribing twice releases one subscription, not two', () => {
    const dispatcher = new EventDispatcher();
    const strategy = recordingStrategy();
    const one = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    const two = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    one();
    one();
    one();
    expect(subscriptionCount(strategy)).toBe(1);
    one.stop();
    expect(strategy.stops).toBe(0); // `two` is still live
    two();
    two.stop();
    expect(strategy.stops).toBe(1);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('agent.shutdown() — P3 scenario', () => {
  const buildAgent = (): Agent =>
    Agent.create({ provider: new MockProvider({ responses: ['ok'] }), model: 'mock' })
      .system('t')
      .build();

  it('P3 shutdown() drains every strategy enabled on the runner', async () => {
    const agent = buildAgent();
    const one = recordingStrategy('one');
    const two = recordingStrategy('two');
    agent.enable.observability({ strategy: one, tier: 'firehose' });
    agent.enable.observability({ strategy: two, tier: 'firehose' });

    await agent.run({ message: 'hi' });
    expect(one.exported).toHaveLength(0); // nothing flushed mid-run, by design

    await agent.shutdown();
    expect(one.exported.length).toBeGreaterThan(0);
    expect(two.exported.length).toBeGreaterThan(0);
    expect(one.stops).toBe(1);
    expect(two.stops).toBe(1);
  });

  it('P3 the agent is still usable after shutdown()', async () => {
    const agent = buildAgent();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    await agent.run({ message: 'one' });
    await agent.shutdown();

    // Runs still run. A fresh enable gets a fresh, live strategy.
    const fresh = recordingStrategy('fresh');
    const handle = agent.enable.observability({ strategy: fresh, tier: 'firehose' });
    await expect(agent.run({ message: 'two' })).resolves.toBeDefined();
    await handle.flush();
    expect(fresh.exported.length).toBeGreaterThan(0);
    await agent.shutdown();
  });

  it('P3 shutdown({ stop: false }) drains without releasing', async () => {
    const agent = buildAgent();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    await agent.run({ message: 'hi' });

    await agent.shutdown({ stop: false });
    expect(strategy.exported.length).toBeGreaterThan(0);
    expect(strategy.stops).toBe(0);
    await agent.shutdown();
    expect(strategy.stops).toBe(1);
  });

  it('P3 an unsubscribed handle is not carried into shutdown', async () => {
    const agent = buildAgent();
    const strategy = recordingStrategy();
    const handle = agent.enable.observability({ strategy, tier: 'firehose' });
    handle();
    await agent.shutdown();
    // Nothing subscribed, so nothing to flush — and nothing stopped it either,
    // because the handle left the runner's set when it was released.
    expect(strategy.flushes).toBe(0);
    expect(strategy.stops).toBe(0);
  });

  it('P3 flushOn: run-end fires a flush when a run ends, without gating run()', async () => {
    const agent = buildAgent();
    const strategy = recordingStrategy();
    const handle = agent.enable.observability({
      strategy,
      tier: 'firehose',
      flushOn: 'run-end',
    });
    await agent.run({ message: 'hi' });
    // The flush is fired, not awaited by run() — give its microtasks a turn.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(strategy.flushes).toBeGreaterThan(0);
    expect(strategy.exported.length).toBeGreaterThan(0);
    handle();
    await agent.shutdown();
  });

  it('P3 flushOn defaults to manual — no flush without a run-end subscription', async () => {
    const dispatcher = new EventDispatcher();
    const strategy = recordingStrategy();
    const handle = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    dispatcher.dispatch(event());
    dispatcher.dispatch(turnEnd());
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(strategy.flushes).toBe(0);
    handle();
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('strategy lifecycle — P4 property', () => {
  it('P4 stop() reaches a strategy at most once under any interleaving', () => {
    const strategy = recordingStrategy();
    const dispatchers = [new EventDispatcher(), new EventDispatcher(), new EventDispatcher()];
    const handles = dispatchers.map((d) =>
      attachObservabilityStrategy(d, { strategy, tier: 'firehose' }),
    );
    // Release + stop in a deliberately silly order, several times over.
    handles[2]!.stop();
    handles[0]!();
    handles[0]!.stop();
    handles[2]!();
    handles[2]!.stop();
    handles[1]!();
    handles[1]!.stop();
    handles[0]!.stop();
    handles[1]!.stop();
    expect(strategy.stops).toBe(1);
    expect(isStopped(strategy)).toBe(true);
  });

  it('P4 stopStrategyIfUnused reports why it did nothing', () => {
    const dispatcher = new EventDispatcher();
    const strategy = recordingStrategy();
    const handle = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    expect(stopStrategyIfUnused(strategy)).toBe('still-subscribed');
    handle();
    expect(stopStrategyIfUnused(strategy)).toBe('stopped');
    expect(stopStrategyIfUnused(strategy)).toBe('already-stopped');
    expect(strategy.stops).toBe(1);
  });

  it('P4 cost strategies get the same handle contract', async () => {
    const dispatcher = new EventDispatcher();
    const ticks: unknown[] = [];
    const strategy = {
      name: 'cost',
      capabilities: {},
      recordCost: (tick: unknown) => ticks.push(tick),
      flush: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
    };
    const handle = attachCostStrategy(dispatcher, { strategy });
    await handle.flush();
    expect(strategy.flush).toHaveBeenCalledOnce();
    handle();
    handle.stop();
    expect(strategy.stop).toHaveBeenCalledOnce();
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('strategy lifecycle — P5 security', () => {
  it('P5 a flush that rejects never escapes into the shutdown path', async () => {
    const dispatcher = new EventDispatcher();
    const strategy: ObservabilityStrategy = {
      name: 'angry',
      capabilities: { events: true },
      exportEvent: () => undefined,
      flush: () => Promise.reject(new Error('vendor 500')),
    };
    const handle = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    await expect(handle.flush()).resolves.toBeUndefined();
    handle();
  });

  it('P5 a stop() that throws does not block the rest of a shutdown', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ responses: ['ok'] }),
      model: 'mock',
    })
      .system('t')
      .build();
    const angry: ObservabilityStrategy = {
      name: 'angry',
      capabilities: { events: true },
      exportEvent: () => undefined,
      stop: () => {
        throw new Error('vendor close failed');
      },
    };
    const calm = recordingStrategy('calm');
    agent.enable.observability({ strategy: angry, tier: 'firehose' });
    agent.enable.observability({ strategy: calm, tier: 'firehose' });
    await expect(agent.shutdown()).resolves.toBeUndefined();
    expect(calm.stops).toBe(1);
  });

  it('P5 concurrent shutdowns share one drain', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ responses: ['ok'] }),
      model: 'mock',
    })
      .system('t')
      .build();
    const strategy = recordingStrategy();
    agent.enable.observability({ strategy, tier: 'firehose' });
    await agent.run({ message: 'hi' });
    await Promise.all([agent.shutdown(), agent.shutdown(), agent.shutdown()]);
    expect(strategy.flushes).toBe(1);
    expect(strategy.stops).toBe(1);
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('strategy lifecycle — P6 performance', () => {
  it('P6 shutdown on a runner with nothing buffered is sub-millisecond', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ responses: ['ok'] }),
      model: 'mock',
    })
      .system('t')
      .build();
    agent.enable.observability({ strategy: recordingStrategy(), tier: 'firehose' });
    const started = performance.now();
    await agent.shutdown();
    expect(performance.now() - started).toBeLessThan(50);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('strategy lifecycle — P7 ROI', () => {
  // THE one-liner. Before 8.12.0 a detached export could not be drained from
  // outside at all: the events sat on a driver, not in the strategy, and the
  // only public drain (`flushAllDetached`) could not see them. Now the handle
  // that scheduled them is the handle that waits for them.
  it('P7 await handle.flush() drains a DETACHED export — no tick loop, no sleep', async () => {
    const dispatcher = new EventDispatcher();
    const strategy = recordingStrategy();
    const driver = createMicrotaskBatchDriver(async (_chart, evt) => {
      strategy.exportEvent(evt as AgentfootprintEvent);
    });
    const handle = attachObservabilityStrategy(dispatcher, {
      strategy,
      tier: 'firehose',
      detach: { driver, mode: 'forget' },
    });

    dispatcher.dispatch(event(1));
    dispatcher.dispatch(event(2));
    expect(strategy.buffered).toHaveLength(0); // still on the driver

    await handle.flush();

    expect(strategy.exported).toHaveLength(2);
    handle();
    handle.stop();
  });

  // `await using handle = …` is the point of this: the handle is an
  // `AsyncDisposable`, so a scope exit flushes, detaches and releases it.
  // The SYNTAX cannot appear in this repo — prettier 2.8 (the formatter this
  // project is pinned to) cannot parse explicit resource management, and the
  // format gate runs over `test/**/*.ts`. So the test calls the same method
  // the syntax would call. Consumers on their own toolchains write the sugar.
  it('P7 disposal flushes, detaches and releases — what `await using` invokes', async () => {
    const dispatcher = new EventDispatcher();
    const strategy = recordingStrategy();
    const handle = attachObservabilityStrategy(dispatcher, { strategy, tier: 'firehose' });
    dispatcher.dispatch(event());

    const dispose = (handle as unknown as Record<symbol, () => Promise<void>>)[Symbol.asyncDispose];
    expect(typeof dispose).toBe('function');
    await handle[Symbol.asyncDispose]();

    expect(strategy.exported).toHaveLength(1); // flushed
    expect(strategy.stops).toBe(1); // released
    dispatcher.dispatch(event(2));
    expect(strategy.buffered).toHaveLength(0); // detached
  });
});

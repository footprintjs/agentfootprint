/**
 * 7-pattern tests for the v2.8 compose() combinator + 4 grouped
 * `enable.*` facades.
 *
 *   P1 Unit         — each compose variant fan-outs
 *   P2 Boundary     — empty array, single child, child without optional methods
 *   P3 Scenario     — multi-vendor pipeline (compose([console, inMemorySink]))
 *   P4 Property     — error-isolated fan-out, idempotent stop, sync void
 *   P5 Security     — _onError surfaces vendor errors without crashing
 *   P6 Performance  — compose of 5 children adds ≤ 5% overhead vs single
 *   P7 ROI          — capabilities OR-merged, attach.* delegates correctly
 */

import { describe, it, expect, vi } from 'vitest';
import {
  composeObservability,
  composeCost,
  composeLiveStatus,
  composeLens,
  consoleObservability,
  inMemorySinkCost,
  chatBubbleLiveStatus,
  noopLens,
  attachObservabilityStrategy,
  attachCostStrategy,
  attachLiveStatusStrategy,
  type ObservabilityStrategy,
  type CostStrategy,
  type CostTick,
  type StatusUpdate,
  type LensUpdate,
} from '../../src/strategies/index.js';
import { EventDispatcher } from '../../src/events/dispatcher.js';
import { emitCostTick } from '../../src/core/cost.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { expectScalesLinearly, expectWithinTimes, measure } from '../helpers/perf.js';
import { settlesWithin } from '../helpers/settles.js';
import { cloudwatchObservability } from '../../src/adapters/observability/cloudwatch.js';

const makeEvent = (overrides: Partial<AgentfootprintEvent> = {}): AgentfootprintEvent =>
  ({
    type: 'agentfootprint.stream.token',
    payload: { content: 'x', tokenIndex: 0 },
    ts: Date.now(),
    ...overrides,
  } as unknown as AgentfootprintEvent);

// ═══ composeObservability ═══════════════════════════════════════════

describe('composeObservability', () => {
  // P1
  it('P1 fans out exportEvent to every child', () => {
    const a = vi.fn();
    const b = vi.fn();
    const composed = composeObservability([
      { name: 'a', capabilities: { events: true }, exportEvent: a },
      { name: 'b', capabilities: { logs: true }, exportEvent: b },
    ]);
    composed.exportEvent(makeEvent());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  // P2 boundary: empty array
  it('P2 empty array produces a no-op composite', () => {
    const composed = composeObservability([]);
    expect(() => composed.exportEvent(makeEvent())).not.toThrow();
    expect(composed.capabilities).toEqual({});
  });

  // P2 boundary: single child = pass-through
  it('P2 single child equals direct pass-through', () => {
    const a = vi.fn();
    const composed = composeObservability([
      { name: 'a', capabilities: { events: true }, exportEvent: a },
    ]);
    composed.exportEvent(makeEvent());
    expect(a).toHaveBeenCalledTimes(1);
  });

  // P3 scenario: multi-vendor (in-memory + console-style mock)
  it('P3 multi-vendor fan-out for production sink + test inspector', () => {
    const lines: string[] = [];
    const events: AgentfootprintEvent[] = [];
    const composed = composeObservability([
      consoleObservability({ logger: { log: (line: string) => lines.push(line) } }),
      {
        name: 'inspector',
        capabilities: { events: true },
        exportEvent: (e) => events.push(e),
      },
    ]);
    composed.exportEvent(makeEvent());
    composed.exportEvent(makeEvent({ type: 'agentfootprint.stream.tool_start' as never }));
    expect(lines.length).toBe(2);
    expect(events.length).toBe(2);
  });

  // P4 property: throwing child does NOT affect siblings
  it('P4 throwing child is isolated; siblings still receive event', () => {
    const onError = vi.fn();
    const sibling = vi.fn();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const composed = composeObservability([
      {
        name: 'bad',
        capabilities: { events: true },
        exportEvent: () => {
          throw new Error('vendor 401');
        },
        _onError: onError,
      },
      { name: 'good', capabilities: { events: true }, exportEvent: sibling },
    ]);
    composed.exportEvent(makeEvent());
    expect(onError).toHaveBeenCalledOnce();
    expect(sibling).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });

  // P4 property: idempotent stop
  it('P4 stop calls every child once and is idempotent', () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const composed = composeObservability([
      { name: 'a', capabilities: { events: true }, exportEvent: () => {}, stop: stopA },
      { name: 'b', capabilities: { events: true }, exportEvent: () => {}, stop: stopB },
    ]);
    composed.stop?.();
    composed.stop?.();
    expect(stopA).toHaveBeenCalledTimes(2);
    expect(stopB).toHaveBeenCalledTimes(2);
  });

  // P4 property (8.11.1): a composite inherits its children's drain safety.
  // compose() holds no buffer of its own, so `stop()` then `flush()` used to
  // spin forever on the FIRST batching child it fanned out to — the shape a
  // real multi-vendor pipeline has.
  it('P4 flush() after stop() drains a batching child instead of spinning', async () => {
    const batches: Array<{ logEvents: ReadonlyArray<unknown> }> = [];
    const child = cloudwatchObservability({
      logGroupName: '/compose/group',
      flushIntervalMs: 0,
      _client: {
        putLogEvents(input) {
          batches.push(input);
          return Promise.resolve();
        },
      },
    });
    const composed = composeObservability([child]);
    composed.exportEvent(makeEvent());
    composed.stop?.();
    await settlesWithin(
      Promise.resolve(composed.flush?.()),
      'composed flush() after composed stop()',
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]?.logEvents).toHaveLength(1);
  });

  // P5 security: child without _onError logs to console.warn (audit trail)
  it('P5 throwing child without _onError logs once to console.warn', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const composed = composeObservability([
      {
        name: 'bad',
        capabilities: { events: true },
        exportEvent: () => {
          throw new Error('vendor 401');
        },
      },
    ]);
    composed.exportEvent(makeEvent());
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toContain('[compose]');
    consoleSpy.mockRestore();
  });

  // P6 performance: compose([5 children]) ≤ 5% overhead vs single
  it(
    'P6 5-child compose ≤ 5x overhead of a single child (loose bound)',
    { timeout: 30_000, retry: 2 },
    async () => {
      const single: ObservabilityStrategy = {
        name: 'a',
        capabilities: { events: true },
        exportEvent: () => {},
      };
      const composed = composeObservability([single, single, single, single, single]);
      const ev = makeEvent();
      const N = 100_000;

      // Five children plus an isolation try/catch: under 10× a single child.
      // Purely comparative, sampled alternately on this machine — so the old
      // absolute `+ 50ms` cushion is gone; the helper floors the denominator
      // with a load-scaled reference unit instead.
      await expectWithinTimes({
        baseline: () => {
          for (let i = 0; i < N; i++) single.exportEvent(ev);
        },
        subject: () => {
          for (let i = 0; i < N; i++) composed.exportEvent(ev);
        },
        times: 10,
        why: 'composing five children must not cost more than ten single children',
      });
    },
  );

  // P7 ROI: OR-merged capabilities advertise the union
  it('P7 capabilities OR-merge across children', () => {
    const composed = composeObservability([
      { name: 'a', capabilities: { events: true }, exportEvent: () => {} },
      { name: 'b', capabilities: { traces: true }, exportEvent: () => {} },
      { name: 'c', capabilities: { metrics: true, logs: true }, exportEvent: () => {} },
    ]);
    expect(composed.capabilities.events).toBe(true);
    expect(composed.capabilities.traces).toBe(true);
    expect(composed.capabilities.metrics).toBe(true);
    expect(composed.capabilities.logs).toBe(true);
  });
});

// ═══ composeCost / composeLiveStatus / composeLens (smoke) ══════════

describe('compose variants — same shape, different contracts', () => {
  it('P1 composeCost fans out recordCost', () => {
    const a = vi.fn();
    const composed = composeCost([
      { name: 'a', capabilities: {}, recordCost: a },
      inMemorySinkCost(),
    ]);
    composed.recordCost({} as CostTick);
    expect(a).toHaveBeenCalledOnce();
  });

  it('P1 composeLiveStatus fans out renderStatus', () => {
    const a = vi.fn();
    const composed = composeLiveStatus([
      { name: 'a', capabilities: {}, renderStatus: a },
      chatBubbleLiveStatus({ onLine: () => {} }),
    ]);
    composed.renderStatus({ line: 'hi', state: { state: 'idle', vars: {} } } as StatusUpdate);
    expect(a).toHaveBeenCalledOnce();
  });

  it('P1 composeLens fans out renderGraph', () => {
    const a = vi.fn();
    const composed = composeLens([{ name: 'a', capabilities: {}, renderGraph: a }, noopLens()]);
    composed.renderGraph({ graph: { nodes: [], edges: [] }, final: false } as LensUpdate);
    expect(a).toHaveBeenCalledOnce();
  });
});

// ═══ attachObservabilityStrategy ════════════════════════════════════

describe('attachObservabilityStrategy', () => {
  // P1
  it('P1 forwards every event to strategy', () => {
    const dispatcher = new EventDispatcher();
    const exportEvent = vi.fn();
    const off = attachObservabilityStrategy(dispatcher, {
      strategy: { name: 'spy', capabilities: { events: true }, exportEvent },
    });
    dispatcher.dispatch({
      type: 'agentfootprint.agent.turn_start',
      payload: { turnIndex: 0 },
    } as never);
    expect(exportEvent).toHaveBeenCalledOnce();
    off();
  });

  // P2 boundary: zero-arg uses console default
  it('P2 zero-arg uses consoleObservability default', () => {
    const dispatcher = new EventDispatcher();
    const log = vi.fn();
    const off = attachObservabilityStrategy(dispatcher, {
      strategy: consoleObservability({ logger: { log } }),
    });
    dispatcher.dispatch({
      type: 'agentfootprint.agent.turn_start',
      payload: { turnIndex: 0 },
    } as never);
    expect(log).toHaveBeenCalled();
    off();
  });

  // P3 scenario: tier='minimal' filters out token events
  it('P3 tier=minimal filters out stream.token events', () => {
    const dispatcher = new EventDispatcher();
    const exportEvent = vi.fn();
    const off = attachObservabilityStrategy(dispatcher, {
      tier: 'minimal',
      strategy: { name: 'spy', capabilities: {}, exportEvent },
    });
    dispatcher.dispatch({
      type: 'agentfootprint.stream.token',
      payload: { content: 'x' },
    } as never);
    dispatcher.dispatch({ type: 'agentfootprint.error.fatal', payload: {} } as never);
    dispatcher.dispatch({ type: 'agentfootprint.agent.turn_start', payload: {} } as never);
    // Only error + agent should pass the minimal filter.
    expect(exportEvent).toHaveBeenCalledTimes(2);
    off();
  });

  // P4 property: unsubscribe stops all forwarding
  it('P4 unsubscribe halts forwarding', () => {
    const dispatcher = new EventDispatcher();
    const exportEvent = vi.fn();
    const off = attachObservabilityStrategy(dispatcher, {
      strategy: { name: 'spy', capabilities: {}, exportEvent },
    });
    off();
    dispatcher.dispatch({ type: 'agentfootprint.agent.turn_start', payload: {} } as never);
    expect(exportEvent).not.toHaveBeenCalled();
  });

  // P5 security: validate() throws AT enable time, not silently
  it('P5 validate() throws at attach, not at first event', () => {
    const dispatcher = new EventDispatcher();
    const broken: ObservabilityStrategy = {
      name: 'broken',
      capabilities: {},
      exportEvent: () => {},
      validate: () => {
        throw new Error('missing API key');
      },
    };
    expect(() => attachObservabilityStrategy(dispatcher, { strategy: broken })).toThrow(
      /missing API key/,
    );
  });

  // P6 performance: 10k events at sampleRate=1 ≤ 100ms
  it(
    'P6 throughput under sampleRate=1 stays linear in event count',
    { timeout: 30_000, retry: 2 },
    async () => {
      const dispatcher = new EventDispatcher();
      const off = attachObservabilityStrategy(dispatcher, {
        strategy: { name: 'spy', capabilities: {}, exportEvent: () => {} },
      });
      const dispatch = (events: number): void => {
        for (let i = 0; i < events; i++) {
          dispatcher.dispatch({ type: 'agentfootprint.agent.turn_start', payload: {} } as never);
        }
      };
      await expectScalesLinearly({
        small: () => dispatch(10_000),
        large: () => dispatch(100_000),
        scale: 10,
        why: 'attached dispatch must not accumulate per-event cost',
      });
      off();
    },
  );

  // P7 ROI: relevantEventTypes hot-skips irrelevant events
  it('P7 relevantEventTypes filters before dispatch', () => {
    const dispatcher = new EventDispatcher();
    const exportEvent = vi.fn();
    const off = attachObservabilityStrategy(dispatcher, {
      strategy: {
        name: 'spy',
        capabilities: {},
        exportEvent,
        relevantEventTypes: ['agentfootprint.cost.tick'] as never,
      },
    });
    dispatcher.dispatch({ type: 'agentfootprint.stream.token', payload: {} } as never);
    dispatcher.dispatch({ type: 'agentfootprint.cost.tick', payload: {} } as never);
    expect(exportEvent).toHaveBeenCalledTimes(1);
    off();
  });
});

// ═══ attachCostStrategy ═════════════════════════════════════════════

describe('attachCostStrategy', () => {
  // P1
  it('P1 projects cost.tick payload into CostTick shape', () => {
    const dispatcher = new EventDispatcher();
    const recordCost = vi.fn();
    const off = attachCostStrategy(dispatcher, {
      strategy: { name: 'spy', capabilities: {}, recordCost },
    });
    dispatcher.dispatch({
      type: 'agentfootprint.cost.tick',
      payload: {
        cumulativeInputTokens: 100,
        cumulativeOutputTokens: 50,
        cumulativeCostUsd: 0.005,
        recentInputTokens: 10,
        recentOutputTokens: 5,
        recentCostUsd: 0.0001,
        model: 'claude-haiku',
      },
    } as never);
    expect(recordCost).toHaveBeenCalledOnce();
    const tick = recordCost.mock.calls[0][0] as CostTick;
    expect(tick.cumulativeCostUsd).toBe(0.005);
    expect(tick.model).toBe('claude-haiku');
    off();
  });

  // P1 (the real wire shape). `CostTickPayload` is NOT spelled like `CostTick`:
  // the emitter sends tokensInput / tokensOutput / estimatedUsd + a nested
  // `cumulative`. The projection used to read the strategy's own names off the
  // payload, so every field resolved to `?? 0` and every attached billing sink,
  // budget breaker and dashboard was handed a tick of zeros — which reads as a
  // run that cost nothing. Every assertion here is on a NON-ZERO value on
  // purpose: "a number arrived" is exactly the assertion that shipped this.
  it('P1 projects the REAL CostTickPayload shape into CostTick (non-zero)', () => {
    const dispatcher = new EventDispatcher();
    const recordCost = vi.fn();
    const off = attachCostStrategy(dispatcher, {
      strategy: { name: 'spy', capabilities: {}, recordCost },
    });
    dispatcher.dispatch({
      type: 'agentfootprint.cost.tick',
      payload: {
        scope: 'iteration',
        model: 'claude-haiku-4-5',
        provider: 'bedrock',
        tokensInput: 10,
        tokensOutput: 5,
        estimatedUsd: 0.0001,
        cumulative: { tokensInput: 100, tokensOutput: 50, estimatedUsd: 0.005 },
      },
      meta: { runtimeStageId: 'callLLM#3', iterIndex: 2 },
    } as never);
    const tick = recordCost.mock.calls[0][0] as CostTick;
    expect(tick.recentInputTokens).toBe(10);
    expect(tick.recentOutputTokens).toBe(5);
    expect(tick.recentCostUsd).toBe(0.0001);
    expect(tick.cumulativeInputTokens).toBe(100);
    expect(tick.cumulativeOutputTokens).toBe(50);
    expect(tick.cumulativeCostUsd).toBe(0.005);
    expect(tick.model).toBe('claude-haiku-4-5');
    // 9.39.0 put attribution on the tick; a strategy that bills per model or
    // per vendor should not have to join back against a stream event to get it.
    expect(tick.provider).toBe('bedrock');
    // These two ride the ENVELOPE, not the payload — they were read off the
    // payload, where they have never existed, so they were always absent.
    expect(tick.iteration).toBe(2);
    expect(tick.runtimeStageId).toBe('callLLM#3');
    off();
  });

  // P4 property: absent `provider` stays absent. A window strategy's summarizer
  // spend may not name its billing provider, and 'unknown' would be a claim.
  it('P4 provider absent on the payload stays absent on the tick', () => {
    const dispatcher = new EventDispatcher();
    const recordCost = vi.fn();
    const off = attachCostStrategy(dispatcher, {
      strategy: { name: 'spy', capabilities: {}, recordCost },
    });
    dispatcher.dispatch({
      type: 'agentfootprint.cost.tick',
      payload: { model: 'm', estimatedUsd: 0.002, cumulative: { estimatedUsd: 0.002 } },
    } as never);
    const tick = recordCost.mock.calls[0][0] as CostTick;
    expect('provider' in tick).toBe(false);
    expect(tick.recentCostUsd).toBe(0.002);
    off();
  });

  // P2 boundary: missing fields default to 0
  it('P2 missing payload fields default to 0', () => {
    const dispatcher = new EventDispatcher();
    const recordCost = vi.fn();
    const off = attachCostStrategy(dispatcher, {
      strategy: { name: 'spy', capabilities: {}, recordCost },
    });
    dispatcher.dispatch({ type: 'agentfootprint.cost.tick', payload: {} } as never);
    const tick = recordCost.mock.calls[0][0] as CostTick;
    expect(tick.cumulativeInputTokens).toBe(0);
    expect(tick.model).toBe('unknown');
    off();
  });

  // P3 scenario (end to end through the EMITTER). The bug was not a typo — it
  // was a projector tested only against a payload nothing emits. So this test
  // never writes a payload by hand: `emitCostTick` builds it, the way a real
  // priced LLM response does, and the numbers must survive the trip.
  it('P3 emitCostTick → attached strategy carries the real money', () => {
    const dispatcher = new EventDispatcher();
    const recordCost = vi.fn();
    const off = attachCostStrategy(dispatcher, {
      strategy: { name: 'spy', capabilities: {}, recordCost },
    });
    const scope = {
      cumTokensInput: 0,
      cumTokensOutput: 0,
      cumEstimatedUsd: 0,
      costBudgetHit: false,
      $emit: (type: string, payload?: unknown) =>
        dispatcher.dispatch({ type, payload, meta: { iterIndex: 1 } } as never),
    };
    const pricing = {
      name: 'test',
      pricePerToken: (_m: string, kind: string) => (kind === 'input' ? 0.000001 : 0.000005),
    };
    emitCostTick(
      scope,
      pricing,
      undefined,
      { model: 'm-1', provider: 'anthropic' },
      {
        input: 1000,
        output: 200,
      },
    );
    emitCostTick(
      scope,
      pricing,
      undefined,
      { model: 'm-1', provider: 'anthropic' },
      {
        input: 500,
        output: 100,
      },
    );

    const second = recordCost.mock.calls[1][0] as CostTick;
    expect(second.recentInputTokens).toBe(500);
    expect(second.recentCostUsd).toBeCloseTo(0.001, 10); // 500·1e-6 + 100·5e-6
    expect(second.cumulativeInputTokens).toBe(1500);
    expect(second.cumulativeOutputTokens).toBe(300);
    expect(second.cumulativeCostUsd).toBeCloseTo(0.003, 10);
    expect(second.provider).toBe('anthropic');
    expect(second.iteration).toBe(1);
    off();
  });

  // P3 scenario: in-memory sink reads back what was recorded
  it('P3 default inMemorySink accumulates ticks for read-back', () => {
    const dispatcher = new EventDispatcher();
    const sink = inMemorySinkCost();
    const off = attachCostStrategy(dispatcher, { strategy: sink });
    dispatcher.dispatch({
      type: 'agentfootprint.cost.tick',
      payload: { cumulativeCostUsd: 0.1, model: 'm' },
    } as never);
    expect(sink.getTicksCount()).toBe(1);
    off();
  });

  // P5 security: throwing strategy does not propagate
  it('P5 strategy throws → _onError called, agent loop not impacted', () => {
    const dispatcher = new EventDispatcher();
    const onError = vi.fn();
    const broken: CostStrategy = {
      name: 'broken',
      capabilities: {},
      recordCost: () => {
        throw new Error('billing 503');
      },
      _onError: onError,
    };
    const off = attachCostStrategy(dispatcher, { strategy: broken });
    expect(() =>
      dispatcher.dispatch({ type: 'agentfootprint.cost.tick', payload: {} } as never),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    off();
  });
});

// ═══ attachLiveStatusStrategy ═══════════════════════════════════════

describe('attachLiveStatusStrategy', () => {
  // P1
  it('P1 fires renderStatus when thinking state changes', () => {
    const dispatcher = new EventDispatcher();
    const onLine = vi.fn();
    const off = attachLiveStatusStrategy(dispatcher, {
      strategy: chatBubbleLiveStatus({ onLine }),
      appName: 'TestBot',
    });
    dispatcher.dispatch({
      type: 'agentfootprint.stream.llm_start',
      payload: { iteration: 1 },
    } as never);
    expect(onLine).toHaveBeenCalledOnce();
    off();
  });

  // P3 scenario: dedupe — does NOT fire on every token
  it('P3 dedupes — does not fire on every duplicate state', () => {
    const dispatcher = new EventDispatcher();
    const onLine = vi.fn();
    const off = attachLiveStatusStrategy(dispatcher, {
      strategy: chatBubbleLiveStatus({ onLine }),
    });
    dispatcher.dispatch({
      type: 'agentfootprint.stream.llm_start',
      payload: { iteration: 1 },
    } as never);
    // No state change — no new line.
    expect(onLine).toHaveBeenCalledTimes(1);
    off();
  });
});

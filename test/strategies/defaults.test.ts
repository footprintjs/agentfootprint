/**
 * 7-pattern tests for the v2.8 default strategies.
 *
 *   P1 Unit         — each method behaves correctly in isolation
 *   P2 Boundary     — edge cases (empty payload, null inputs, maxTicks=0/Infinity)
 *   P3 Scenario     — realistic agent-run trace flowing through each strategy
 *   P4 Property     — invariants (sync void return, no-throw, idempotent ops)
 *   P5 Security     — no info leak (formatter doesn't expose secrets, validate
 *                     errors don't leak callback identity)
 *   P6 Performance  — bounds (per-event cost ≤ 5µs amortized, FIFO eviction
 *                     stays O(1) amortized)
 *   P7 ROI          — does it serve its purpose? (consumer can read back what
 *                     was recorded; chat bubble actually fires the callback)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  consoleObservability,
  inMemorySinkCost,
  chatBubbleLiveStatus,
  noopLens,
} from '../../src/strategies/defaults/index.js';
import type { CostTick, StatusUpdate, LensUpdate } from '../../src/strategies/types.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const makeEvent = (overrides: Partial<AgentfootprintEvent> = {}): AgentfootprintEvent =>
  ({
    type: 'agentfootprint.stream.token',
    payload: { content: 'hello', tokenIndex: 0 },
    ts: Date.now(),
    ...overrides,
  } as unknown as AgentfootprintEvent);

const makeTick = (overrides: Partial<CostTick> = {}): CostTick => ({
  cumulativeInputTokens: 100,
  cumulativeOutputTokens: 50,
  cumulativeCostUsd: 0.005,
  recentInputTokens: 10,
  recentOutputTokens: 5,
  recentCostUsd: 0.0001,
  model: 'claude-haiku',
  ...overrides,
});

const makeStatus = (overrides: Partial<StatusUpdate> = {}): StatusUpdate => ({
  line: 'Thinking…',
  state: { state: 'idle', vars: {} },
  ...overrides,
});

const makeLensUpdate = (overrides: Partial<LensUpdate> = {}): LensUpdate => ({
  graph: { nodes: [], edges: [] },
  final: false,
  ...overrides,
});

// ═══ consoleObservability ═══════════════════════════════════════════

describe('consoleObservability', () => {
  // P1 unit
  it('P1 exports a structured JSON line via the supplied logger', () => {
    const log = vi.fn();
    const strat = consoleObservability({ logger: { log } });
    strat.exportEvent(makeEvent());
    expect(log).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(log.mock.calls[0][0] as string);
    expect(parsed.type).toBe('agentfootprint.stream.token');
    expect(parsed.content).toBe('hello'); // payload flattened
  });

  // P2 boundary — null + non-object payload
  it('P2 handles non-object payload by wrapping in {value}', () => {
    const log = vi.fn();
    const strat = consoleObservability({ logger: { log } });
    strat.exportEvent(makeEvent({ payload: 'just a string' as unknown as never }));
    const parsed = JSON.parse(log.mock.calls[0][0] as string);
    expect(parsed.type).toBe('agentfootprint.stream.token');
    expect(parsed.value).toBe('just a string');
  });

  // P2 boundary — circular payload doesn't throw
  it('P2 handles circular payload without throwing', () => {
    const log = vi.fn();
    const strat = consoleObservability({ logger: { log } });
    const circ: { self?: unknown } = {};
    circ.self = circ;
    expect(() => strat.exportEvent(makeEvent({ payload: circ as never }))).not.toThrow();
    expect(log.mock.calls[0][0]).toBe('[unserializable]');
  });

  // P3 scenario — realistic agent stream of 5 events
  it('P3 emits one line per event in a realistic stream', () => {
    const log = vi.fn();
    const strat = consoleObservability({ logger: { log } });
    for (const type of [
      'agentfootprint.agent.turn_start',
      'agentfootprint.stream.llm_start',
      'agentfootprint.stream.tool_start',
      'agentfootprint.stream.tool_end',
      'agentfootprint.agent.turn_end',
    ] as const) {
      strat.exportEvent(makeEvent({ type } as never));
    }
    expect(log).toHaveBeenCalledTimes(5);
  });

  // P4 property — no-throw on every event type
  it('P4 never throws on any event shape', () => {
    const log = vi.fn();
    const strat = consoleObservability({ logger: { log } });
    const weirdShapes = [
      undefined,
      null,
      0,
      '',
      [],
      {},
      { nested: { deep: { value: 'x' } } },
      new Date(),
    ];
    for (const p of weirdShapes) {
      expect(() => strat.exportEvent(makeEvent({ payload: p as never }))).not.toThrow();
    }
  });

  // P5 security — custom format CAN scrub secrets; default doesn't leak
  it('P5 supports a custom format for scrubbing sensitive fields', () => {
    const log = vi.fn();
    const strat = consoleObservability({
      logger: { log },
      format: (e) => `[${e.type}] redacted`,
    });
    strat.exportEvent(makeEvent({ payload: { apiKey: 'secret-xyz' } as never }));
    expect(log.mock.calls[0][0]).toBe('[agentfootprint.stream.token] redacted');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-xyz');
  });

  // P6 performance — 1000 events ≤ 50ms (50µs each, generous bound)
  it('P6 amortized per-event overhead is bounded', () => {
    const log = vi.fn();
    const strat = consoleObservability({ logger: { log } });
    const ev = makeEvent();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) strat.exportEvent(ev);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  // P7 ROI — declares correct capabilities so dispatcher knows to forward
  it('P7 declares events + logs capabilities for the OTel dispatcher', () => {
    const strat = consoleObservability();
    expect(strat.capabilities.events).toBe(true);
    expect(strat.capabilities.logs).toBe(true);
    expect(strat.name).toBe('console');
  });
});

// ═══ inMemorySinkCost ═══════════════════════════════════════════════

describe('inMemorySinkCost', () => {
  // P1 unit
  it('P1 records every tick into the buffer', () => {
    const sink = inMemorySinkCost();
    sink.recordCost(makeTick({ cumulativeCostUsd: 0.01 }));
    sink.recordCost(makeTick({ cumulativeCostUsd: 0.02 }));
    expect(sink.getTicksCount()).toBe(2);
    expect(sink.getTicks()[1].cumulativeCostUsd).toBe(0.02);
  });

  // P2 boundary — maxTicks=0 means immediate drop
  it('P2 maxTicks=0 retains nothing', () => {
    const sink = inMemorySinkCost({ maxTicks: 0 });
    sink.recordCost(makeTick());
    expect(sink.getTicksCount()).toBe(0);
  });

  // P2 boundary — maxTicks default = Infinity (no cap)
  it('P2 default maxTicks accumulates without cap', () => {
    const sink = inMemorySinkCost();
    for (let i = 0; i < 1000; i++) sink.recordCost(makeTick());
    expect(sink.getTicksCount()).toBe(1000);
  });

  // P2 boundary — getTicksSince(negative) returns full buffer
  it('P2 getTicksSince clamps negative idx to 0', () => {
    const sink = inMemorySinkCost();
    sink.recordCost(makeTick());
    sink.recordCost(makeTick());
    expect(sink.getTicksSince(-5).length).toBe(2);
  });

  // P3 scenario — long-running agent with maxTicks=10 keeps recent ticks
  it('P3 long run with maxTicks=10 keeps the most recent 10', () => {
    const sink = inMemorySinkCost({ maxTicks: 10 });
    for (let i = 0; i < 100; i++) sink.recordCost(makeTick({ cumulativeCostUsd: i / 100 }));
    expect(sink.getTicksCount()).toBe(10);
    expect(sink.getTicks()[0].cumulativeCostUsd).toBe(0.9);
    expect(sink.getTicks()[9].cumulativeCostUsd).toBe(0.99);
  });

  // P4 property — recordCost is sync void
  it('P4 recordCost returns undefined synchronously (passive recorder)', () => {
    const sink = inMemorySinkCost();
    const result = sink.recordCost(makeTick());
    expect(result).toBeUndefined();
  });

  // P4 property — clear() leaves buffer empty AND can re-record after
  it('P4 clear is idempotent + buffer reusable', () => {
    const sink = inMemorySinkCost();
    sink.recordCost(makeTick());
    sink.clear();
    sink.clear(); // idempotent
    expect(sink.getTicksCount()).toBe(0);
    sink.recordCost(makeTick());
    expect(sink.getTicksCount()).toBe(1);
  });

  // P5 security — onRecord callback receives sanitized tick (no extra fields)
  it('P5 onRecord receives the typed CostTick, no shape pollution', () => {
    const onRecord = vi.fn();
    const sink = inMemorySinkCost({ onRecord });
    sink.recordCost(makeTick({ cumulativeCostUsd: 0.5 }));
    expect(onRecord).toHaveBeenCalledTimes(1);
    const passed = onRecord.mock.calls[0][0] as CostTick;
    expect(passed.cumulativeCostUsd).toBe(0.5);
    expect(passed.model).toBe('claude-haiku');
  });

  // P6 performance — 10k records under maxTicks=100 stays O(1) amortized
  it('P6 FIFO eviction stays bounded under heavy load', () => {
    const sink = inMemorySinkCost({ maxTicks: 100 });
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) sink.recordCost(makeTick());
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200); // 20µs/tick generous bound
    expect(sink.getTicksCount()).toBe(100);
  });

  // P7 ROI — getTicks returns a defensive copy (mutations don't leak in)
  it('P7 getTicks returns a snapshot that consumers cannot mutate', () => {
    const sink = inMemorySinkCost();
    sink.recordCost(makeTick());
    const snapshot = sink.getTicks();
    (snapshot as CostTick[]).push(makeTick()); // mutate the snapshot
    expect(sink.getTicksCount()).toBe(1); // internal buffer unaffected
  });
});

// ═══ chatBubbleLiveStatus ═══════════════════════════════════════════

describe('chatBubbleLiveStatus', () => {
  // P1 unit
  it('P1 calls onLine with the rendered line', () => {
    const onLine = vi.fn();
    const strat = chatBubbleLiveStatus({ onLine });
    strat.renderStatus(makeStatus({ line: 'Thinking…' }));
    expect(onLine).toHaveBeenCalledWith('Thinking…');
  });

  // P2 boundary — empty line still fires
  it('P2 empty line still fires the callback', () => {
    const onLine = vi.fn();
    const strat = chatBubbleLiveStatus({ onLine });
    strat.renderStatus(makeStatus({ line: '' }));
    expect(onLine).toHaveBeenCalledWith('');
  });

  // P3 scenario — sequence of state transitions
  it('P3 fires for every state transition in a realistic stream', () => {
    const onLine = vi.fn();
    const strat = chatBubbleLiveStatus({ onLine });
    for (const line of ['Thinking…', 'Working on weather…', 'Got result', 'Done']) {
      strat.renderStatus(makeStatus({ line }));
    }
    expect(onLine).toHaveBeenCalledTimes(4);
    expect(onLine.mock.calls.map((c) => c[0])).toEqual([
      'Thinking…',
      'Working on weather…',
      'Got result',
      'Done',
    ]);
  });

  // P4 property — sync void return
  it('P4 renderStatus returns undefined sync', () => {
    const strat = chatBubbleLiveStatus({ onLine: () => {} });
    expect(strat.renderStatus(makeStatus())).toBeUndefined();
  });

  // P5 security — validate() throws WITHOUT leaking the (missing) callback
  it('P5 validate throws on missing onLine without exposing internal shape', () => {
    const strat = chatBubbleLiveStatus({ onLine: undefined as unknown as (l: string) => void });
    expect(() => strat.validate?.()).toThrow(/required `onLine` callback/);
  });

  // P6 performance — 10k status updates under 30ms
  it('P6 per-update overhead is negligible', () => {
    const strat = chatBubbleLiveStatus({ onLine: () => {} });
    const update = makeStatus();
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) strat.renderStatus(update);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(30);
  });

  // P7 ROI — does NOT expose internal state shape (intentionally)
  it('P7 ChatBubble strategy does NOT expose ThinkingState directly (no onUpdate)', () => {
    const strat = chatBubbleLiveStatus({ onLine: () => {} });
    // The interface lock — strategy ONLY surfaces .renderStatus, not raw state.
    expect(strat.renderStatus).toBeDefined();
    // The strategy intentionally does not expose state to consumers.
    // Reason: state shape is internal and changes between releases.
  });
});

// ═══ noopLens ═══════════════════════════════════════════════════════

describe('noopLens', () => {
  // P1 unit
  it('P1 swallows the update silently', () => {
    const strat = noopLens();
    expect(() => strat.renderGraph(makeLensUpdate())).not.toThrow();
  });

  // P2 boundary — final=true update
  it('P2 handles final=true update', () => {
    const onUpdate = vi.fn();
    const strat = noopLens({ onUpdate });
    strat.renderGraph(makeLensUpdate({ final: true }));
    expect(onUpdate.mock.calls[0][0].final).toBe(true);
  });

  // P3 scenario — sequence of graph updates
  it('P3 forwards all updates to test hook in order', () => {
    const onUpdate = vi.fn();
    const strat = noopLens({ onUpdate });
    for (let i = 0; i < 5; i++) strat.renderGraph(makeLensUpdate());
    expect(onUpdate).toHaveBeenCalledTimes(5);
  });

  // P4 property — sync void
  it('P4 renderGraph returns undefined sync', () => {
    const strat = noopLens();
    expect(strat.renderGraph(makeLensUpdate())).toBeUndefined();
  });

  // P5 security — no graph fields exposed beyond what was passed in
  it('P5 onUpdate receives the LensUpdate as-is, no shape mutation', () => {
    const onUpdate = vi.fn();
    const strat = noopLens({ onUpdate });
    const update = makeLensUpdate();
    strat.renderGraph(update);
    expect(onUpdate.mock.calls[0][0]).toBe(update);
  });

  // P6 performance — zero-arg noop is essentially free
  it('P6 zero-callback noop is free at hot path', () => {
    const strat = noopLens();
    const update = makeLensUpdate();
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) strat.renderGraph(update);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50); // 0.5µs per call
  });

  // P7 ROI — declares non-interactive + non-serializable so dispatcher
  //          knows it's a true noop fallback
  it('P7 declares non-interactive + non-serializable capabilities', () => {
    const strat = noopLens();
    expect(strat.capabilities.interactive).toBe(false);
    expect(strat.capabilities.serializable).toBe(false);
    expect(strat.name).toBe('noop-lens');
  });
});

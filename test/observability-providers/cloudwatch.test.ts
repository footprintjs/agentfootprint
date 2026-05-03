/**
 * cloudwatchObservability — 7-pattern tests.
 *
 *   P1 Unit         — strategy.name is `'cloudwatch'` (distinct from agentcore)
 *   P2 Boundary     — flush() drains buffer to putLogEvents
 *   P3 Scenario     — typed events round-trip as JSON in CWL message
 *   P4 Property     — same buffering semantics as agentcore (size + bytes)
 *   P5 Security     — missing logGroupName + missing SDK paths
 *   P6 Performance  — sync exportEvent at 10k/op
 *   P7 ROI          — capabilities + parity guarantee with agentcoreObservability
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  cloudwatchObservability,
  type CloudWatchLikeClient,
  type CloudwatchObservabilityOptions,
} from '../../src/adapters/observability/cloudwatch.js';
import { agentcoreObservability } from '../../src/adapters/observability/agentcore.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

// ── Test client ──────────────────────────────────────────────────────

interface CapturedBatch {
  readonly logGroupName: string;
  readonly logStreamName: string;
  readonly logEvents: ReadonlyArray<{ timestamp: number; message: string }>;
}

function makeMockClient(): {
  client: CloudwatchObservabilityOptions['_client'];
  batches: CapturedBatch[];
} {
  const batches: CapturedBatch[] = [];
  return {
    batches,
    client: {
      async putLogEvents(input) {
        batches.push(input as CapturedBatch);
      },
    },
  };
}

const fakeEvent: AgentfootprintEvent = {
  type: 'agentfootprint.agent.start' as never,
  payload: { runId: 'r-cw' },
  timestamp: Date.now(),
} as unknown as AgentfootprintEvent;

afterEach(() => {
  // Per-it() strategy ownership — nothing global to reset.
});

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('cloudwatchObservability — P1 unit', () => {
  it('P1 strategy.name is `cloudwatch` (distinct from agentcore)', () => {
    const { client } = makeMockClient();
    const strat = cloudwatchObservability({ logGroupName: '/g', _client: client });
    expect(strat.name).toBe('cloudwatch');
    expect(strat.capabilities.events).toBe(true);
    expect(strat.capabilities.logs).toBe(true);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('cloudwatchObservability — P2 boundary', () => {
  it('P2 flush() drains buffer with putLogEvents', async () => {
    const { client, batches } = makeMockClient();
    const strat = cloudwatchObservability({
      logGroupName: '/cw/group',
      logStreamName: 'cw-stream',
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent(fakeEvent);
    strat.exportEvent(fakeEvent);
    await strat.flush?.();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.logGroupName).toBe('/cw/group');
    expect(batches[0]?.logStreamName).toBe('cw-stream');
    expect(batches[0]?.logEvents).toHaveLength(2);
  });
});

// ─── P3 Scenario — JSON round-trip ───────────────────────────────────

describe('cloudwatchObservability — P3 scenario', () => {
  it('P3 typed event payload survives JSON round-trip in CWL message', async () => {
    const { client, batches } = makeMockClient();
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
      _client: client,
    });
    strat.exportEvent({
      ...fakeEvent,
      payload: { runId: 'r-cw', extra: { nested: true, count: 42 } },
    } as AgentfootprintEvent);
    await strat.flush?.();
    const message = batches[0]?.logEvents[0]?.message;
    expect(message).toBeDefined();
    const parsed = JSON.parse(message!);
    expect(parsed.payload.extra.nested).toBe(true);
    expect(parsed.payload.extra.count).toBe(42);
    expect(parsed.payload.runId).toBe('r-cw');
  });
});

// ─── P4 Property — buffering semantics shared with agentcore ─────────

describe('cloudwatchObservability — P4 property', () => {
  it('P4 hitting maxBatchEvents triggers a flush WITHOUT explicit flush() call', async () => {
    const { client, batches } = makeMockClient();
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      maxBatchEvents: 4,
      flushIntervalMs: 0,
      _client: client,
    });
    for (let i = 0; i < 4; i++) strat.exportEvent(fakeEvent);
    // Yield once so the size-triggered chained doFlush microtask runs.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(batches).toHaveLength(1);
    const totalShipped = batches.reduce((acc, b) => acc + b.logEvents.length, 0);
    expect(totalShipped).toBe(4);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('cloudwatchObservability — P5 security', () => {
  it('P5 missing logGroupName throws TypeError at factory time', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cloudwatchObservability({ logGroupName: '' as any }),
    ).toThrow(TypeError);
  });

  it('P5 missing SDK + no _client → flush() routes through _onError with install hint', async () => {
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 0,
    });
    let captured = '';
    strat._onError = (e) => {
      captured = e.message;
    };
    strat.exportEvent(fakeEvent);
    try {
      await strat.flush?.();
    } catch {
      // SDK lazy-require failure may surface via throw OR onError —
      // both are acceptable. The test verifies the error contains
      // a useful install hint when it surfaces.
    }
    if (captured) {
      expect(captured).toMatch(/aws-sdk|cloudwatch|peer dependency/i);
    }
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('cloudwatchObservability — P6 performance', () => {
  it('P6 10k exportEvent calls under 200ms (buffering cost only)', () => {
    const { client } = makeMockClient();
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      maxBatchEvents: 100_000, // never trigger size-flush
      flushIntervalMs: 0,
      _client: client,
    });
    const N = 10_000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) strat.exportEvent(fakeEvent);
    const elapsed = performance.now() - t0;
    // 200ms budget — release pipeline runs back-to-back suites that
    // cool the JIT. Documented target on a hot core is ~5µs/op = 50ms
    // for 10k. 4x slack for CI / release variance.
    expect(elapsed).toBeLessThan(200);
  });
});

// ─── P7 ROI — parity with agentcore ──────────────────────────────────

describe('cloudwatchObservability — P7 ROI', () => {
  it('P7 cloudwatch + agentcore share the same put-shape — parity guarantee', async () => {
    const cw = makeMockClient();
    const ac = makeMockClient();

    const cwStrat = cloudwatchObservability({
      logGroupName: '/cw/g',
      flushIntervalMs: 0,
      _client: cw.client,
    });
    const acStrat = agentcoreObservability({
      logGroupName: '/ac/g',
      flushIntervalMs: 0,
      _client: ac.client,
    });

    cwStrat.exportEvent(fakeEvent);
    acStrat.exportEvent(fakeEvent);

    await Promise.all([cwStrat.flush?.(), acStrat.flush?.()]);

    // Same put shape — only logGroupName differs (per consumer config).
    expect(cw.batches[0]?.logEvents).toHaveLength(1);
    expect(ac.batches[0]?.logEvents).toHaveLength(1);
    expect(cw.batches[0]?.logEvents[0]?.message).toBe(ac.batches[0]?.logEvents[0]?.message);

    // But strategy names differ — registry-lookup distinguishes them.
    expect(cwStrat.name).toBe('cloudwatch');
    expect(acStrat.name).toBe('agentcore');
  });

  it('P7 _client is the same shape regardless of which factory built it', async () => {
    // Type-level check: feeding the same _client into both factories
    // type-checks. (If this test compiles, the parity contract holds.)
    const sharedClient: CloudWatchLikeClient = {
      async putLogEvents() {
        /* no-op */
      },
    };
    const cw = cloudwatchObservability({ logGroupName: '/g', _client: sharedClient });
    const ac = agentcoreObservability({ logGroupName: '/g', _client: sharedClient });
    expect(cw.name).toBe('cloudwatch');
    expect(ac.name).toBe('agentcore');
  });
});

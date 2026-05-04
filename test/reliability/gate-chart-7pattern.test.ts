/**
 * Reliability gate chart — 7-pattern tests.
 *
 * Tests the multi-stage chart returned by `buildReliabilityGateChart` by
 * mounting it as a subflow inside a tiny parent chart and running via
 * `FlowChartExecutor`. This is end-to-end through the engine: real
 * narrative, real recorder events, real commitLog.
 *
 *   P1 Unit         — pure rule evaluation paths through PreCheck/PostDecide
 *   P2 Boundary     — single-attempt error, retry exhausted, breaker just trips
 *   P3 Scenario     — full retry chains across providers; fallback repair
 *   P4 Property     — first-match-wins; default branch when no rule matches
 *   P5 Security     — fail-fast emit payload structure; misconfigured providers
 *   P6 Performance  — happy path completes promptly
 *   P7 ROI          — rule label flows into $break reason for narrative
 *
 * The parent chart `inputMapper` seeds the gate's scope; `outputMapper`
 * surfaces the final state for assertions. A real `FlowChartExecutor`
 * drives the loopTo + break propagation exactly as production does.
 */

import { describe, expect, it } from 'vitest';
import { FlowChartExecutor, flowChart } from 'footprintjs';
import { buildReliabilityGateChart } from '../../src/reliability/buildReliabilityGateChart.js';
import type {
  ReliabilityConfig,
  ReliabilityProvider,
  ReliabilityScope,
} from '../../src/reliability/types.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';

// ─── Test helpers ────────────────────────────────────────────────────

function okProvider(name: string, content = 'ok response'): LLMProvider {
  return {
    name,
    complete: async (): Promise<LLMResponse> => ({
      content,
      toolCalls: [],
      usage: { input: 1, output: 1 },
    }),
  };
}

function failingProvider(name: string, err: Error): LLMProvider {
  return {
    name,
    complete: async (): Promise<LLMResponse> => {
      throw err;
    },
  };
}

function flakeyProvider(name: string, failNTimes: number, errFactory: () => Error): LLMProvider {
  let calls = 0;
  return {
    name,
    complete: async (): Promise<LLMResponse> => {
      calls += 1;
      if (calls <= failNTimes) throw errFactory();
      return { content: 'recovered', toolCalls: [], usage: { input: 1, output: 1 } };
    },
  };
}

function http(status: number, msg: string): Error {
  const e = new Error(msg) as Error & { status: number };
  e.status = status;
  return e;
}

/**
 * Mount the gate chart inside a minimal parent chart, run it, and return
 * the final scope state for assertions.
 *
 * Parent chart shape:
 *   Seed (initializes ReliabilityScope state from test inputs)
 *     → sf-reliability (the gate chart, mounted as subflow)
 *     → CaptureExit (no-op stage so the test can read post-subflow state)
 */
async function runGate(opts: {
  config: ReliabilityConfig;
  request?: { messages: { role: string; content: string }[] };
  cumulativeCostUsd?: number;
}): Promise<{
  finalScope: Record<string, unknown>;
  breakReason?: string;
  emits: Array<{ name: string; payload?: unknown }>;
}> {
  const gateChart = buildReliabilityGateChart(opts.config);
  const providers = (opts.config.providers ?? []) as ReliabilityProvider[];
  const request = opts.request ?? { messages: [] };

  interface ParentState {
    [k: string]: unknown;
    seeded?: boolean;
    captured?: boolean;
  }

  const captured: { finalScope?: Record<string, unknown> } = {};
  const emits: Array<{ name: string; payload?: unknown }> = [];

  const parentChart = flowChart<ParentState>(
    'Seed',
    (s) => {
      s.seeded = true;
    },
    'parent-seed',
  )
    .addSubFlowChartNext('sf-reliability', gateChart, 'Reliability', {
      // inputMapper supplies READ-ONLY inputs only (the subflow's
      // "args"). MUTABLE state (attempt, providerIdx, errorKind, etc.)
      // is initialized by the gate chart's Init stage by reading args.
      inputMapper: (): Partial<ReliabilityScope> & { request: unknown } => ({
        request: request as never,
        providersCount: providers.length,
        hasFallback: opts.config.fallback !== undefined,
        ...(opts.cumulativeCostUsd !== undefined && {
          cumulativeCostUsd: opts.cumulativeCostUsd,
        }),
      }),
      outputMapper: (sf): Record<string, unknown> => {
        captured.finalScope = sf as Record<string, unknown>;
        return {
          gateExited: true,
          ...(sf as Record<string, unknown>),
        };
      },
    })
    .addFunction(
      'CaptureExit',
      (s) => {
        s.captured = true;
      },
      'capture-exit',
    )
    .build();

  const executor = new FlowChartExecutor(parentChart);
  // Attach an emit recorder
  executor.attachCombinedRecorder({
    id: 'test-emits',
    onEmit(e: { name: string; payload?: unknown }) {
      emits.push({ name: e.name, payload: e.payload });
    },
  } as never);

  await executor.run({});

  const snap = executor.getSnapshot();
  return {
    finalScope: captured.finalScope ?? (snap?.sharedState as Record<string, unknown>) ?? {},
    ...(snap?.breakFlag?.reason !== undefined && { breakReason: snap.breakFlag.reason }),
    emits,
  };
}

// ────────────────────────────────────────────────────────────────────
// P1 — Unit: pure rule evaluation through chart
// ────────────────────────────────────────────────────────────────────

describe('reliability gate chart — P1 unit', () => {
  it('P1 ok decision (no rules, success) exits ok', async () => {
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider: okProvider('p1'), model: 'm' }],
      },
    });

    expect(result.finalScope.errorKind).toBe('ok');
    expect(result.finalScope.failKind).toBeUndefined();
    expect(result.finalScope.attempt).toBe(1);
    expect((result.finalScope.response as LLMResponse | undefined)?.content).toBe('ok response');
  });

  it('P1 retry rule loops; success on 2nd attempt exits', async () => {
    const result = await runGate({
      config: {
        providers: [
          {
            name: 'p1',
            provider: flakeyProvider('p1', 1, () => http(503, 'transient')),
            model: 'm',
          },
        ],
        postDecide: [
          {
            when: (s) => s.errorKind === '5xx-transient' && s.attempt < 3,
            then: 'retry',
            kind: 'transient-retry',
          },
        ],
      },
    });

    expect(result.finalScope.attempt).toBe(2);
    expect(result.finalScope.errorKind).toBe('ok');
    expect(result.finalScope.failKind).toBeUndefined();
    expect((result.finalScope.response as LLMResponse | undefined)?.content).toBe('recovered');
  });

  it('P1 fail-fast rule sets failKind, $emits, $breaks subflow with reason', async () => {
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider: failingProvider('p1', http(500, 'down')), model: 'm' }],
        postDecide: [
          {
            when: (s) => s.error !== undefined,
            then: 'fail-fast',
            kind: 'unrecoverable',
            label: '5xx with no retry budget',
          },
        ],
      },
    });

    expect(result.finalScope.failKind).toBe('unrecoverable');
    expect(result.emits.some((e) => e.name === 'agentfootprint.reliability.fail_fast')).toBe(true);
    const failEmit = result.emits.find((e) => e.name === 'agentfootprint.reliability.fail_fast');
    expect((failEmit?.payload as { kind: string }).kind).toBe('unrecoverable');
  });

  it('P1 pre-check fail-fast skips the LLM call entirely', async () => {
    let providerCalled = false;
    const result = await runGate({
      config: {
        providers: [
          {
            name: 'p1',
            provider: {
              name: 'p1',
              complete: async () => {
                providerCalled = true;
                return { content: 'never', toolCalls: [], usage: { input: 0, output: 0 } };
              },
            },
            model: 'm',
          },
        ],
        preCheck: [
          {
            when: (s) => (s.cumulativeCostUsd ?? 0) >= 5,
            then: 'fail-fast',
            kind: 'cost-cap-exceeded',
          },
        ],
      },
      cumulativeCostUsd: 5.2,
    });

    expect(providerCalled).toBe(false);
    expect(result.finalScope.failKind).toBe('cost-cap-exceeded');
    expect(result.finalScope.attempt).toBe(0); // never called
  });
});

// ────────────────────────────────────────────────────────────────────
// P2 — Boundary
// ────────────────────────────────────────────────────────────────────

describe('reliability gate chart — P2 boundary', () => {
  it('P2 retry exhausted at exactly maxAttempts → fail-fast rule fires', async () => {
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider: failingProvider('p1', http(503, 'down')), model: 'm' }],
        postDecide: [
          {
            when: (s) => s.errorKind === '5xx-transient' && s.attempt < 3,
            then: 'retry',
            kind: 'transient-retry',
          },
          { when: (s) => s.error !== undefined, then: 'fail-fast', kind: 'retry-exhausted' },
        ],
      },
    });

    expect(result.finalScope.attempt).toBe(3);
    expect(result.finalScope.failKind).toBe('retry-exhausted');
  });

  it('P2 retry-other advances providerIdx exactly once', async () => {
    const result = await runGate({
      config: {
        providers: [
          { name: 'p1', provider: failingProvider('p1', http(503, 'down')), model: 'm' },
          { name: 'p2', provider: okProvider('p2', 'p2-ok'), model: 'm' },
        ],
        postDecide: [
          {
            when: (s) => s.errorKind === '5xx-transient' && s.canSwitchProvider,
            then: 'retry-other',
            kind: 'switch-provider',
          },
          { when: (s) => s.error !== undefined, then: 'fail-fast', kind: 'no-providers-left' },
        ],
      },
    });

    expect(result.finalScope.providerIdx).toBe(1);
    expect(result.finalScope.currentProvider).toBe('p2');
    expect((result.finalScope.response as LLMResponse | undefined)?.content).toBe('p2-ok');
    expect(result.finalScope.failKind).toBeUndefined();
  });

  it('P2 circuit breaker trips at exactly failureThreshold', async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: 'p1',
      complete: async () => {
        callCount += 1;
        throw http(500, 'down');
      },
    };
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider, model: 'm' }],
        circuitBreaker: { failureThreshold: 3, cooldownMs: 60_000 },
        postDecide: [
          {
            when: (s) => s.errorKind === 'circuit-open',
            then: 'fail-fast',
            kind: 'circuit-tripped',
          },
          {
            when: (s) => s.errorKind === '5xx-transient' && s.attempt < 5,
            then: 'retry',
            kind: 'transient-retry',
          },
          { when: (s) => s.error !== undefined, then: 'fail-fast', kind: 'unrecoverable' },
        ],
      },
    });

    // Exactly 3 calls counted before breaker opens; the 4th attempt
    // fast-fails with circuit-open, classified as 'circuit-open',
    // which the first rule routes to 'circuit-tripped' fail-fast.
    expect(callCount).toBe(3);
    const breakerStates = result.finalScope.breakerStates as Record<string, { state: string }>;
    expect(breakerStates['p1'].state).toBe('open');
    expect(result.finalScope.failKind).toBe('circuit-tripped');
  });
});

// ────────────────────────────────────────────────────────────────────
// P3 — Scenario
// ────────────────────────────────────────────────────────────────────

describe('reliability gate chart — P3 scenario', () => {
  it('P3 fallback function repairs schema-fail and exits ok', async () => {
    const provider: LLMProvider = {
      name: 'p1',
      complete: async () => {
        const e = new Error('malformed JSON') as Error & { code: string };
        e.code = 'ERR_OUTPUT_SCHEMA';
        throw e;
      },
    };
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider, model: 'm' }],
        postDecide: [
          {
            when: (s) => s.errorKind === 'schema-fail' && s.hasFallback,
            then: 'fallback',
            kind: 'output-repair',
          },
        ],
        fallback: async (): Promise<LLMResponse> => ({
          content: 'repaired by fallback',
          toolCalls: [],
          usage: { input: 1, output: 1 },
        }),
      },
    });

    expect(result.finalScope.errorKind).toBe('ok');
    expect((result.finalScope.response as LLMResponse | undefined)?.content).toBe(
      'repaired by fallback',
    );
    expect(result.finalScope.failKind).toBeUndefined();
  });

  it('P3 chained: 2 transients on p1 → switch to p2 → success', async () => {
    let p1Calls = 0;
    let p2Calls = 0;
    const result = await runGate({
      config: {
        providers: [
          {
            name: 'p1',
            provider: {
              name: 'p1',
              complete: async () => {
                p1Calls += 1;
                throw http(503, 'down');
              },
            },
            model: 'm',
          },
          {
            name: 'p2',
            provider: {
              name: 'p2',
              complete: async () => {
                p2Calls += 1;
                return { content: 'p2-ok', toolCalls: [], usage: { input: 1, output: 1 } };
              },
            },
            model: 'm',
          },
        ],
        postDecide: [
          {
            when: (s) =>
              s.errorKind === '5xx-transient' &&
              (s.attemptsPerProvider[s.currentProvider] ?? 0) < 2,
            then: 'retry',
            kind: 'transient-same',
          },
          {
            when: (s) => s.errorKind === '5xx-transient' && s.canSwitchProvider,
            then: 'retry-other',
            kind: 'transient-switch',
          },
        ],
      },
    });

    expect(p1Calls).toBe(2);
    expect(p2Calls).toBe(1);
    expect(result.finalScope.providerIdx).toBe(1);
    expect((result.finalScope.response as LLMResponse | undefined)?.content).toBe('p2-ok');
  });

  it('P3 fallback throws → next iteration fail-fasts', async () => {
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider: failingProvider('p1', http(500, 'down')), model: 'm' }],
        postDecide: [
          {
            when: (s) => s.error !== undefined && s.hasFallback && s.attempt < 2,
            then: 'fallback',
            kind: 'try-fallback',
          },
          { when: (s) => s.error !== undefined, then: 'fail-fast', kind: 'fallback-failed' },
        ],
        fallback: async () => {
          throw new Error('fallback also failed');
        },
      },
    });

    expect(result.finalScope.failKind).toBe('fallback-failed');
  });
});

// ────────────────────────────────────────────────────────────────────
// P4 — Property
// ────────────────────────────────────────────────────────────────────

describe('reliability gate chart — P4 property', () => {
  it('P4 first-match-wins rule ordering', async () => {
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider: failingProvider('p1', http(503, 'down')), model: 'm' }],
        postDecide: [
          { when: () => true, then: 'fail-fast', kind: 'first-rule' },
          { when: (s) => s.errorKind === '5xx-transient', then: 'retry', kind: 'never-fires' },
        ],
      },
    });

    expect(result.finalScope.failKind).toBe('first-rule');
    expect(result.finalScope.attempt).toBe(1);
  });

  it('P4 default branch fires when no rules match', async () => {
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider: okProvider('p1'), model: 'm' }],
        postDecide: [
          { when: (s) => s.errorKind === '5xx-transient', then: 'retry', kind: 'never' },
          { when: (s) => s.errorKind === 'rate-limit', then: 'retry', kind: 'never' },
        ],
      },
    });

    // Default 'ok' branch fires → success exit
    expect(result.finalScope.failKind).toBeUndefined();
    expect(result.finalScope.response).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// P5 — Security
// ────────────────────────────────────────────────────────────────────

describe('reliability gate chart — P5 security', () => {
  it('P5 emit payload structure: kind/label/attempt/providerUsed/errorKind', async () => {
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider: failingProvider('p1', http(500, 'down')), model: 'm' }],
        postDecide: [
          { when: (s) => s.error !== undefined, then: 'fail-fast', kind: 'unrecoverable' },
        ],
      },
    });

    const failEmit = result.emits.find((e) => e.name === 'agentfootprint.reliability.fail_fast');
    expect(failEmit).toBeDefined();
    const payload = failEmit!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      phase: 'post-decide',
      kind: 'unrecoverable',
      providerUsed: 'p1',
      errorKind: '5xx-transient',
    });
    expect(typeof payload.attempt).toBe('number');
  });

  it('P5 misconfigured provider list (empty) fails fast cleanly', async () => {
    const result = await runGate({
      config: {
        providers: [],
      },
    });

    // The CallProvider stage detects providers[0] === undefined and
    // fails fast with 'misconfigured-provider'. PreCheck has no rules,
    // so it routes 'continue' to CallProvider → which $breaks.
    expect(result.finalScope.failKind).toBe('misconfigured-provider');
  });
});

// ────────────────────────────────────────────────────────────────────
// P6 — Performance
// ────────────────────────────────────────────────────────────────────

describe('reliability gate chart — P6 performance', () => {
  it('P6 happy path completes in <100ms (engine + chart overhead)', async () => {
    const config: ReliabilityConfig = {
      providers: [{ name: 'p1', provider: okProvider('p1'), model: 'm' }],
    };

    // Warm up
    for (let i = 0; i < 3; i++) await runGate({ config });

    const t0 = performance.now();
    await runGate({ config });
    const elapsed = performance.now() - t0;

    // Generous budget — engine + subflow + decider + branch overhead.
    // Real per-call overhead is ~5-15ms; we test against 100 to catch
    // 10x regressions, not micro-perf shifts.
    expect(elapsed).toBeLessThan(100);
  });
});

// ────────────────────────────────────────────────────────────────────
// P7 — ROI
// ────────────────────────────────────────────────────────────────────

describe('reliability gate chart — P7 ROI', () => {
  it('P7 rule label flows into emit payload for narrative readability', async () => {
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider: failingProvider('p1', http(500, 'down')), model: 'm' }],
        postDecide: [
          {
            when: (s) => s.error !== undefined,
            then: 'fail-fast',
            kind: 'unrecoverable',
            label: 'Provider returned 500; no retry budget remaining',
          },
        ],
      },
    });

    const failEmit = result.emits.find((e) => e.name === 'agentfootprint.reliability.fail_fast');
    expect((failEmit?.payload as { label: string }).label).toBe(
      'Provider returned 500; no retry budget remaining',
    );
  });

  it('P7 label falls back to kind when omitted', async () => {
    const result = await runGate({
      config: {
        providers: [{ name: 'p1', provider: failingProvider('p1', http(500, 'down')), model: 'm' }],
        postDecide: [
          { when: (s) => s.error !== undefined, then: 'fail-fast', kind: 'no-label-given' },
        ],
      },
    });

    const failEmit = result.emits.find((e) => e.name === 'agentfootprint.reliability.fail_fast');
    expect((failEmit?.payload as { kind: string; label: string }).label).toBe('no-label-given');
  });
});

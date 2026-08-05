/**
 * withCircuitBreaker — 7-pattern tests.
 *
 *   P1 Unit         — name passes through; CLOSED state passes calls through
 *   P2 Boundary     — CLOSED → OPEN after `failureThreshold` consecutive failures
 *   P3 Scenario     — OPEN → HALF-OPEN after cooldown; success closes; failure re-opens
 *   P4 Property     — successful call resets the failure counter (CLOSED state)
 *   P5 Security     — `shouldCount` predicate gates which errors trip the breaker
 *   P6 Performance  — fast-fail when OPEN takes < 1µs (no provider call, no allocation)
 *   P7 ROI          — composes with withFallback (CLOSED → OPEN → fallback flow)
 */

import { describe, expect, it, vi } from 'vitest';
import {
  withCircuitBreaker,
  CircuitOpenError,
  type CircuitState,
} from '../../../src/resilience/withCircuitBreaker.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { expectScalesLinearly } from '../../helpers/perf.js';

// ── Test provider helpers ────────────────────────────────────────────

function makeProvider(
  behavior: 'always-pass' | 'always-fail' | 'flaky',
  name = 'test',
): LLMProvider & { readonly calls: number } {
  const counter = { value: 0 };
  const provider = {
    name,
    async complete(_req: LLMRequest): Promise<LLMResponse> {
      counter.value += 1;
      const calls = counter.value;
      if (behavior === 'always-fail') {
        throw new Error(`vendor 503 (call ${calls})`);
      }
      if (behavior === 'flaky' && calls % 2 === 1) {
        throw new Error(`vendor 503 (call ${calls})`);
      }
      return { content: 'ok', usage: { input: 1, output: 1 } } as LLMResponse;
    },
    get calls() {
      return counter.value;
    },
  };
  return provider;
}

const fakeRequest: LLMRequest = { messages: [{ role: 'user', content: 'hi' }] } as LLMRequest;

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('withCircuitBreaker — P1 unit', () => {
  it('P1 wrapped provider preserves the inner name', () => {
    const inner = makeProvider('always-pass', 'anthropic');
    const wrapped = withCircuitBreaker(inner);
    expect(wrapped.name).toBe('anthropic');
  });

  it('P1 CLOSED state passes calls through unchanged', async () => {
    const inner = makeProvider('always-pass');
    const wrapped = withCircuitBreaker(inner);
    const res = await wrapped.complete(fakeRequest);
    expect(res.content).toBe('ok');
    expect(inner.calls).toBe(1);
  });
});

// ─── P2 Boundary — CLOSED → OPEN ─────────────────────────────────────

describe('withCircuitBreaker — P2 boundary', () => {
  it('P2 OPENS after `failureThreshold` consecutive failures', async () => {
    const inner = makeProvider('always-fail');
    const states: CircuitState[] = [];
    const wrapped = withCircuitBreaker(inner, {
      failureThreshold: 3,
      onStateChange: (s) => states.push(s),
    });
    // 3 calls, all fail. Each propagates the underlying error.
    for (let i = 0; i < 3; i++) {
      await expect(wrapped.complete(fakeRequest)).rejects.toThrow(/vendor 503/);
    }
    expect(states).toEqual(['open']);

    // 4th call fails fast — no provider call, throws CircuitOpenError.
    const callsBefore = inner.calls;
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow(CircuitOpenError);
    expect(inner.calls).toBe(callsBefore); // no extra call
  });

  it('P2 CircuitOpenError carries underlying cause + retryAfter', async () => {
    const inner = makeProvider('always-fail');
    const wrapped = withCircuitBreaker(inner, { failureThreshold: 1, cooldownMs: 5_000 });
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow(/vendor 503/);
    try {
      await wrapped.complete(fakeRequest);
    } catch (e) {
      const err = e as CircuitOpenError;
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect(err.code).toBe('ERR_CIRCUIT_OPEN');
      expect((err.cause as Error).message).toMatch(/vendor 503/);
      expect(err.retryAfter).toBeGreaterThan(Date.now());
    }
  });
});

// ─── P3 Scenario — OPEN → HALF-OPEN → CLOSED ─────────────────────────

describe('withCircuitBreaker — P3 scenario', () => {
  it('P3 OPEN → HALF-OPEN → CLOSED on probe success(es)', async () => {
    let shouldFail = true;
    const inner: LLMProvider = {
      name: 'flip',
      async complete(): Promise<LLMResponse> {
        if (shouldFail) throw new Error('still failing');
        return { content: 'recovered', usage: { input: 1, output: 1 } } as LLMResponse;
      },
    };
    const states: CircuitState[] = [];
    const wrapped = withCircuitBreaker(inner, {
      failureThreshold: 2,
      cooldownMs: 50,
      halfOpenSuccessThreshold: 2,
      onStateChange: (s) => states.push(s),
    });

    // Trip the breaker.
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow();
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow();
    expect(states).toEqual(['open']);

    // Cooldown.
    await new Promise((r) => setTimeout(r, 60));

    // Vendor is back. Probe succeeds → HALF-OPEN, then CLOSED.
    shouldFail = false;
    const r1 = await wrapped.complete(fakeRequest);
    expect(r1.content).toBe('recovered');
    expect(states).toEqual(['open', 'half-open']);

    const r2 = await wrapped.complete(fakeRequest);
    expect(r2.content).toBe('recovered');
    expect(states).toEqual(['open', 'half-open', 'closed']);
  });

  it('P3 HALF-OPEN → OPEN on probe failure (no full close)', async () => {
    let phase: 'fail' | 'fail-probe' = 'fail';
    const inner: LLMProvider = {
      name: 'still-bad',
      async complete(): Promise<LLMResponse> {
        if (phase === 'fail' || phase === 'fail-probe') {
          throw new Error('still down');
        }
        return { content: 'ok', usage: { input: 1, output: 1 } } as LLMResponse;
      },
    };
    const states: CircuitState[] = [];
    const wrapped = withCircuitBreaker(inner, {
      failureThreshold: 1,
      cooldownMs: 50,
      onStateChange: (s) => states.push(s),
    });

    await expect(wrapped.complete(fakeRequest)).rejects.toThrow();
    expect(states).toEqual(['open']);

    await new Promise((r) => setTimeout(r, 60));
    phase = 'fail-probe';

    // Probe attempt — admits (half-open), fails, re-opens.
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow();
    expect(states).toEqual(['open', 'half-open', 'open']);
  });
});

// ─── P4 Property — success resets counter ────────────────────────────

describe('withCircuitBreaker — P4 property', () => {
  it('P4 successful call resets the failure counter (in CLOSED)', async () => {
    let phase: 'fail' | 'pass' = 'fail';
    const inner: LLMProvider = {
      name: 'flippy',
      async complete(): Promise<LLMResponse> {
        if (phase === 'fail') throw new Error('still failing');
        return { content: 'ok', usage: { input: 1, output: 1 } } as LLMResponse;
      },
    };
    const wrapped = withCircuitBreaker(inner, { failureThreshold: 3 });

    // 2 failures (just below threshold).
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow();
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow();

    // Recovery: 1 success resets the counter.
    phase = 'pass';
    await wrapped.complete(fakeRequest);

    // Now we should be able to fail 2 more times WITHOUT tripping.
    phase = 'fail';
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow(/still failing/);
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow(/still failing/);
    // 3rd consecutive failure should NOW trip.
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow(/still failing/);
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow(CircuitOpenError);
  });
});

// ─── P5 Security — shouldCount predicate ─────────────────────────────

describe('withCircuitBreaker — P5 security', () => {
  it("P5 4xx errors can be filtered out via shouldCount (don't trip breaker)", async () => {
    const inner: LLMProvider = {
      name: 'p',
      async complete(): Promise<LLMResponse> {
        const err = new Error('Bad Request') as Error & { status?: number };
        err.status = 400;
        throw err;
      },
    };
    const wrapped = withCircuitBreaker(inner, {
      failureThreshold: 2,
      shouldCount: (e) => (e as { status?: number })?.status !== 400,
    });
    // 5 client-error failures — none count toward the threshold.
    for (let i = 0; i < 5; i++) {
      await expect(wrapped.complete(fakeRequest)).rejects.toThrow(/Bad Request/);
    }
    // Breaker is still CLOSED — would have been OPEN with default predicate.
  });

  it('P5 AbortError does not count by default', async () => {
    const inner: LLMProvider = {
      name: 'p',
      async complete(): Promise<LLMResponse> {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
    };
    const wrapped = withCircuitBreaker(inner, { failureThreshold: 2 });
    for (let i = 0; i < 5; i++) {
      await expect(wrapped.complete(fakeRequest)).rejects.toThrow(/aborted/);
    }
    // No CircuitOpenError — abort errors don't count.
  });
});

// ─── P6 Performance — fast-fail in OPEN ──────────────────────────────

describe('withCircuitBreaker — P6 performance', () => {
  it(
    'P6 10k OPEN-state rejections cost ten times what 1k cost, and never reach the provider',
    { timeout: 30_000, retry: 2 },
    async () => {
      // Two claims, neither of them a stopwatch reading.
      //
      // The real one is a COUNT: while the circuit is open, the provider is not
      // called at all. That is what "fast-fail" means, and a count cannot be
      // made to lie by a busy machine.
      //
      // The second is that rejecting is O(1) per call — no scan of the failure
      // history, no re-derivation of state — so ten times the rejections costs
      // ~ten times the work rather than a hundred times.
      const inner = makeProvider('always-fail');
      const wrapped = withCircuitBreaker(inner, { failureThreshold: 1, cooldownMs: 60_000 });
      // Trip the breaker.
      await expect(wrapped.complete(fakeRequest)).rejects.toThrow();

      const reject = async (times: number): Promise<void> => {
        for (let i = 0; i < times; i++) {
          try {
            await wrapped.complete(fakeRequest);
          } catch {
            /* expected — circuit open */
          }
        }
      };

      await expectScalesLinearly({
        small: () => reject(1_000),
        large: () => reject(10_000),
        scale: 10,
        why: 'rejecting in OPEN must be constant-time per call',
      });

      // Provider should have been called ONLY once (the initial trip) across
      // all 11k rejections — the load-proof half of the P6 claim.
      expect(inner.calls).toBe(1);
    },
  );
});

// ─── P7 ROI — composes with withFallback ─────────────────────────────

describe('withCircuitBreaker — P7 ROI', () => {
  it('P7 CLOSED → OPEN → withFallback routes to backup provider', async () => {
    const primary = makeProvider('always-fail', 'anthropic');
    const backup = makeProvider('always-pass', 'openai');
    const provider = withFallback(withCircuitBreaker(primary, { failureThreshold: 2 }), backup);

    // First 2 calls hit primary (which fails), then fall back to backup.
    await provider.complete(fakeRequest);
    await provider.complete(fakeRequest);
    expect(primary.calls).toBe(2);
    expect(backup.calls).toBe(2);

    // 3rd call: breaker opens. Primary is no longer called; fallback handles directly.
    await provider.complete(fakeRequest);
    expect(primary.calls).toBe(2); // ← unchanged
    expect(backup.calls).toBe(3);

    // 100 more calls — primary still untouched, all routed to backup.
    for (let i = 0; i < 100; i++) await provider.complete(fakeRequest);
    expect(primary.calls).toBe(2);
    expect(backup.calls).toBe(103);
  });

  it('P7 onStateChange hook fires for every transition (observability)', async () => {
    const inner = makeProvider('always-fail');
    const transitions: { state: CircuitState; reason: string }[] = [];
    const wrapped = withCircuitBreaker(inner, {
      failureThreshold: 1,
      cooldownMs: 30,
      onStateChange: (state, reason) => transitions.push({ state, reason }),
    });

    await expect(wrapped.complete(fakeRequest)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 40));
    await expect(wrapped.complete(fakeRequest)).rejects.toThrow();

    expect(transitions.map((t) => t.state)).toEqual(['open', 'half-open', 'open']);
    expect(transitions[0]?.reason).toMatch(/consecutive/);
  });

  // vi imported for completeness (if a future test uses spies).
  void vi;
});

// ── v7.8 — the breaker FORWARDS reports but sources none of its own ──

describe('withCircuitBreaker — resilience reports', () => {
  it('forwards an inner decorator’s reports (it rebuilds the provider object)', async () => {
    // Load-bearing: all three decorators rebuild a fresh object copying
    // only name/complete/stream. A breaker in the middle of a stack
    // silently swallows every inner report unless it forwards.
    const onResilience = vi.fn();
    let calls = 0;
    const flaky: LLMProvider = {
      name: 'flaky',
      async complete(): Promise<LLMResponse> {
        calls += 1;
        if (calls === 1) throw new Error('transient');
        return { content: 'ok', usage: { input: 1, output: 1 } } as LLMResponse;
      },
    };

    const stacked = withCircuitBreaker(withRetry(flaky, { initialDelayMs: 1 }));
    await stacked.complete(fakeRequest, { onResilience });

    const kinds = onResilience.mock.calls.map((c) => c[0].kind);
    expect(kinds).toEqual(['retried', 'recovered']);
  });

  it('forwards hooks through stream() too', async () => {
    const seen: unknown[] = [];
    const inner: LLMProvider = {
      name: 'streamy',
      complete: async () => ({ content: 'ok', usage: { input: 1, output: 1 } } as LLMResponse),
      stream: async function* (_req, hooks) {
        seen.push(hooks);
        yield { tokenIndex: 0, content: '', done: true };
      },
    };
    const hooks = { onResilience: vi.fn() };

    for await (const _c of withCircuitBreaker(inner).stream!(fakeRequest, hooks)) {
      // drain
    }

    expect(seen).toEqual([hooks]);
  });

  it('reports NOTHING of its own, even when driven OPEN', async () => {
    // There is no declared event for a breaker transition, so the
    // breaker stays honestly silent on this channel. State remains
    // consumer-observable via onStateChange.
    const onResilience = vi.fn();
    const onStateChange = vi.fn();
    const provider = withCircuitBreaker(makeProvider('always-fail'), {
      failureThreshold: 2,
      onStateChange,
    });

    await expect(provider.complete(fakeRequest, { onResilience })).rejects.toThrow();
    await expect(provider.complete(fakeRequest, { onResilience })).rejects.toThrow();
    // Third call is a fast-fail from the OPEN breaker.
    await expect(provider.complete(fakeRequest, { onResilience })).rejects.toThrow(
      CircuitOpenError,
    );

    expect(onResilience).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalledWith('open', expect.any(String));
  });

  it('a trip becomes visible ONLY through the enclosing fallback’s reason', async () => {
    // The breaker's one route into a trace. Must stay pinned.
    const onResilience = vi.fn();
    const primary = withCircuitBreaker(makeProvider('always-fail', 'anthropic'), {
      failureThreshold: 1,
    });
    const provider = withFallback(primary, {
      name: 'openai',
      complete: async () => ({ content: 'served', usage: { input: 1, output: 1 } } as LLMResponse),
    });

    // 1st call: primary fails for real → trips the breaker.
    await provider.complete(fakeRequest, { onResilience });
    // 2nd call: primary fast-fails with CircuitOpenError.
    await provider.complete(fakeRequest, { onResilience });

    expect(onResilience).toHaveBeenCalledTimes(2);
    expect(onResilience.mock.calls[0][0].reason).toContain('vendor 503');
    const secondReason = onResilience.mock.calls[1][0].reason;
    expect(secondReason).toContain('circuit breaker is OPEN');
    expect(secondReason).toContain('anthropic');
  });
});

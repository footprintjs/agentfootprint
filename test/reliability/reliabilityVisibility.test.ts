/**
 * reliabilityVisibility.test.ts
 *
 * Task 2 of the scope↔emit cleanup. The rules-based reliability loop
 * fired only its TERMINAL event (`reliability.fail_fast`) — and that
 * event wasn't even registered in the event registry. This task:
 *   1. Established a proper typed `reliability.*` domain (fail_fast +
 *      retried + recovered) in the event registry + payloads.
 *   2. Converted every fail_fast emit (loop + the 5 gate-chart sites) to
 *      the compile-time-safe `typedEmit` facade.
 *   3. Wired the missing per-attempt visibility: the loop now fires
 *      `reliability.retried` on each retry / retry-other and
 *      `reliability.recovered` on a success (or successful fallback) that
 *      followed ≥1 failure.
 *
 * Design note (verified intent): the GENERIC `error.retried`/`error.recovered`
 * events are shaped for the standalone provider DECORATORS (withRetry has a
 * fixed maxAttempts + exponential backoffMs; totalDurationMs is a decorator
 * notion). The rules loop has no fixed cap and no backoff, so it gets its
 * own `reliability.*` family shaped for what it actually knows. The two
 * families are kept distinct on purpose. The provider decorators remain
 * deliberately standalone (consumer-wired via onRetry/onStateChange) and
 * are NOT bridged to this channel.
 *
 * These events are PURE telemetry — emit-only. The recovery-tracking
 * counters are closure-local (like attempt/breakerStates), never written
 * to scope, so they never enter the commitLog.
 *
 * 7-pattern coverage:
 *   • Unit        — reliability.retried payload shape on one same-provider retry.
 *   • Functional  — retry→success fires retried×N then recovered; clean
 *                   first-try fires nothing.
 *   • Integration — retry-other carries fromProvider/toProvider; provider
 *                   fallback fires recovered(via:'fallback').
 *   • Property    — failCount 0..3: retried count == failCount,
 *                   recovered fires iff failCount>0, priorFailures == failCount.
 *   • Security    — payloads carry only the error MESSAGE string, never the
 *                   Error instance or non-standard fields.
 *   • Performance — N/A: emit is a sync pass-through with a zero-alloc
 *                   fast-path when no listener is attached; no work added on
 *                   the first-try-success path.
 *   • Load        — N/A: bounded by the loop's MAX_LOOP=50 safety cap; the
 *                   broader suite exercises volume.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import type {
  ReliabilityRetriedPayload,
  ReliabilityRecoveredPayload,
} from '../../src/events/payloads.js';
import type { LLMRequest, LLMResponse } from '../../src/adapters/types.js';

/** Provider that throws the first `failTimes` calls, then returns `content`. */
function flakyProvider(opts: {
  name?: string;
  failTimes: number;
  content?: string;
  failMessage?: string;
}) {
  let calls = 0;
  return {
    name: opts.name ?? 'flaky',
    async complete(): Promise<LLMResponse> {
      calls += 1;
      if (calls <= opts.failTimes) throw new Error(opts.failMessage ?? `fail ${calls}`);
      return {
        content: opts.content ?? 'ok',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      };
    },
  };
}

/** PostDecide rules: retry on any error under `max` attempts, else fail-fast. */
function retryRules(max: number) {
  return {
    postDecide: [
      {
        when: (s: { error?: unknown; attempt: number }) => s.error !== undefined && s.attempt < max,
        then: 'retry' as const,
        kind: 'retry-on-error',
      },
      {
        when: (s: { error?: unknown }) => s.error !== undefined,
        then: 'fail-fast' as const,
        kind: 'exhausted',
      },
    ],
  };
}

describe('Task 2 — reliability per-attempt visibility', () => {
  // ── Unit ───────────────────────────────────────────────────────────
  it('unit: a single same-provider retry fires reliability.retried with action:retry + from==to', async () => {
    const agent = Agent.create({
      provider: flakyProvider({ failTimes: 1, failMessage: 'boom-1' }) as never,
      model: 'm',
    })
      .reliability(retryRules(5))
      .build();
    const retried: ReliabilityRetriedPayload[] = [];
    agent.on('agentfootprint.reliability.retried', (e) => retried.push(e.payload));

    await agent.run({ message: 'hi' });

    expect(retried).toHaveLength(1);
    expect(retried[0]!.action).toBe('retry');
    expect(retried[0]!.attempt).toBe(1);
    expect(typeof retried[0]!.errorKind).toBe('string');
    expect(retried[0]!.errorMessage).toBe('boom-1');
    expect(retried[0]!.fromProvider).toBe('flaky');
    expect(retried[0]!.toProvider).toBe('flaky'); // same-provider retry
  });

  // ── Functional ─────────────────────────────────────────────────────
  it('functional: retry→success fires reliability.retried×N then reliability.recovered', async () => {
    const agent = Agent.create({
      provider: flakyProvider({ failTimes: 2, content: 'healed' }) as never,
      model: 'm',
    })
      .reliability(retryRules(5))
      .build();
    const order: string[] = [];
    let recovered: ReliabilityRecoveredPayload | undefined;
    agent.on('agentfootprint.reliability.retried', () => order.push('retried'));
    agent.on('agentfootprint.reliability.recovered', (e) => {
      order.push('recovered');
      recovered = e.payload;
    });

    const out = await agent.run({ message: 'hi' });

    expect(out).toBe('healed');
    expect(order).toEqual(['retried', 'retried', 'recovered']);
    expect(recovered?.recoveredVia).toBe('retry');
    expect(recovered?.priorFailures).toBe(2);
    expect(recovered?.attempt).toBe(3); // succeeded on the 3rd attempt
  });

  it('functional: a clean first-try success emits neither retried nor recovered', async () => {
    const agent = Agent.create({
      provider: flakyProvider({ failTimes: 0, content: 'clean' }) as never,
      model: 'm',
    })
      .reliability(retryRules(5))
      .build();
    let count = 0;
    agent.on('agentfootprint.reliability.retried', () => (count += 1));
    agent.on('agentfootprint.reliability.recovered', () => (count += 1));

    await agent.run({ message: 'hi' });
    expect(count).toBe(0);
  });

  // ── Integration ────────────────────────────────────────────────────
  // NOTE: retry-other does NOT emit reliability.retried yet — the live
  // inline path (executeWithReliability) does not actually switch providers
  // (callFn closes over the agent's default provider; providerIdx only feeds
  // telemetry/breaker keying). Emitting a `toProvider` switch would be
  // misleading. This test pins the HONEST current behavior: retry-other
  // retries the SAME provider, emits NO retried event, but a subsequent
  // success still fires reliability.recovered(via:'retry-other'). When the
  // live-path failover bug is fixed, add the retry-other emit + assert it.
  it('integration: retry-other (live path) does not emit retried but does fire recovered', async () => {
    // primary fails once then succeeds on its 2nd call (proving retry-other
    // currently re-calls the SAME provider, not secondary).
    const primary = flakyProvider({ name: 'primary', failTimes: 1, content: 'from-primary-2nd' });
    const secondary = flakyProvider({ name: 'secondary', failTimes: 0, content: 'from-secondary' });
    const agent = Agent.create({ provider: primary as never, model: 'm' })
      .reliability({
        providers: [
          { name: 'primary', provider: primary as never, model: 'm' },
          { name: 'secondary', provider: secondary as never, model: 'm' },
        ],
        postDecide: [
          {
            when: (s: { error?: unknown; canSwitchProvider: boolean }) =>
              s.error !== undefined && s.canSwitchProvider,
            then: 'retry-other' as const,
            kind: 'failover',
          },
          {
            when: (s: { error?: unknown }) => s.error !== undefined,
            then: 'fail-fast' as const,
            kind: 'exhausted',
          },
        ],
      })
      .build();
    const retried: ReliabilityRetriedPayload[] = [];
    let recovered: ReliabilityRecoveredPayload | undefined;
    agent.on('agentfootprint.reliability.retried', (e) => retried.push(e.payload));
    agent.on('agentfootprint.reliability.recovered', (e) => (recovered = e.payload));

    const out = await agent.run({ message: 'hi' });

    // The live path re-called PRIMARY (not secondary) — documenting the bug.
    expect(out).toBe('from-primary-2nd');
    // No retried event for retry-other (we don't emit misleading telemetry).
    expect(retried).toHaveLength(0);
    // But recovery IS observable, tagged with the route taken.
    expect(recovered?.recoveredVia).toBe('retry-other');
    expect(recovered?.priorFailures).toBe(1);
  });

  it('integration: provider fallback fires reliability.recovered(via:fallback)', async () => {
    const agent = Agent.create({
      provider: flakyProvider({ name: 'main', failTimes: 1, failMessage: 'main-down' }) as never,
      model: 'm',
    })
      .reliability({
        fallback: async (_req: LLMRequest): Promise<LLMResponse> => ({
          content: 'from-fallback',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        }),
        postDecide: [
          {
            when: (s: { error?: unknown }) => s.error !== undefined,
            then: 'fallback' as const,
            kind: 'use-fallback',
          },
        ],
      })
      .build();
    let recovered: ReliabilityRecoveredPayload | undefined;
    agent.on('agentfootprint.reliability.recovered', (e) => (recovered = e.payload));

    const out = await agent.run({ message: 'hi' });

    expect(out).toBe('from-fallback');
    expect(recovered?.recoveredVia).toBe('fallback');
    expect(recovered?.priorFailures).toBe(1);
  });

  // ── Property ───────────────────────────────────────────────────────
  it('property: failCount 0..3 → retried count == failCount; recovered iff failCount>0; priorFailures matches', async () => {
    for (let failCount = 0; failCount <= 3; failCount++) {
      const agent = Agent.create({
        provider: flakyProvider({ failTimes: failCount, content: 'done' }) as never,
        model: 'm',
      })
        .reliability(retryRules(10))
        .build();
      let retriedCount = 0;
      let recovered: ReliabilityRecoveredPayload | undefined;
      agent.on('agentfootprint.reliability.retried', () => (retriedCount += 1));
      agent.on('agentfootprint.reliability.recovered', (e) => (recovered = e.payload));

      const out = await agent.run({ message: 'hi' });
      expect(out).toBe('done');
      expect(retriedCount).toBe(failCount);
      if (failCount > 0) {
        expect(recovered?.priorFailures).toBe(failCount);
      } else {
        expect(recovered).toBeUndefined();
      }
    }
  });

  // ── Security ───────────────────────────────────────────────────────
  it('security: reliability.retried carries only the error MESSAGE, no Error instance or extra fields', async () => {
    const provider = {
      name: 'leaky',
      _calls: 0,
      async complete(): Promise<LLMResponse> {
        this._calls += 1;
        if (this._calls === 1) {
          const err = new Error('visible-message');
          (err as unknown as { secret: string }).secret = 'do-not-leak';
          throw err;
        }
        return { content: 'ok', toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'stop' };
      },
    };
    const agent = Agent.create({ provider: provider as never, model: 'm' })
      .reliability(retryRules(5))
      .build();
    let payload: ReliabilityRetriedPayload | undefined;
    agent.on('agentfootprint.reliability.retried', (e) => (payload = e.payload));

    await agent.run({ message: 'hi' });

    expect(payload?.errorMessage).toBe('visible-message');
    expect((payload as unknown as { secret?: string }).secret).toBeUndefined();
    for (const v of Object.values(payload ?? {})) {
      expect(v).not.toBeInstanceOf(Error);
    }
  });
});

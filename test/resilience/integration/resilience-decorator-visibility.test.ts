/**
 * resilience-decorator-visibility.test.ts
 *
 * THE load-bearing test for the v7.8 resilience seam.
 *
 * Three events — `agentfootprint.fallback.triggered`,
 * `agentfootprint.error.retried`, `agentfootprint.error.recovered` — were
 * fully DECLARED (registry + payloads + ALL_EVENT_TYPES + domain
 * wildcards) but emitted by nothing. The provider decorators that own
 * those facts (`withFallback` / `withRetry` / `withCircuitBreaker`) sit
 * entirely outside the run: they are constructed by the consumer before
 * any run exists, and `LLMProvider` has no emit channel.
 *
 * The fix: decorators REPORT what they did through an optional per-call
 * `LLMCallHooks`; the in-run LLM call sites translate each report into
 * the already-declared event via `typedEmit`, from inside the traversal.
 *
 * What this file exists to prove — and the reason a consumer-callback
 * route was rejected — is CORRELATION. An event pushed via
 * `runner.emit()` from consumer code lands with synthetic meta
 * (`runtimeStageId: 'consumer-emit#0'`, `runId: 'consumer-scope'`,
 * `runOffsetMs: 0` — see RunnerBase.minimalMeta). An event emitted from
 * inside the stage carries the REAL ids footprintjs stamped before the
 * stage ran. Every assertion below on `meta` is therefore the point of
 * the change, not decoration.
 *
 * NOTE on listener timing: `EmitBridge.onEmit` early-returns when
 * `dispatcher.hasListenersFor(type)` is false, so a listener attached
 * AFTER `run()` observes nothing and looks like a missing emitter.
 * Always subscribe first.
 *
 * 7-pattern coverage:
 *   • Unit        — covered by the three unit files (report shapes).
 *   • Functional  — each of the three events fires from a real Agent run.
 *   • Integration — real Agent AND real LLMCall (two different runners);
 *                   recordRun captures all three with meta intact;
 *                   streaming path; reliability interleave.
 *   • Property    — stacking, both nestings: exact ordered kind sequence,
 *                   no report appears twice, report count == failure count.
 *   • Security    — a hostile in-run sink cannot break the LLM call; a
 *                   hostile standalone sink propagates (documented
 *                   contract, same as onRetry/onFallback/onStateChange).
 *   • Performance — N/A: one optional call per attempt. The existing
 *                   guards already cover the hot path and stay green —
 *                   resilience-patterns.test.ts (1000 calls < 500ms;
 *                   100-provider compose < 50ms) and
 *                   withCircuitBreaker.test.ts P6 (10k fast-fails).
 *   • Load        — N/A: no shared mutable state is introduced. The hooks
 *                   object is per-call and stateless, so there is no
 *                   concurrency semantic to test.
 */

import { describe, expect, it, vi } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';
import { Agent } from '../../../src/core/Agent.js';
import { buildAgentMessageApiChart } from '../../../src/core/agent/buildAgentMessageApiChart.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { withCircuitBreaker } from '../../../src/resilience/withCircuitBreaker.js';
import { fallbackProvider } from '../../../src/resilience/fallbackProvider.js';
import type {
  ErrorCircuitChangedPayload,
  ErrorRecoveredPayload,
  ErrorRetriedPayload,
  FallbackTriggeredPayload,
} from '../../../src/events/payloads.js';
import type { EventMeta } from '../../../src/events/types.js';
import type {
  LLMCallHooks,
  LLMProvider,
  LLMResponse,
  ResilienceReport,
} from '../../../src/adapters/types.js';

// ── Providers ────────────────────────────────────────────────────────

const okResponse = (content: string): LLMResponse => ({
  content,
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
});

/** Always throws. */
function deadProvider(name = 'dead', message = 'vendor down'): LLMProvider {
  return {
    name,
    complete: async () => {
      throw new Error(message);
    },
  };
}

/** Serves `content` every time. */
function goodProvider(name = 'good', content = 'served'): LLMProvider {
  return { name, complete: async () => okResponse(content) };
}

/** Throws the first `failTimes` calls, then serves. */
function flakyProvider(opts: {
  name?: string;
  failTimes: number;
  content?: string;
  status?: number;
}): LLMProvider {
  let calls = 0;
  return {
    name: opts.name ?? 'flaky',
    complete: async () => {
      calls += 1;
      if (calls <= opts.failTimes) {
        const err = new Error(`fail ${calls}`);
        if (opts.status !== undefined) Object.assign(err, { status: opts.status });
        throw err;
      }
      return okResponse(opts.content ?? 'recovered-answer');
    },
  };
}

// ── The load-bearing meta assertion ──────────────────────────────────

/**
 * Assert an event carries the correlation ids a REAL in-run emit gets —
 * i.e. that it did NOT come through the rejected consumer-emit route.
 */
function expectRealCorrelation(meta: EventMeta): void {
  // The synthetic values RunnerBase.minimalMeta() produces for a
  // consumer-level emit. Their absence is the whole point of the change.
  expect(meta.runtimeStageId).not.toBe('consumer-emit#0');
  expect(meta.runId).not.toBe('consumer-scope');

  // A real runtimeStageId is `[subflowPath/]stageId#executionIndex`.
  expect(meta.runtimeStageId).toMatch(/#\d+$/);
  // A real runId is minted per run() by makeRunId().
  expect(typeof meta.runId).toBe('string');
  expect(meta.runId.length).toBeGreaterThan(0);
  // Real wall-clock anchoring.
  expect(meta.wallClockMs).toBeGreaterThan(0);
  expect(meta.runOffsetMs).toBeGreaterThanOrEqual(0);
}

// ── Functional + Integration — a real Agent run ──────────────────────

describe('resilience decorators — the declared events fire in-run, with real correlation', () => {
  it('fallback.triggered lands with a real runtimeStageId and runId', async () => {
    const provider = withFallback(deadProvider('primary-x'), goodProvider('fallback-y', 'answer'));
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();

    const seen: { payload: FallbackTriggeredPayload; meta: EventMeta }[] = [];
    // Subscribe BEFORE run() — EmitBridge drops when nothing is listening.
    agent.on('agentfootprint.fallback.triggered', (e) => {
      seen.push({ payload: e.payload, meta: e.meta });
    });

    const result = await agent.run({ message: 'hi' });

    expect(result).toBe('answer');
    expect(seen).toHaveLength(1);
    // Every declared field, filled from the decorator's own facts.
    expect(seen[0]!.payload).toEqual({
      kind: 'provider',
      primary: 'primary-x',
      fallback: 'fallback-y',
      reason: 'vendor down',
    });
    expectRealCorrelation(seen[0]!.meta);
  });

  // ── error.circuit_changed (9.32.0) ────────────────────────────────
  //
  // The gap an independent reviewer named (2026-08-13, on a local harness of
  // scripted failures): they watched a
  // breaker open after two failures, serve the next request from fallback,
  // half-open after cooldown and close after two probes — every step correct
  // and every step INVISIBLE to the typed stream, because `onStateChange` was
  // the only channel and it fires at consumer level. These pin the same walk
  // on the record, with the run's real ids.

  it('THE TRIAL WALK: open → half-open → closed, all four transitions on the record', async () => {
    let mode: 'fail' | 'serve' = 'fail';
    const inner: LLMProvider = {
      name: 'trial-primary',
      complete: async () => {
        if (mode === 'fail') throw new Error('503 from the vendor');
        return okResponse('answered');
      },
    };
    const breaker = withCircuitBreaker(inner, {
      failureThreshold: 2,
      cooldownMs: 1,
      halfOpenSuccessThreshold: 2,
    });
    const provider = withFallback(breaker, goodProvider('standby', 'from-standby'));

    const seen: { payload: ErrorCircuitChangedPayload; meta: EventMeta }[] = [];
    const runOnce = async (): Promise<unknown> => {
      const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();
      agent.on('agentfootprint.error.circuit_changed', (e) =>
        seen.push({ payload: e.payload, meta: e.meta }),
      );
      return agent.run({ message: 'hi' });
    };

    // Two failures → OPEN. The fallback serves both.
    expect(await runOnce()).toBe('from-standby');
    expect(await runOnce()).toBe('from-standby');
    expect(seen.map((s) => s.payload.state)).toEqual(['open']);
    expect(seen[0]!.payload).toEqual({
      state: 'open',
      reason: '2 consecutive failures',
      // The wrapped provider, never the composite `primary|fallback` name.
      providerName: 'trial-primary',
    });

    // Cooldown elapses; the vendor is back. Next call probes → HALF-OPEN,
    // and a second success → CLOSED.
    mode = 'serve';
    await new Promise((r) => setTimeout(r, 5));
    expect(await runOnce()).toBe('answered');
    expect(await runOnce()).toBe('answered');

    expect(seen.map((s) => s.payload.state)).toEqual(['open', 'half-open', 'closed']);
    expect(seen[1]!.payload.reason).toBe('cooldown elapsed');
    expect(seen[2]!.payload.reason).toBe('2 probe successes');
    // The whole point: real ids, so a trip sits on the timeline beside the
    // tool calls it stopped rather than in a consumer log with no run.
    for (const s of seen) expectRealCorrelation(s.meta);
  });

  it("a re-entry into the same state is not a change — an open breaker's rejections are silent", async () => {
    const breaker = withCircuitBreaker(deadProvider('down'), {
      failureThreshold: 1,
      cooldownMs: 60_000,
    });
    const provider = withFallback(breaker, goodProvider('standby', 'ok'));
    const seen: ErrorCircuitChangedPayload[] = [];
    const runOnce = async (): Promise<void> => {
      const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();
      agent.on('agentfootprint.error.circuit_changed', (e) => seen.push(e.payload));
      await agent.run({ message: 'hi' });
    };

    await runOnce(); // trips: closed → open
    await runOnce(); // fast-fail, already open
    await runOnce(); // fast-fail, already open

    expect(seen).toHaveLength(1);
    expect(seen[0]!.state).toBe('open');
  });

  it("the consumer's own onStateChange still fires — the two are complements", async () => {
    // A Redis-backed counter built on `onStateChange` must not start
    // depending on whether a run happened to be in flight.
    const consumerSaw: string[] = [];
    const breaker = withCircuitBreaker(deadProvider('down'), {
      failureThreshold: 1,
      cooldownMs: 60_000,
      onStateChange: (state) => consumerSaw.push(state),
    });
    const provider = withFallback(breaker, goodProvider('standby', 'ok'));
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();
    const eventSaw: string[] = [];
    agent.on('agentfootprint.error.circuit_changed', (e) => eventSaw.push(e.payload.state));

    await agent.run({ message: 'hi' });

    expect(consumerSaw).toEqual(['open']);
    expect(eventSaw).toEqual(['open']);
  });

  it('outside a run the breaker reports nothing — no hooks, no event, unchanged behaviour', async () => {
    // Standalone decorator behaviour is byte-identical: nothing passes hooks,
    // so every report site short-circuits.
    const consumerSaw: string[] = [];
    const breaker = withCircuitBreaker(deadProvider('down'), {
      failureThreshold: 1,
      onStateChange: (state) => consumerSaw.push(state),
    });
    await breaker.complete({ messages: [], model: 'm' } as never).catch(() => undefined);
    expect(consumerSaw).toEqual(['open']);
  });

  it('error.retried + error.recovered land with real correlation', async () => {
    const provider = withRetry(flakyProvider({ failTimes: 2, status: 503 }), {
      maxAttempts: 4,
      initialDelayMs: 1,
    });
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();

    const retried: { payload: ErrorRetriedPayload; meta: EventMeta }[] = [];
    const recovered: { payload: ErrorRecoveredPayload; meta: EventMeta }[] = [];
    agent.on('agentfootprint.error.retried', (e) =>
      retried.push({ payload: e.payload, meta: e.meta }),
    );
    agent.on('agentfootprint.error.recovered', (e) =>
      recovered.push({ payload: e.payload, meta: e.meta }),
    );

    const result = await agent.run({ message: 'hi' });

    expect(result).toBe('recovered-answer');
    expect(retried).toHaveLength(2);
    expect(retried[0]!.payload).toEqual({
      attempt: 2,
      maxAttempts: 4,
      lastError: 'fail 1',
      backoffMs: 1,
      reason: 'http-5xx',
    });
    expect(retried[1]!.payload.attempt).toBe(3);
    expectRealCorrelation(retried[0]!.meta);

    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.payload.attempt).toBe(3);
    expect(recovered[0]!.payload.totalDurationMs).toBeGreaterThanOrEqual(0);
    expectRealCorrelation(recovered[0]!.meta);
  });

  it('the fallback + retry events share the run they came from', async () => {
    // Two different events from one run must agree on runId — that is
    // what makes them correlatable in a record.
    const provider = withRetry(
      withFallback(deadProvider('p'), flakyProvider({ name: 'f', failTimes: 1 })),
      { maxAttempts: 3, initialDelayMs: 1 },
    );
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();

    const runIds = new Set<string>();
    agent.on('agentfootprint.fallback.triggered', (e) => runIds.add(e.meta.runId));
    agent.on('agentfootprint.error.retried', (e) => runIds.add(e.meta.runId));

    await agent.run({ message: 'hi' });

    expect(runIds.size).toBe(1);
    expect([...runIds][0]).not.toBe('consumer-scope');
  });

  it('domain wildcards fire (they were legal types that never fired before)', async () => {
    const provider = withRetry(withFallback(deadProvider(), flakyProvider({ failTimes: 1 })), {
      maxAttempts: 3,
      initialDelayMs: 1,
    });
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();

    const fallbackWild = vi.fn();
    const errorWild = vi.fn();
    agent.on('agentfootprint.fallback.*', fallbackWild);
    agent.on('agentfootprint.error.*', errorWild);

    await agent.run({ message: 'hi' });

    expect(fallbackWild).toHaveBeenCalled();
    expect(errorWild).toHaveBeenCalled();
  });

  it('recordRun() captures all three events in the record, meta intact', async () => {
    const provider = withRetry(
      withFallback(deadProvider('p1'), flakyProvider({ name: 'f1', failTimes: 1 })),
      { maxAttempts: 3, initialDelayMs: 1 },
    );
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();
    const recorder = recordRun(agent);

    await agent.run({ message: 'hi' });
    const recording = recorder.toRecording();

    const types = recording.events.map((e) => e.type);
    expect(types).toContain('agentfootprint.fallback.triggered');
    expect(types).toContain('agentfootprint.error.retried');
    expect(types).toContain('agentfootprint.error.recovered');

    for (const event of recording.events) {
      if (
        event.type === 'agentfootprint.fallback.triggered' ||
        event.type === 'agentfootprint.error.retried' ||
        event.type === 'agentfootprint.error.recovered'
      ) {
        expectRealCorrelation(event.meta);
      }
    }
  });

  it('a streaming primary that dies before the first chunk reports in-run', async () => {
    // The only site where stream() is exercised.
    const streamingDead: LLMProvider = {
      name: 'stream-dead',
      complete: async () => {
        throw new Error('stream primary down');
      },
      // eslint-disable-next-line require-yield
      stream: async function* () {
        throw new Error('stream primary down');
      },
    };
    const provider = withFallback(streamingDead, goodProvider('stream-backup', 'streamed'));
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();

    const seen: { payload: FallbackTriggeredPayload; meta: EventMeta }[] = [];
    agent.on('agentfootprint.fallback.triggered', (e) =>
      seen.push({ payload: e.payload, meta: e.meta }),
    );

    const result = await agent.run({ message: 'hi' });

    expect(result).toBe('streamed');
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]!.payload.primary).toBe('stream-dead');
    expect(seen[0]!.payload.fallback).toBe('stream-backup');
    expectRealCorrelation(seen[0]!.meta);
  });

  // ── Second runner — proves the fix is not Agent-only ───────────────

  it('LLMCall (a different runner) also emits with real correlation', async () => {
    const provider = withFallback(deadProvider('llmcall-p'), goodProvider('llmcall-f', 'from-f'));
    const call = LLMCall.create({ provider, model: 'm' }).build();

    const seen: { payload: FallbackTriggeredPayload; meta: EventMeta }[] = [];
    call.on('agentfootprint.fallback.triggered', (e) =>
      seen.push({ payload: e.payload, meta: e.meta }),
    );

    const result = await call.run({ message: 'hi' });

    expect(result).toBe('from-f');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.payload).toEqual({
      kind: 'provider',
      primary: 'llmcall-p',
      fallback: 'llmcall-f',
      reason: 'vendor down',
    });
    expectRealCorrelation(seen[0]!.meta);
  });

  // ── The two families interleave but stay distinct ──────────────────

  it('a decorated provider under .reliability() reports BOTH families, distinctly', async () => {
    // payloads.ts forbids CROSS-emitting: reliability.* is the rules
    // loop's dynamic decisions, error.* is the decorator's fixed-cap
    // ones. Both must appear, from their own sources.
    const inner = flakyProvider({ failTimes: 3, content: 'both-ok' });
    const provider = withRetry(inner, { maxAttempts: 2, initialDelayMs: 1 });
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 })
      .reliability({
        postDecide: [
          {
            when: (s: { error?: unknown; attempt: number }) =>
              s.error !== undefined && s.attempt < 5,
            then: 'retry' as const,
            kind: 'retry-on-error',
          },
          {
            when: (s: { error?: unknown }) => s.error !== undefined,
            then: 'fail-fast' as const,
            kind: 'exhausted',
          },
        ],
      })
      .build();

    const decoratorRetries: ErrorRetriedPayload[] = [];
    const loopRetries: unknown[] = [];
    agent.on('agentfootprint.error.retried', (e) => decoratorRetries.push(e.payload));
    agent.on('agentfootprint.reliability.retried', (e) => loopRetries.push(e.payload));

    await agent.run({ message: 'hi' });

    // The decorator's own account — a fixed cap of 2 means exactly one
    // retry per gate attempt.
    expect(decoratorRetries.length).toBeGreaterThan(0);
    expect(decoratorRetries[0]!.maxAttempts).toBe(2);
    // The rules loop's own account, still on its own channel.
    expect(loopRetries.length).toBeGreaterThan(0);
  });
});

// ── Property — stacking, both nestings ───────────────────────────────

describe('resilience decorators — stacking produces no duplicate reports', () => {
  /** Collect the ordered `kind` sequence a stack reports for one call. */
  async function kindsFor(provider: LLMProvider): Promise<string[]> {
    const kinds: string[] = [];
    const onResilience = (r: ResilienceReport): void => void kinds.push(r.kind);
    try {
      await provider.complete(
        { messages: [{ role: 'user', content: 'hi' }], model: 'm' },
        {
          onResilience,
        },
      );
    } catch {
      // Exhaustion is a valid outcome; the reports still stand.
    }
    return kinds;
  }

  it('breaker OPEN under a fallback reports the fallback, and nothing again for the trip', async () => {
    const breaker = withCircuitBreaker(deadProvider('p'), { failureThreshold: 1 });
    const stack = withRetry(withFallback(breaker, goodProvider('f')), { initialDelayMs: 1 });

    // First call trips the breaker (a real failure) — closed → open, once.
    expect(await kindsFor(stack)).toEqual(['circuit-changed', 'fell-back']);
    // Second call: the breaker is ALREADY open, so it fast-fails and reports
    // nothing of its own. Transitions, not requests — a busy hour behind an
    // open breaker must not produce an event per rejected call.
    expect(await kindsFor(stack)).toEqual(['fell-back']);
  });

  it('a primary failing TWICE reports 2 fallbacks — two billed calls, not a duplicate', async () => {
    // The primary fails on both attempts, so the fallback really is
    // called twice. Pinning the exact order is what proves no de-dup
    // rule is needed: each kind has exactly one producer.
    const p = flakyProvider({ name: 'p', failTimes: 2 });
    const f = flakyProvider({ name: 'f', failTimes: 1 });
    const stack = withRetry(withFallback(p, f), { maxAttempts: 3, initialDelayMs: 1 });

    expect(await kindsFor(stack)).toEqual(['fell-back', 'retried', 'fell-back', 'recovered']);
  });

  it('a primary that recovers on attempt 2 reports only ONE fallback', async () => {
    // The complement of the case above: once the primary succeeds there
    // is no second fallback to report. Reads exactly as it happened.
    const p = flakyProvider({ name: 'p', failTimes: 1 });
    const f = flakyProvider({ name: 'f', failTimes: 1 });
    const stack = withRetry(withFallback(p, f), { maxAttempts: 3, initialDelayMs: 1 });

    expect(await kindsFor(stack)).toEqual(['fell-back', 'retried', 'recovered']);
  });

  it('reverse nesting reads exactly as it happened', async () => {
    // withFallback(withRetry(p), withRetry(f)) — p exhausts 3 attempts,
    // then the fallback's f succeeds first try.
    const stack = withFallback(
      withRetry(deadProvider('p'), { maxAttempts: 3, initialDelayMs: 1 }),
      withRetry(goodProvider('f'), { maxAttempts: 3, initialDelayMs: 1 }),
    );

    const kinds = await kindsFor(stack);

    expect(kinds).toEqual(['retried', 'retried', 'fell-back']);
    expect(kinds).not.toContain('recovered');
  });

  it('a 100-provider chain reports exactly once per real failure (no fan-out)', async () => {
    const providers: LLMProvider[] = [];
    for (let i = 0; i < 99; i++) providers.push(deadProvider(`dead-${i}`));
    providers.push(goodProvider('survivor'));

    // `fallbackProvider` is VARIADIC, not array-taking.
    const kinds = await kindsFor(fallbackProvider(...providers));

    expect(kinds).toHaveLength(99);
    expect(new Set(kinds)).toEqual(new Set(['fell-back']));
  });

  it('a 3-chain reports honest PAIRWISE names, never the composite chain name', async () => {
    const reports: ResilienceReport[] = [];
    // Options-first overload; the `name` override replaces the composite
    // chain name but must NOT leak into the pairwise report fields.
    const chain = fallbackProvider(
      { name: 'my-chain' },
      deadProvider('a'),
      deadProvider('b'),
      goodProvider('c'),
    );

    await chain.complete(
      { messages: [{ role: 'user', content: 'hi' }], model: 'm' },
      {
        onResilience: (r) => void reports.push(r),
      },
    );

    expect(reports).toHaveLength(2);
    const pairs = reports.map((r) =>
      r.kind === 'fell-back' ? `${r.primary}->${r.fallback}` : r.kind,
    );
    // The right-fold nests as a→(b|c), then b→c.
    expect(pairs[0]).toBe('a->b|c');
    expect(pairs[1]).toBe('b->c');
    for (const p of pairs) expect(p).not.toContain('my-chain');
  });
});

// ── Security ─────────────────────────────────────────────────────────

describe('resilience reports — hostile sinks', () => {
  it('a throwing sink inside a run cannot break the LLM call', async () => {
    // The library owns the in-run sink, so it is guarded once there:
    // telemetry must never abort traversal.
    const provider = withFallback(deadProvider(), goodProvider('survived', 'survived'));
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();

    agent.on('agentfootprint.fallback.triggered', () => {
      throw new Error('hostile listener');
    });

    await expect(agent.run({ message: 'hi' })).resolves.toBe('survived');
  });

  it('a throwing CONSUMER sink propagates from a standalone decorator (documented)', async () => {
    // Deliberate: identical contract to onRetry / onFallback /
    // onStateChange, which are also unguarded. Pinned as a decision, not
    // an accident.
    const provider = withFallback(deadProvider(), goodProvider());

    await expect(
      provider.complete(
        { messages: [{ role: 'user', content: 'hi' }], model: 'm' },
        {
          onResilience: () => {
            throw new Error('hostile consumer sink');
          },
        },
      ),
    ).rejects.toThrow('hostile consumer sink');
  });
});

// ── Backward compatibility — standalone behaviour is unchanged ────────

describe('resilience decorators — outside a run, nothing is emitted', () => {
  /**
   * Wrap a provider so it records the hooks object each call hands it.
   * This is the ONLY observable for "nothing was reported" when the caller
   * passes no hooks at all: there is no sink to spy, so the question
   * becomes whether any decorator in the stack *synthesized* one.
   */
  function recordingHooksArg(inner: LLMProvider, seen: (LLMCallHooks | undefined)[]): LLMProvider {
    return {
      name: inner.name,
      complete: (req, hooks) => {
        seen.push(hooks);
        return inner.complete(req, hooks);
      },
    };
  }

  const stdReq = { messages: [{ role: 'user' as const, content: 'hi' }], model: 'm' };

  it('a full stack with NO hooks argument resolves identically and reports nothing', async () => {
    // The primary proof is that all pre-existing test/resilience tests
    // pass untouched. This pins the composite case explicitly — and does
    // so with a falsifiable assertion: an earlier version of this test
    // declared an `emitted` array, never wrote to it, and asserted it was
    // empty, which could not fail.
    const handed: (LLMCallHooks | undefined)[] = [];
    const stack = withRetry(
      withFallback(
        withCircuitBreaker(recordingHooksArg(flakyProvider({ name: 'p', failTimes: 1 }), handed)),
        recordingHooksArg(goodProvider('f'), handed),
      ),
      { maxAttempts: 3, initialDelayMs: 1 },
    );

    // No second argument at all — every report site must short-circuit.
    const res = await stack.complete(stdReq);

    expect(res.content).toBe('served');
    // The stack really did run — otherwise the assertion below is vacuous.
    expect(handed.length).toBeGreaterThan(0);
    // …and no decorator invented a sink on the way down. `undefined` all
    // the way to the leaf is what makes `hooks?.onResilience?.(…)`
    // short-circuit at every report site.
    expect(handed.every((h) => h === undefined)).toBe(true);
  });

  it('POSITIVE CONTROL: the identical stack WITH hooks does report — so the empty case is real', async () => {
    // Without this, "no hooks reached the leaf" could pass for the wrong
    // reason (a capture that never sees anything). Same stack, same
    // failure pattern, one argument added.
    const handed: (LLMCallHooks | undefined)[] = [];
    const reports: ResilienceReport[] = [];
    const stack = withRetry(
      withFallback(
        withCircuitBreaker(recordingHooksArg(flakyProvider({ name: 'p', failTimes: 1 }), handed)),
        recordingHooksArg(goodProvider('f'), handed),
      ),
      { maxAttempts: 3, initialDelayMs: 1 },
    );

    const res = await stack.complete(stdReq, { onResilience: (r) => reports.push(r) });

    expect(res.content).toBe('served');
    // The capture sees the sink when there IS one…
    expect(handed.every((h) => h !== undefined)).toBe(true);
    // …and the reports really flow through this exact stack.
    expect(reports.map((r) => r.kind)).toEqual(['fell-back']);
  });

  it('a run on a bare FlowChartExecutor reaches NOTHING without an onEmit recorder', async () => {
    // Pins the corrected honest-absence claim (MENTAL_MODEL §14 item 6 and
    // the comment at buildAgentMessageApiChart's provider.complete call).
    // Both used to say these emits "reach the commit log always". They
    // cannot: footprintjs's ScopeFacade.emitEvent dispatches only to
    // recorders' onEmit — it never touches the transaction buffer, and it
    // fast-returns when zero recorders are attached — so an emit can never
    // become a CommitBundle.
    let realFallbacks = 0;
    const chart = buildAgentMessageApiChart({
      provider: withFallback(deadProvider('dead-primary'), goodProvider('live-backup', 'ok'), {
        onFallback: () => void (realFallbacks += 1),
      }),
      model: 'm',
      systemPrompt: 'sys',
      tools: [],
      maxIterations: 2,
    } as never);

    const executor = new FlowChartExecutor(chart);
    const returned = await executor.run({ input: { message: 'hi' } });
    const snapshot = executor.getSnapshot();

    // A REAL fallback happened — otherwise there is nothing to be absent.
    expect(realFallbacks).toBe(1);

    // …and it left no trace anywhere the run hands back.
    const mentions = (v: unknown): boolean =>
      (JSON.stringify(v, (_k, x) => (x instanceof Error ? String(x) : x)) ?? '').includes(
        'fallback.triggered',
      );
    expect(mentions(returned)).toBe(false);
    expect(mentions(snapshot?.commitLog)).toBe(false);
    expect(mentions(snapshot?.sharedState)).toBe(false);
    expect(mentions(snapshot?.executionTree)).toBe(false);
    expect(mentions(snapshot?.recorders)).toBe(false);
    // The commit log is populated — the absence is of this event, not of
    // commits (which would make the assertions above vacuous).
    expect(snapshot?.commitLog?.length ?? 0).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL: the same bare chart + one onEmit recorder DOES see it', async () => {
    // Proves the arm above is a genuine absence rather than a broken
    // fixture — and pins the other half of the corrected claim: even with
    // a recorder listening, the report still never lands in the commit log.
    let realFallbacks = 0;
    const chart = buildAgentMessageApiChart({
      provider: withFallback(deadProvider('dead-primary'), goodProvider('live-backup', 'ok'), {
        onFallback: () => void (realFallbacks += 1),
      }),
      model: 'm',
      systemPrompt: 'sys',
      tools: [],
      maxIterations: 2,
    } as never);

    const heard: { name: string; runtimeStageId: string }[] = [];
    const executor = new FlowChartExecutor(chart);
    executor.attachCombinedRecorder({
      id: 'test.resilience-emit-tap',
      onEmit(e: { name: string; runtimeStageId: string }): void {
        if (e.name === 'agentfootprint.fallback.triggered') {
          heard.push({ name: e.name, runtimeStageId: e.runtimeStageId });
        }
      },
    } as never);

    await executor.run({ input: { message: 'hi' } });
    const snapshot = executor.getSnapshot();

    expect(realFallbacks).toBe(1);
    expect(heard).toHaveLength(1);
    // Real in-run correlation, same as every other case in this file.
    expect(heard[0]!.runtimeStageId).toMatch(/#\d+$/);
    // …and STILL not in the commit log.
    expect(JSON.stringify(snapshot?.commitLog ?? [])).not.toContain('fallback.triggered');
  });

  it('an undecorated provider in a run emits none of the three events', async () => {
    const agent = Agent.create({
      provider: goodProvider('plain', 'plain-answer'),
      model: 'm',
      maxIterations: 2,
    }).build();

    const any = vi.fn();
    agent.on('agentfootprint.fallback.*', any);
    agent.on('agentfootprint.error.retried', any);
    agent.on('agentfootprint.error.recovered', any);

    await expect(agent.run({ message: 'hi' })).resolves.toBe('plain-answer');
    expect(any).not.toHaveBeenCalled();
  });
});

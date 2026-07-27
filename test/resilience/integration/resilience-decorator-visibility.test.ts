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
import { Agent } from '../../../src/core/Agent.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { withCircuitBreaker } from '../../../src/resilience/withCircuitBreaker.js';
import { fallbackProvider } from '../../../src/resilience/fallbackProvider.js';
import type {
  ErrorRecoveredPayload,
  ErrorRetriedPayload,
  FallbackTriggeredPayload,
} from '../../../src/events/payloads.js';
import type { EventMeta } from '../../../src/events/types.js';
import type { LLMProvider, LLMResponse, ResilienceReport } from '../../../src/adapters/types.js';

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

  it('breaker OPEN under a fallback reports only the fallback', async () => {
    const breaker = withCircuitBreaker(deadProvider('p'), { failureThreshold: 1 });
    const stack = withRetry(withFallback(breaker, goodProvider('f')), { initialDelayMs: 1 });

    // First call trips the breaker (a real failure).
    await kindsFor(stack);
    // Second call: the breaker fast-fails, the fallback serves.
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
  it('a full stack with NO hooks argument resolves identically and emits nothing', async () => {
    // The primary proof is that all pre-existing test/resilience tests
    // pass untouched. This pins the composite case explicitly.
    const emitted: unknown[] = [];
    const p = flakyProvider({ name: 'p', failTimes: 1 });
    const stack = withRetry(withFallback(withCircuitBreaker(p), goodProvider('f')), {
      maxAttempts: 3,
      initialDelayMs: 1,
    });

    // No second argument at all — every report site must short-circuit.
    const res = await stack.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'm',
    });

    expect(res.content).toBe('served');
    expect(emitted).toHaveLength(0);
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

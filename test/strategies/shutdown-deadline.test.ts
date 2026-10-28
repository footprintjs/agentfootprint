/**
 * agent.shutdown() — a deadline at its owner, and a stuck sink named.
 *
 * A sink's `flush()` waits for its own in-flight delivery, so one whose write
 * never settles (a hung network mount under `appendFile`) used to hold
 * `agent.shutdown()` forever. Shutdown now waits for each flush under one
 * deadline (`timeoutMs`, default 30 000 — the `drainObservers` default),
 * reports the sink that missed it by name through that sink's own `onError`,
 * and goes on.
 *
 *   P2 Boundary  — the default deadline; `Infinity` waits without one
 *   P3 Scenario  — a hung file sink beside a healthy one: shutdown resolves at
 *                  the deadline, names only the stuck sink, still flushes and
 *                  stops the healthy one
 *   P5 Security  — a non-positive `timeoutMs` is refused by name; a stuck sink
 *                  whose `onError` throws is still said on the console
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileObservability, type FileSinkFs } from '../../src/adapters/observability/file.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { Agent } from '../../src/index.js';
import type { ObservabilityStrategy } from '../../src/strategies/types.js';

// ── Fixtures ─────────────────────────────────────────────────────────

const buildAgent = (): Agent =>
  Agent.create({ provider: new MockProvider({ responses: ['ok'] }), model: 'mock' })
    .system('t')
    .build();

/** A disk whose appends never settle — a hung mount. */
function hungDisk(): FileSinkFs {
  return {
    mkdirSync: () => undefined,
    appendFileSync: () => undefined,
    statSync: () => ({ size: 0 }),
    appendFile: () => new Promise<void>(() => undefined),
    rename: () => Promise.resolve(),
  };
}

/** A strategy that buffers, flushes on demand, and counts stops. */
function healthySink(): ObservabilityStrategy & { shipped: number; stops: number } {
  let buffered = 0;
  const sink = {
    name: 'healthy',
    capabilities: { events: true },
    shipped: 0,
    stops: 0,
    exportEvent: (): void => void buffered++,
    flush: (): Promise<void> => {
      sink.shipped += buffered;
      buffered = 0;
      return Promise.resolve();
    },
    stop: (): void => void sink.stops++,
  };
  return sink;
}

/** A strategy whose flush settles only when the test says so. */
function gatedSink(errors: Error[]): ObservabilityStrategy & { open(): void } {
  let release: () => void = () => undefined;
  return {
    name: 'gated',
    capabilities: { events: true },
    exportEvent: () => undefined,
    flush: () => new Promise<void>((resolve) => (release = resolve)),
    _onError: (err) => void errors.push(err),
    open: () => release(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('agent.shutdown() deadline — P2 boundary', () => {
  it('P2 with no timeoutMs, shutdown waits 30 000 ms for a stuck sink, then goes on', async () => {
    const agent = buildAgent();
    const errors: Error[] = [];
    agent.enable.observability({
      strategy: fileObservability({
        path: '/log/events.ndjson',
        _fs: hungDisk(),
        flushIntervalMs: 0,
        onError: (err) => errors.push(err),
      }),
      tier: 'firehose',
    });
    await agent.run({ message: 'hi' });

    vi.useFakeTimers();
    let done = false;
    const shutting = agent.shutdown().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await shutting;
    expect(errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/^\[file\] flush did not finish within 30000 ms of shutdown/),
    ]);
  });

  it('P2 timeoutMs: Infinity waits for a slow flush without a deadline, and reports nothing', async () => {
    const agent = buildAgent();
    const errors: Error[] = [];
    const sink = gatedSink(errors);
    agent.enable.observability({ strategy: sink, tier: 'firehose' });

    vi.useFakeTimers();
    let done = false;
    const shutting = agent.shutdown({ timeoutMs: Infinity }).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(done).toBe(false);
    sink.open();
    await shutting;
    expect(errors).toEqual([]);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('agent.shutdown() deadline — P3 scenario', () => {
  it('P3 a hung file sink cannot hold shutdown: it is named at the deadline, the healthy sink still drains', async () => {
    const agent = buildAgent();
    const errors: Error[] = [];
    agent.enable.observability({
      strategy: fileObservability({
        path: '/log/events.ndjson',
        _fs: hungDisk(),
        flushIntervalMs: 0,
        onError: (err) => errors.push(err),
      }),
      tier: 'firehose',
    });
    const healthy = healthySink();
    agent.enable.observability({ strategy: healthy, tier: 'firehose' });
    await agent.run({ message: 'hi' });

    const started = performance.now();
    await agent.shutdown({ timeoutMs: 100 });
    const waited = performance.now() - started;

    expect(waited).toBeGreaterThanOrEqual(90);
    expect(waited).toBeLessThan(2_000);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(
      /^\[file\] flush did not finish within 100 ms of shutdown: a delivery it started has not settled/,
    );
    expect(healthy.shipped).toBeGreaterThan(0);
    expect(healthy.stops).toBe(1);
  }, 5_000);
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('agent.shutdown() deadline — P5 security', () => {
  it.each([0, -1, Number.NaN, '5000' as unknown as number])(
    'P5 timeoutMs %s is refused by name',
    async (timeoutMs) => {
      const agent = buildAgent();
      await expect(agent.shutdown({ timeoutMs })).rejects.toThrow(
        /shutdown\(\{ timeoutMs \}\) must be a positive number of milliseconds/,
      );
    },
  );

  it('P5 a stuck sink whose onError throws is still said on the console, and shutdown resolves', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const agent = buildAgent();
    const strategy = fileObservability({
      path: '/log/events.ndjson',
      _fs: hungDisk(),
      flushIntervalMs: 0,
      onError: () => {
        throw new Error('the consumer hook broke');
      },
    });
    agent.enable.observability({ strategy, tier: 'firehose' });
    await agent.run({ message: 'hi' });

    await expect(agent.shutdown({ timeoutMs: 20 })).resolves.toBeUndefined();
    expect(said.mock.calls.map((call) => String(call[0]))).toContainEqual(
      expect.stringMatching(/^\[file\] flush did not finish within 20 ms of shutdown/),
    );
  });
});

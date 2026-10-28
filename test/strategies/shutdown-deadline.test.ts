/**
 * agent.shutdown() — a deadline at its owner, and a stuck sink named.
 *
 * A sink's `flush()` waits for its own in-flight delivery, so one whose write
 * never settles (a hung network mount under `appendFile`) used to hold
 * `agent.shutdown()` forever. Shutdown now waits for each flush under one
 * deadline (`timeoutMs`, default 30 000 ms — the same number footprintjs's
 * `drainObservers` uses), reports a sink still flushing at the deadline by
 * name through its own `onError` — still delivering, or stuck — and goes on.
 *
 *   P2 Boundary  — the default deadline; `Infinity` waits without one; a
 *                  healthy shutdown leaves no deadline timer behind
 *   P3 Scenario  — a hung file sink beside a healthy one: shutdown resolves at
 *                  the deadline, names only the stuck sink, still flushes and
 *                  stops the healthy one; a healthy sink under steady traffic
 *                  is never reported; a second concurrent call joins the first
 *   P5 Security  — a non-positive `timeoutMs` makes the returned promise
 *                  reject (never a synchronous throw), even when a shutdown is
 *                  already in flight; a stuck sink whose `onError` throws is
 *                  still said on the console
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

/** A healthy disk: each append lands after `ms`. */
function timedDisk(ms: number): FileSinkFs & { lines(): number } {
  let lines = 0;
  return {
    lines: () => lines,
    mkdirSync: () => undefined,
    appendFileSync: () => undefined,
    statSync: () => ({ size: 0 }),
    appendFile: (_file, data) =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          lines += data.split('\n').length - 1;
          resolve();
        }, ms),
      ),
    rename: () => Promise.resolve(),
  };
}

const numbered = (seq: number) =>
  ({
    type: 'agentfootprint.test.numbered',
    payload: { seq },
    meta: { runId: 'r' },
  } as never);

/** Timers that keep the process alive right now. */
const liveTimers = (): number =>
  process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;

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

describe('agent.shutdown() deadline — P2 the deadline timer', () => {
  it('P2 a shutdown that finishes in time leaves no timer behind', async () => {
    const agent = buildAgent();
    const sink = fileObservability({
      path: '/log/e.ndjson',
      _fs: timedDisk(1),
      flushIntervalMs: 0,
    });
    agent.enable.observability({ strategy: sink, tier: 'firehose' });
    sink.exportEvent(numbered(1));
    const before = liveTimers();
    await agent.shutdown(); // the default 30 s deadline is armed, then must be cleared
    // A deadline timer left armed would hold the process open for 30 s.
    expect(liveTimers()).toBeLessThanOrEqual(before);
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
      /^\[file\] flush did not finish within 100 ms of shutdown: a delivery it started is still in flight — still delivering, or stuck\./,
    );
    expect(healthy.shipped).toBeGreaterThan(0);
    expect(healthy.stops).toBe(1);
  }, 5_000);

  it('P3 a healthy sink under steady traffic finishes inside the deadline and is not reported', async () => {
    const agent = buildAgent();
    const errors: Error[] = [];
    const sink = fileObservability({
      path: '/log/e.ndjson',
      _fs: timedDisk(3), // healthy: every append lands in 3 ms
      maxBufferEvents: 5,
      flushIntervalMs: 10,
      onError: (err) => errors.push(err),
    });
    agent.enable.observability({ strategy: sink, tier: 'firehose' });

    vi.useFakeTimers();
    let seq = 0;
    const producer = setInterval(() => sink.exportEvent(numbered(seq++)), 1); // one event per ms
    try {
      await vi.advanceTimersByTimeAsync(30);
      let done = false;
      void agent.shutdown({ timeoutMs: 150 }).then(() => {
        done = true;
      });
      for (let waited = 0; !done && waited < 400; waited++) await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      expect(errors).toEqual([]); // the flush ended on its own; nothing reached the deadline
    } finally {
      clearInterval(producer);
    }
  });

  it('P3 a second shutdown while one is in flight joins it: the first call’s deadline governs', async () => {
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

    const first = agent.shutdown({ timeoutMs: 50 });
    const second = agent.shutdown({ timeoutMs: Infinity }); // joins: does not wait forever
    await Promise.all([first, second]);
    expect(errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/^\[file\] flush did not finish within 50 ms of shutdown/),
    ]);
  }, 5_000);
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('agent.shutdown() deadline — P5 security', () => {
  it.each([0, -1, Number.NaN, '5000' as unknown as number])(
    'P5 timeoutMs %s is refused by name — the returned promise rejects',
    async (timeoutMs) => {
      const agent = buildAgent();
      await expect(agent.shutdown({ timeoutMs })).rejects.toThrow(
        /shutdown\(\{ timeoutMs \}\) must be a positive number of milliseconds/,
      );
    },
  );

  it('P5 a bad timeoutMs never throws synchronously: it is a rejected promise', async () => {
    const agent = buildAgent();
    let shutting: Promise<void> | undefined;
    expect(() => {
      shutting = agent.shutdown({ timeoutMs: 0 });
    }).not.toThrow();
    await expect(shutting).rejects.toBeInstanceOf(TypeError);
  });

  it('P5 a bad timeoutMs is refused even while another shutdown is in flight', async () => {
    const agent = buildAgent();
    agent.enable.observability({
      strategy: fileObservability({ path: '/log/e.ndjson', _fs: hungDisk(), flushIntervalMs: 0 }),
      tier: 'firehose',
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await agent.run({ message: 'hi' });
    const first = agent.shutdown({ timeoutMs: 30 });
    await expect(agent.shutdown({ timeoutMs: -1 })).rejects.toBeInstanceOf(TypeError);
    await first;
  });

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

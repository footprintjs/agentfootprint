/**
 * cloudwatchObservability + xrayObservability — one put at a time, in order,
 * through ONE queue (the #223 timer defect, in the two network sinks).
 *
 * Both sinks had the file sink's flaw: the timer started a put directly while
 * the size trigger and `flush()` chained theirs. Two puts could be in flight
 * at once (CloudWatch requires per-stream order), and `flush()` — so
 * `agent.shutdown()` on a Lambda — returned while a timed put was still in
 * flight. They now share `outbox.ts` with the file sink.
 *
 *   P2 Boundary  — `flush()` waits for a put the timer started
 *   P4 Property  — over many seeds of timer + size + `flush()` triggers against
 *                  a client whose puts take a random time: one put at a time,
 *                  every event shipped once, in order
 *
 * And what each sink keeps from before the shared queue: X-Ray's per-put cap
 * ships its remainder at once; CloudWatch and X-Ray keep their timer
 * referenced (an un-stopped sink still ships its tail), the file sink does not.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cloudwatchObservability,
  type CloudWatchLikeClient,
} from '../../src/adapters/observability/cloudwatch.js';
import { fileObservability } from '../../src/adapters/observability/file.js';
import { xrayObservability, type XRayLikeClient } from '../../src/adapters/observability/xray.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import type { ObservabilityStrategy } from '../../src/strategies/types.js';
import { seeded } from '../helpers/seededText.js';

// ── Fixtures ─────────────────────────────────────────────────────────

function envelope(type: string, payload: Record<string, unknown>, runId: string) {
  return { type, payload, meta: { runId } } as unknown as AgentfootprintEvent;
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Counts the calls open at once around any async call. */
function openCounter(): { around<T>(work: () => Promise<T>): Promise<T>; peak(): number } {
  let open = 0;
  let peak = 0;
  return {
    async around(work) {
      open++;
      peak = Math.max(peak, open);
      try {
        return await work();
      } finally {
        open--;
      }
    },
    peak: () => peak,
  };
}

/** A put that takes a seeded random time, under fake timers. */
const pauseFor = (next: () => number) => (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 1 + Math.floor(next() * 20)));

/** A CloudWatch client whose puts take a random time; `landed` lists event
 *  sequence numbers in the order their put FINISHED. */
function slowCloudWatch(next: () => number): {
  client: CloudWatchLikeClient;
  landed: number[];
  peak(): number;
} {
  const counter = openCounter();
  const pause = pauseFor(next);
  const landed: number[] = [];
  return {
    landed,
    peak: counter.peak,
    client: {
      putLogEvents: (input) =>
        counter.around(async () => {
          await pause();
          for (const e of input.logEvents) {
            landed.push((JSON.parse(e.message) as { payload: { seq: number } }).payload.seq);
          }
        }),
    },
  };
}

/** An X-Ray client whose puts take a random time; `landed` lists segments in
 *  the order their put FINISHED. */
function slowXRay(next: () => number): {
  client: XRayLikeClient;
  landed: Array<{ name: string; trace_id: string }>;
  peak(): number;
} {
  const counter = openCounter();
  const pause = pauseFor(next);
  const landed: Array<{ name: string; trace_id: string }> = [];
  return {
    landed,
    peak: counter.peak,
    client: {
      putTraceSegments: (input) =>
        counter.around(async () => {
          await pause();
          for (const doc of input.TraceSegmentDocuments) {
            landed.push(JSON.parse(doc) as { name: string; trace_id: string });
          }
        }),
    },
  };
}

/** Drive a seeded schedule: `emit(i)` at random gaps, un-awaited flushes
 *  sprinkled in, then a final flush with every timer run out. */
async function drive(
  next: () => number,
  strat: ObservabilityStrategy,
  count: number,
  emit: (i: number) => void,
): Promise<void> {
  const flushes: Array<Promise<void> | void> = [];
  for (let i = 0; i < count; i++) {
    await vi.advanceTimersByTimeAsync(Math.floor(next() * 10));
    emit(i);
    if (next() < 0.1) flushes.push(strat.flush?.());
  }
  const finalFlush = strat.flush?.();
  await vi.runAllTimersAsync();
  await Promise.all([...flushes, finalFlush]);
  strat.stop?.();
}

afterEach(() => {
  vi.useRealTimers();
});

// ─── CloudWatch ──────────────────────────────────────────────────────

describe('cloudwatchObservability serialized puts', () => {
  it('P2 flush() waits for a put the timer started, even with nothing buffered', async () => {
    vi.useFakeTimers();
    const open: Array<() => void> = [];
    const shipped: string[] = [];
    const strat = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 10,
      _client: {
        putLogEvents: (input) =>
          new Promise<void>((resolve) => {
            open.push(() => {
              shipped.push(...input.logEvents.map((e) => e.message));
              resolve();
            });
          }),
      },
    });
    strat.exportEvent(envelope('agentfootprint.test.numbered', { seq: 0 }, 'run-1'));
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(open).toHaveLength(1);

    let flushed = false;
    const flushing = Promise.resolve(strat.flush?.()).then(() => {
      flushed = true;
    });
    await settle();
    expect(flushed).toBe(false); // a Lambda frozen now would lose this put

    open[0]!();
    await flushing;
    expect(shipped).toHaveLength(1);
    strat.stop?.();
  });

  it('P4 over 200 seeds: one put at a time, every event once, in dispatch order', async () => {
    vi.useFakeTimers();
    for (let seed = 1; seed <= 200; seed++) {
      const next = seeded(seed);
      const pick = (n: number): number => Math.floor(next() * n);
      const cw = slowCloudWatch(next);
      const strat = cloudwatchObservability({
        logGroupName: '/g',
        flushIntervalMs: 1 + pick(15),
        maxBatchEvents: 1 + pick(5),
        _client: cw.client,
      });
      await drive(next, strat, 30, (seq) =>
        strat.exportEvent(envelope('agentfootprint.test.numbered', { seq }, 'run-1')),
      );
      expect(cw.peak(), `seed ${seed}: puts in flight at once`).toBe(1);
      expect(cw.landed, `seed ${seed}: shipped order`).toEqual(range(30));
    }
  });
});

// ─── X-Ray ───────────────────────────────────────────────────────────

/** One whole turn: root + one iteration. It closes iteration-then-root, so
 *  the segments graduate to the outbox in that order. */
function emitTurn(strat: ObservabilityStrategy, k: number): void {
  const runId = `run-${k}`;
  strat.exportEvent(envelope('agentfootprint.agent.turn_start', {}, runId));
  strat.exportEvent(envelope('agentfootprint.agent.iteration_start', { iterIndex: k }, runId));
  strat.exportEvent(envelope('agentfootprint.agent.iteration_end', {}, runId));
  strat.exportEvent(envelope('agentfootprint.agent.turn_end', {}, runId));
}

describe('xrayObservability serialized puts', () => {
  it('P2 flush() waits for a put the timer started, even with nothing queued', async () => {
    vi.useFakeTimers();
    const open: Array<() => void> = [];
    const strat = xrayObservability({
      serviceName: 'svc',
      flushIntervalMs: 10,
      _client: {
        putTraceSegments: () => new Promise<void>((resolve) => void open.push(resolve)),
      },
    });
    emitTurn(strat, 0);
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(open).toHaveLength(1);

    let flushed = false;
    const flushing = Promise.resolve(strat.flush?.()).then(() => {
      flushed = true;
    });
    await settle();
    expect(flushed).toBe(false);

    open[0]!();
    await flushing;
    strat.stop?.();
  });

  it('P4 over 200 seeds: one put at a time, every segment once, in the order it closed', async () => {
    vi.useFakeTimers();
    for (let seed = 1; seed <= 200; seed++) {
      const next = seeded(seed);
      const pick = (n: number): number => Math.floor(next() * n);
      const xray = slowXRay(next);
      const strat = xrayObservability({
        serviceName: 'svc',
        flushIntervalMs: 1 + pick(15),
        maxBatchSegments: 1 + pick(4),
        _client: xray.client,
      });
      await drive(next, strat, 20, (k) => emitTurn(strat, k));

      expect(xray.peak(), `seed ${seed}: puts in flight at once`).toBe(1);
      // iteration:k then its own root, turn after turn.
      const expected = range(20).flatMap((k) => [`iteration:${k}`, 'svc']);
      expect(
        xray.landed.map((s) => s.name),
        `seed ${seed}: shipped order`,
      ).toEqual(expected);
      for (let i = 0; i < xray.landed.length; i += 2) {
        expect(xray.landed[i]!.trace_id, `seed ${seed}: pair ${i / 2}`).toBe(
          xray.landed[i + 1]!.trace_id,
        );
      }
    }
  });
});

// ─── What each sink keeps from before the shared queue ───────────────

describe('xrayObservability — the per-put cap', () => {
  it('P2 what the cap leaves behind ships right after, with no timer and no flush()', async () => {
    const puts: number[] = [];
    const strat = xrayObservability({
      serviceName: 'svc',
      maxBatchSegments: 2,
      flushIntervalMs: 0, // no timer: only the cap's own follow-up can ship the rest
      _client: {
        putTraceSegments: (input) => {
          puts.push(input.TraceSegmentDocuments.length);
          return Promise.resolve();
        },
      },
    });
    // One turn of five segments (root + four iterations) graduates at turn_end.
    const runId = 'run-cap';
    strat.exportEvent(envelope('agentfootprint.agent.turn_start', {}, runId));
    for (let i = 0; i < 4; i++) {
      strat.exportEvent(envelope('agentfootprint.agent.iteration_start', { iterIndex: i }, runId));
      strat.exportEvent(envelope('agentfootprint.agent.iteration_end', {}, runId));
    }
    strat.exportEvent(envelope('agentfootprint.agent.turn_end', {}, runId));
    await settle();

    expect(puts).toEqual([2, 2, 1]);
    strat.stop?.();
  });
});

describe('timers — which sink may hold the process open', () => {
  /** The real timer a sink arms for one buffered event. */
  function timerArmedBy(strat: ObservabilityStrategy, event: AgentfootprintEvent) {
    const armed = vi.spyOn(globalThis, 'setTimeout');
    try {
      strat.exportEvent(event);
      expect(armed).toHaveBeenCalledTimes(1);
      return armed.mock.results[0]!.value as { hasRef(): boolean };
    } finally {
      armed.mockRestore();
      strat.stop?.();
    }
  }

  it('P2 CloudWatch and X-Ray keep their timer referenced, so the tail still ships', () => {
    const cw = cloudwatchObservability({
      logGroupName: '/g',
      flushIntervalMs: 60_000,
      _client: { putLogEvents: () => Promise.resolve() },
    });
    expect(
      timerArmedBy(cw, envelope('agentfootprint.test.numbered', { seq: 0 }, 'r')).hasRef(),
    ).toBe(true);

    const xray = xrayObservability({
      serviceName: 'svc',
      flushIntervalMs: 60_000,
      _client: { putTraceSegments: () => Promise.resolve() },
    });
    xray.exportEvent(envelope('agentfootprint.agent.turn_start', {}, 'r'));
    expect(timerArmedBy(xray, envelope('agentfootprint.agent.turn_end', {}, 'r')).hasRef()).toBe(
      true,
    );
  });

  it('P2 the file sink unrefs its timer — a local write never holds a process open', () => {
    const file = fileObservability({
      path: '/log/e.ndjson',
      flushIntervalMs: 60_000,
      _fs: {
        mkdirSync: () => undefined,
        appendFileSync: () => undefined,
        statSync: () => ({ size: 0 }),
        appendFile: () => Promise.resolve(),
        rename: () => Promise.resolve(),
      },
    });
    expect(
      timerArmedBy(file, envelope('agentfootprint.test.numbered', { seq: 0 }, 'r')).hasRef(),
    ).toBe(false);
  });
});

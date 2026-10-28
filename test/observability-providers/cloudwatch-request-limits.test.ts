/**
 * cloudwatchObservability — one put never carries more than CloudWatch accepts.
 *
 * Puts go one at a time now (#223), so a slow put lets a backlog build behind
 * it. Without a per-request limit the next delivery sent the whole backlog as
 * ONE `PutLogEvents` request; past CloudWatch's documented limits the service
 * refuses it and every event in it was dropped. (With default options and one
 * held put, an independent review measured 6,000 of 6,001 events lost.)
 *
 * The limits, from the PutLogEvents API reference: "The maximum number of log
 * events in a batch is 10,000", and "The maximum batch size is 1,048,576
 * bytes. This size is calculated as the sum of all event messages in UTF-8,
 * plus 26 bytes for each log event." The fake service below enforces both and
 * refuses a request that breaks either, as CloudWatch does.
 *
 *   P2 Boundary  — exactly 1,048,576 bytes is one put; one byte more is two
 *   P3 Scenario  — the review's held-put schedule delivers all 6,001 events,
 *                  every request inside both limits, in order
 *   P4 Property  — a byte-heavy backlog (ASCII and three-byte UTF-8) and a
 *                  count-heavy one split into full, legal puts, in order;
 *                  `flush()` resolves only after every part settled
 *   P5 Security  — an event too large for any request is sent alone and only
 *                  it is reported; a failed middle part is dropped and
 *                  reported once, without its neighbours and without a retry
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cloudwatchObservability,
  type CloudWatchLikeClient,
} from '../../src/adapters/observability/cloudwatch.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

// ── The service, as documented ───────────────────────────────────────

const MAX_EVENTS = 10_000;
const MAX_BYTES = 1_048_576;
const BYTES_PER_EVENT = 26;

interface Put {
  readonly count: number;
  readonly bytes: number;
}

/**
 * A CloudWatch Logs double that measures every request the way the service
 * does and refuses one over either limit. `hold(i)` may keep put `i` open;
 * `failPut` makes that put fail after it was accepted for sending.
 */
function cloudWatchService(
  options: { hold?: (put: number) => Promise<void> | undefined; failPut?: number } = {},
): { client: CloudWatchLikeClient; puts: Put[]; delivered: number[] } {
  const puts: Put[] = [];
  const delivered: number[] = [];
  return {
    puts,
    delivered,
    client: {
      async putLogEvents(input) {
        const events = input.logEvents;
        const bytes = events.reduce(
          (sum, e) => sum + Buffer.byteLength(e.message, 'utf8') + BYTES_PER_EVENT,
          0,
        );
        const index = puts.length;
        puts.push({ count: events.length, bytes });
        if (events.length > MAX_EVENTS || bytes > MAX_BYTES) {
          throw Object.assign(
            new Error('Log events in a single PutLogEvents request exceed the limit'),
            {
              name: 'InvalidParameterException',
            },
          );
        }
        await options.hold?.(index);
        if (index === options.failPut) throw new Error('ServiceUnavailableException');
        for (const e of events) {
          delivered.push((JSON.parse(e.message) as { payload: { seq: number } }).payload.seq);
        }
      },
    },
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────

/** A short envelope, so 10,000 of them stay under the byte limit. */
function small(seq: number): AgentfootprintEvent {
  return { type: 'e', payload: { seq }, meta: { runId: 'r' } } as unknown as AgentfootprintEvent;
}

function numbered(seq: number, text = ''): AgentfootprintEvent {
  return {
    type: 'agentfootprint.test.numbered',
    payload: { seq, text },
    meta: { runId: 'r' },
  } as unknown as AgentfootprintEvent;
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, i) => from + i);

/** No trigger fires: events wait until `flush()`, so one delivery meets the
 *  whole backlog at once — the case the split exists for. */
function backlogSink(client: CloudWatchLikeClient, errors: string[]) {
  return cloudwatchObservability({
    logGroupName: '/g',
    maxBatchEvents: Infinity,
    maxBatchBytes: Infinity,
    flushIntervalMs: 0,
    onError: (err) => errors.push(err.message),
    _client: client,
  });
}

function expectEveryPutLegal(puts: readonly Put[]): void {
  for (const [i, put] of puts.entries()) {
    expect(put.count, `put ${i}: events`).toBeLessThanOrEqual(MAX_EVENTS);
    expect(put.bytes, `put ${i}: bytes`).toBeLessThanOrEqual(MAX_BYTES);
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

// ─── P3 Scenario: the review's schedule ──────────────────────────────

describe('cloudwatchObservability request limits — P3 scenario', () => {
  it('P3 a backlog behind a held put ships all 6,001 events, every request inside both limits, in order', async () => {
    vi.useFakeTimers();
    let releaseFirst: () => void = () => undefined;
    const firstPut = new Promise<void>((resolve) => (releaseFirst = resolve));
    const service = cloudWatchService({ hold: (i) => (i === 0 ? firstPut : undefined) });
    const errors: string[] = [];
    // Default options, exactly as the review ran them.
    const sink = cloudwatchObservability({
      logGroupName: '/review',
      onError: (err) => errors.push(err.message),
      _client: service.client,
    });

    sink.exportEvent(numbered(0));
    await vi.advanceTimersByTimeAsync(1000); // the timer starts put 0, which hangs
    expect(service.puts).toHaveLength(1);
    let seq = 1;
    for (let group = 0; group < 3; group++) {
      for (let i = 0; i < 2000; i++) sink.exportEvent(numbered(seq++, 'x'.repeat(200)));
      await vi.advanceTimersByTimeAsync(1000);
    }
    releaseFirst();
    await sink.flush?.();
    sink.stop?.();

    expect(errors).toEqual([]);
    expect(service.delivered).toEqual(range(0, 6001));
    expectEveryPutLegal(service.puts);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('cloudwatchObservability request limits — P2 boundary', () => {
  /** Two events whose request is exactly `MAX_BYTES + extra` bytes. */
  function twoEventsTotalling(extra: number): AgentfootprintEvent[] {
    const each = MAX_BYTES / 2 - BYTES_PER_EVENT; // message bytes per event at the limit
    const envelope = Buffer.byteLength(JSON.stringify(numbered(0, '')), 'utf8');
    return [
      numbered(0, 'x'.repeat(each - envelope)),
      numbered(1, 'x'.repeat(each - envelope + extra)),
    ];
  }

  it('P2 a request of exactly 1,048,576 bytes is one put', async () => {
    const service = cloudWatchService();
    const errors: string[] = [];
    const sink = backlogSink(service.client, errors);
    for (const e of twoEventsTotalling(0)) sink.exportEvent(e);
    await sink.flush?.();
    sink.stop?.();
    expect(service.puts).toEqual([{ count: 2, bytes: MAX_BYTES }]);
    expect(service.delivered).toEqual([0, 1]);
    expect(errors).toEqual([]);
  });

  it('P2 one byte more is two puts, in order', async () => {
    const service = cloudWatchService();
    const errors: string[] = [];
    const sink = backlogSink(service.client, errors);
    for (const e of twoEventsTotalling(1)) sink.exportEvent(e);
    await sink.flush?.();
    sink.stop?.();
    expect(service.puts.map((p) => p.count)).toEqual([1, 1]);
    expect(service.delivered).toEqual([0, 1]);
    expect(errors).toEqual([]);
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('cloudwatchObservability request limits — P4 property', () => {
  // ~300 KB a message: three fit a request (900 KB), four do not (1.2 MB).
  it.each([
    { text: 'x'.repeat(300_000), what: 'ASCII' },
    { text: '漢'.repeat(100_000), what: 'three-byte UTF-8 (100,000 characters, 300,000 bytes)' },
  ])(
    'P4 a byte-heavy backlog ($what) splits by UTF-8 bytes into full puts of 3, 3, 3, 1',
    async ({ text }) => {
      const service = cloudWatchService();
      const errors: string[] = [];
      const sink = backlogSink(service.client, errors);
      for (let seq = 0; seq < 10; seq++) sink.exportEvent(numbered(seq, text));
      await sink.flush?.();
      sink.stop?.();

      expect(errors).toEqual([]);
      expect(service.puts.map((p) => p.count)).toEqual([3, 3, 3, 1]);
      expectEveryPutLegal(service.puts);
      expect(service.delivered).toEqual(range(0, 10));
    },
  );

  it('P4 a count-heavy backlog of 25,000 events ships as 10,000, 10,000, 5,000, in order', async () => {
    const service = cloudWatchService();
    const errors: string[] = [];
    const sink = backlogSink(service.client, errors);
    for (let seq = 0; seq < 25_000; seq++) sink.exportEvent(small(seq));
    await sink.flush?.();
    sink.stop?.();

    expect(errors).toEqual([]);
    expect(service.puts.map((p) => p.count)).toEqual([10_000, 10_000, 5_000]);
    expectEveryPutLegal(service.puts);
    expect(service.delivered).toEqual(range(0, 25_000));
  });

  it('P4 flush() resolves only after every part of a split delivery has settled', async () => {
    const gates: Array<() => void> = [];
    const service = cloudWatchService({
      hold: () => new Promise<void>((resolve) => void gates.push(resolve)),
    });
    const sink = backlogSink(service.client, []);
    for (let seq = 0; seq < 25_000; seq++) sink.exportEvent(small(seq));

    let flushed = false;
    const flushing = Promise.resolve(sink.flush?.()).then(() => {
      flushed = true;
    });
    for (let part = 0; part < 3; part++) {
      await settle();
      expect(service.puts, `part ${part} has started`).toHaveLength(part + 1);
      expect(flushed, `flush() before part ${part} settled`).toBe(false);
      gates[part]?.();
    }
    await flushing;
    expect(service.delivered).toHaveLength(25_000);
    sink.stop?.();
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('cloudwatchObservability request limits — P5 security', () => {
  it('P5 an event too large for any request is sent alone, as before; only it is reported, its neighbours ship', async () => {
    const service = cloudWatchService();
    const errors: string[] = [];
    const sink = backlogSink(service.client, errors);
    sink.exportEvent(numbered(0));
    sink.exportEvent(numbered(1, 'x'.repeat(1_100_000))); // over 1,048,576 on its own
    sink.exportEvent(numbered(2));
    await sink.flush?.();
    sink.stop?.();

    expect(service.puts.map((p) => p.count)).toEqual([1, 1, 1]);
    expect(service.delivered).toEqual([0, 2]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^1 event\(s\) dropped shipping to log group '\/g'/);
  });

  it('P5 a part that fails is dropped and reported once — not its neighbours, and never retried', async () => {
    const service = cloudWatchService({ failPut: 1 });
    const errors: string[] = [];
    const sink = backlogSink(service.client, errors);
    for (let seq = 0; seq < 25_000; seq++) sink.exportEvent(small(seq));
    await sink.flush?.();
    sink.stop?.();

    expect(service.puts.map((p) => p.count)).toEqual([10_000, 10_000, 5_000]);
    expect(errors).toEqual([
      expect.stringMatching(/^10000 event\(s\) dropped .*ServiceUnavailableException/),
    ]);
    expect(service.delivered).toEqual([...range(0, 10_000), ...range(20_000, 25_000)]);
  });
});

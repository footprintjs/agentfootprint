/**
 * The batch-size options keep the meaning they had before the shared queue —
 * value by value. A patch must not refuse, or quietly change, a configuration
 * that worked.
 *
 * What main (11.1.0) did, read from its code:
 *
 *   - file `maxBufferEvents`, CloudWatch `maxBatchEvents`: the size trigger was
 *     `buffer.length >= value`, and a flush took the whole buffer. So `0` and
 *     `-1` delivered every event at once, `2.5` triggered on the third event,
 *     `NaN` and `Infinity` never by count — only the byte trigger, the timer or
 *     `flush()`.
 *   - X-Ray `maxBatchSegments`: the same trigger, and a put took
 *     `outbox.splice(0, value)` — the whole part. `2.5` puts two at a time,
 *     `1.5` one at a time, `Infinity` everything. (`0`, `-1`, `NaN` and anything
 *     under 1 put NOTHING, in a loop. Those never worked; they are refused, see
 *     outbox-bounds.test.ts.)
 *
 * Each row runs one sink with no timer and no byte trigger: five events (or
 * one X-Ray turn of five segments) accepted, then `flush()`. It records the
 * size of every batch delivered before the flush, and after it. This file
 * passes against main's own three sinks as well as against the shared queue.
 *
 *   P1 Unit — every value main accepted is accepted, and batches as it did
 */

import { describe, expect, it } from 'vitest';

import { cloudwatchObservability } from '../../src/adapters/observability/cloudwatch.js';
import { fileObservability } from '../../src/adapters/observability/file.js';
import { xrayObservability } from '../../src/adapters/observability/xray.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import type { ObservabilityStrategy } from '../../src/strategies/types.js';

// ── Fixtures ─────────────────────────────────────────────────────────

const HUGE = 1e12; // a byte trigger nothing reaches

function event(type: string, payload: Record<string, unknown>, runId = 'run-1') {
  return { type, payload, meta: { runId } } as unknown as AgentfootprintEvent;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

interface Batches {
  /** Batch sizes delivered while the events arrived — no timer, no flush. */
  readonly beforeFlush: number[];
  /** …and once `flush()` has also run. */
  readonly afterFlush: number[];
}

/** Accept the events one at a time (letting each delivery run), then flush. */
async function batchesOf(
  strategy: ObservabilityStrategy,
  sizes: number[],
  feed: (strategy: ObservabilityStrategy) => Promise<void>,
): Promise<Batches> {
  await feed(strategy);
  const beforeFlush = [...sizes];
  await strategy.flush?.();
  strategy.stop?.();
  return { beforeFlush, afterFlush: sizes };
}

async function fiveEvents(strategy: ObservabilityStrategy): Promise<void> {
  for (let seq = 0; seq < 5; seq++) {
    strategy.exportEvent(event('agentfootprint.test.numbered', { seq }));
    await settle();
  }
}

/** One turn: a root and four iterations — five segments, closed together. */
async function oneTurnOfFiveSegments(strategy: ObservabilityStrategy): Promise<void> {
  strategy.exportEvent(event('agentfootprint.agent.turn_start', {}));
  for (let i = 0; i < 4; i++) {
    strategy.exportEvent(event('agentfootprint.agent.iteration_start', { iterIndex: i }));
    strategy.exportEvent(event('agentfootprint.agent.iteration_end', {}));
  }
  strategy.exportEvent(event('agentfootprint.agent.turn_end', {}));
  await settle();
}

function fileBatches(maxBufferEvents: number): Promise<Batches> {
  const sizes: number[] = [];
  const strategy = fileObservability({
    path: '/log/events.ndjson',
    flushIntervalMs: 0,
    maxBufferBytes: HUGE,
    maxBufferEvents,
    _fs: {
      mkdirSync: () => undefined,
      appendFileSync: () => undefined,
      statSync: () => ({ size: 0 }),
      appendFile: (_file, data) => {
        sizes.push(data.split('\n').length - 1);
        return Promise.resolve();
      },
      rename: () => Promise.resolve(),
    },
  });
  return batchesOf(strategy, sizes, fiveEvents);
}

function cloudwatchBatches(maxBatchEvents: number): Promise<Batches> {
  const sizes: number[] = [];
  const strategy = cloudwatchObservability({
    logGroupName: '/g',
    flushIntervalMs: 0,
    maxBatchBytes: HUGE,
    maxBatchEvents,
    _client: {
      putLogEvents: (input) => {
        sizes.push(input.logEvents.length);
        return Promise.resolve();
      },
    },
  });
  return batchesOf(strategy, sizes, fiveEvents);
}

function xrayBatches(maxBatchSegments: number): Promise<Batches> {
  const sizes: number[] = [];
  const strategy = xrayObservability({
    serviceName: 'svc',
    flushIntervalMs: 0,
    maxBatchSegments,
    _client: {
      putTraceSegments: (input) => {
        sizes.push(input.TraceSegmentDocuments.length);
        return Promise.resolve();
      },
    },
  });
  return batchesOf(strategy, sizes, oneTurnOfFiveSegments);
}

// ── The table: main's behaviour, value by value ──────────────────────

const EVENT_COUNT_ROWS = [
  {
    value: 0,
    meaning: 'every event at once',
    beforeFlush: [1, 1, 1, 1, 1],
    afterFlush: [1, 1, 1, 1, 1],
  },
  {
    value: -1,
    meaning: 'every event at once',
    beforeFlush: [1, 1, 1, 1, 1],
    afterFlush: [1, 1, 1, 1, 1],
  },
  { value: 2.5, meaning: 'the third event triggers', beforeFlush: [3], afterFlush: [3, 2] },
  { value: Number.NaN, meaning: 'never by count', beforeFlush: [], afterFlush: [5] },
  { value: Infinity, meaning: 'never by count', beforeFlush: [], afterFlush: [5] },
];

describe.each([
  ['file maxBufferEvents', fileBatches],
  ['cloudwatch maxBatchEvents', cloudwatchBatches],
] as const)('%s keeps its old meaning', (_option, batches) => {
  it.each(EVENT_COUNT_ROWS)(
    'P1 $value — $meaning, as before',
    async ({ value, beforeFlush, afterFlush }) => {
      expect(await batches(value)).toEqual({ beforeFlush, afterFlush });
    },
  );
});

const SEGMENT_ROWS = [
  { value: 2.5, meaning: 'two segments a put', beforeFlush: [2, 2, 1], afterFlush: [2, 2, 1] },
  {
    value: 1.5,
    meaning: 'one segment a put',
    beforeFlush: [1, 1, 1, 1, 1],
    afterFlush: [1, 1, 1, 1, 1],
  },
  { value: Infinity, meaning: 'never by count; a put takes all', beforeFlush: [], afterFlush: [5] },
];

describe('xray maxBatchSegments keeps its old meaning', () => {
  it.each(SEGMENT_ROWS)(
    'P1 $value — $meaning, as before',
    async ({ value, beforeFlush, afterFlush }) => {
      expect(await xrayBatches(value)).toEqual({ beforeFlush, afterFlush });
    },
  );
});

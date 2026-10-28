/**
 * outbox — the bounds that keep one queue from becoming a hang.
 *
 *   P4 Property  — the queue does not grow while a delivery hangs: however
 *                  many triggers fire, at most one delivery waits behind it
 *   P5 Security  — a count that decides what a delivery takes must be a
 *                  positive whole number, refused by the sink's own option
 *                  name; a cap that could take nothing never hangs a drain
 *                  (proved in a child process, which a spin cannot starve)
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cloudwatchObservability } from '../../src/adapters/observability/cloudwatch.js';
import { fileObservability, type FileSinkFs } from '../../src/adapters/observability/file.js';
import { createOutbox } from '../../src/adapters/observability/outbox.js';
import { xrayObservability } from '../../src/adapters/observability/xray.js';
import { runInChildProcess } from '../helpers/childProcess.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const memoryFs: FileSinkFs = {
  mkdirSync: () => undefined,
  appendFileSync: () => undefined,
  statSync: () => ({ size: 0 }),
  appendFile: () => Promise.resolve(),
  rename: () => Promise.resolve(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('outbox — P4 property', () => {
  it('P4 while a delivery hangs, 1000 size triggers queue at most one delivery behind it', async () => {
    const outbox = createOutbox<number>({
      name: 'file',
      maxItems: 1, // every item is a size trigger
      flushIntervalMs: 0,
      timerHoldsProcess: false,
      deliver: () => new Promise<void>(() => undefined), // never settles
      dropped: () => new Error('dropped'),
      report: () => undefined,
    });
    outbox.add(0);
    for (let i = 0; i < 10; i++) await Promise.resolve(); // the first delivery is now in flight

    // Every delivery the outbox queues is one `.then` on its chain. Count the
    // `.then` calls made while the triggers fire — synchronously, so nothing
    // else can call it meanwhile. (A plain wrapper: a vitest spy on
    // `Promise.prototype.then` recurses into itself.)
    const original = Promise.prototype.then;
    let queued = 0;
    Promise.prototype.then = function (this: Promise<unknown>, ...args: never[]) {
      queued++;
      return original.apply(this, args);
    } as typeof original;
    try {
      for (let i = 1; i <= 1000; i++) outbox.add(i);
    } finally {
      Promise.prototype.then = original;
    }

    expect(queued).toBe(1);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('outbox — P5 security', () => {
  it.each([0, -1, 1.5, Number.NaN])('P5 xray maxBatchSegments %s is refused by name', (cap) => {
    expect(() => xrayObservability({ serviceName: 'svc', maxBatchSegments: cap })).toThrow(
      /^\[xrayObservability\] `maxBatchSegments` must be a positive whole number/,
    );
  });

  it.each([0, -1, 1.5, Number.NaN])('P5 file maxBufferEvents %s is refused by name', (count) => {
    expect(() =>
      fileObservability({ path: '/log/e.ndjson', _fs: memoryFs, maxBufferEvents: count }),
    ).toThrow(/^\[fileObservability\] `maxBufferEvents` must be a positive whole number/);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'P5 cloudwatch maxBatchEvents %s is refused by name',
    (count) => {
      expect(() =>
        cloudwatchObservability({
          logGroupName: '/g',
          maxBatchEvents: count,
          _client: {
            putLogEvents: () => Promise.resolve(),
          },
        }),
      ).toThrow(/^\[cloudwatchObservability\] `maxBatchEvents` must be a positive whole number/);
    },
  );

  it('P5 the refusal says how to get "deliver every item at once"', () => {
    expect(() => xrayObservability({ serviceName: 'svc', maxBatchSegments: 0 })).toThrow(
      /Use 1 to deliver every item as soon as it arrives/,
    );
  });

  it('P5 a per-delivery cap of 0, NaN or -1 is refused or drains — never spins (child process)', async () => {
    const { stdout } = await runInChildProcess(
      join(HERE, 'fixtures', 'outbox-cap-child.ts'),
      {},
      { timeoutMs: 15_000 },
    );
    const outcomes = JSON.parse(stdout.trim()) as Record<string, string>;
    expect(Object.keys(outcomes).sort()).toEqual(['-1', '0', 'NaN']);
    for (const outcome of Object.values(outcomes)) {
      expect(['refused', 'returned']).toContain(outcome);
    }
  }, 30_000);
});

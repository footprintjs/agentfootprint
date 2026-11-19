import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error The benchmark queue is a standalone Node ESM module.
import { runQueue } from '../../../bench/negative/full/queue.mjs';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('full-path benchmark work queue', () => {
  it('starts in registered order and never exceeds three in-flight trials', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => i);
    const gates = rows.map(() => deferred());
    const started: number[] = [],
      finished: number[] = [];
    let active = 0,
      peak = 0;
    const completion = runQueue(rows, 3, async (row: number) => {
      started.push(row);
      peak = Math.max(peak, ++active);
      try {
        await gates[row].promise;
      } finally {
        active--;
        finished.push(row);
      }
    });
    expect(started).toEqual([0, 1, 2]);
    expect(active).toBe(3);
    // Completion order differs deliberately; start order must still follow the plan.
    for (const index of [2, 0, 1, 5, 3, 4, 7, 6]) {
      gates[index].resolve();
      await flush();
      expect(active).toBeLessThanOrEqual(3);
    }
    await completion;
    expect(started).toEqual(rows);
    expect(finished).toEqual([2, 0, 1, 5, 3, 4, 7, 6]);
    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('stops assigning new trials after failure and drains both existing requests before releasing a lock', async () => {
    const gates = Array.from({ length: 5 }, () => deferred());
    const started: number[] = [],
      finished: number[] = [];
    const first = new Error('first request failed');
    let lockHeld = true,
      settled = false;
    const guarded = (async () => {
      try {
        await runQueue([0, 1, 2, 3, 4], 3, async (row: number) => {
          started.push(row);
          try {
            await gates[row].promise;
          } finally {
            finished.push(row);
          }
        });
      } finally {
        lockHeld = false;
      }
    })();
    const outcome = guarded.then(
      () => {
        settled = true;
        return { ok: true as const };
      },
      (error: unknown) => {
        settled = true;
        return { ok: false as const, error };
      },
    );
    gates[0].reject(first);
    await flush();
    expect(started).toEqual([0, 1, 2]);
    expect(settled).toBe(false);
    expect(lockHeld).toBe(true);
    gates[1].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);
    expect(settled).toBe(false);
    expect(lockHeld).toBe(true);
    gates[2].reject(new Error('later in-flight failure'));
    expect(await outcome).toEqual({ ok: false, error: first });
    expect(finished).toEqual([0, 1, 2]);
    expect(lockHeld).toBe(false);
  });

  it('propagates a thrown undefined rather than treating it as success', async () => {
    const visit = vi.fn(async () => {
      throw undefined;
    });
    const result = await runQueue([0, 1, 2], 1, visit).then(
      () => ({ rejected: false }),
      (reason: unknown) => ({ rejected: true, reason }),
    );
    expect(result).toEqual({ rejected: true, reason: undefined });
    expect(visit).toHaveBeenCalledTimes(1);
  });

  it('handles an empty plan and refuses invalid widths without starting work', async () => {
    const visit = vi.fn();
    await runQueue([], 3, visit);
    for (const width of [0, -1, 4, 1.5, Number.NaN]) {
      await expect(runQueue([0], width, visit)).rejects.toThrow('Concurrency must be 1–3');
    }
    expect(visit).not.toHaveBeenCalled();
  });

  it('width one does not start the next trial until its predecessor finishes', async () => {
    const gate = deferred();
    const started: number[] = [];
    const completion = runQueue([0, 1], 1, async (row: number) => {
      started.push(row);
      if (row === 0) await gate.promise;
    });
    expect(started).toEqual([0]);
    gate.resolve();
    await completion;
    expect(started).toEqual([0, 1]);
  });
});

/**
 * lib/sleep — a library wait never resolves before `ms` of monotonic time.
 *
 * THE LAW, AND WHY IT IS DRIVEN WITH A FAKE. A platform timer fires EARLY:
 * Node's loop clock counts whole milliseconds and the stamp taken when a timer
 * is armed is floored, so a timer can fire up to a millisecond early on macOS
 * and more than one on Linux, where the loop clock is the coarse one. Timing a
 * real `setTimeout` catches that only now and then. So the law is proved here
 * with a clock and a timer this file controls: the timer fires 0.9 ms early,
 * then 2.2 ms early, and the wait must still be pending, must have re-armed
 * itself for what is left, and may resolve only once the clock has passed the
 * deadline. A bare `setTimeout` promise resolves on the first early fire:
 * swapped in over the same seam it fails 7 of the 12 cases below — every
 * early-fire, rounding, splitting and re-arm case, and the census. Truncating
 * the remainder instead of rounding it up fails 4; dropping the 2^31 − 1 split
 * fails 1. The other five pin what any wait must also do (zero, abort, a timer
 * that fires on time) and pass either way.
 *
 *   P1 Unit      — early fires re-arm for the rest, rounded up
 *   P2 Boundary  — a fraction is rounded up; a wait past 2^31 − 1 ms is split;
 *                  zero / negative / NaN is no wait
 *   P4 Property  — 400 seeded schedules of early and late fires: resolved
 *                  exactly when the clock reaches the deadline, never before
 *   P5 Abort     — already aborted, aborted after a re-arm, the caller's error
 *   P6 Census    — the PLATFORM clock: 700 concurrent real waits, none early
 *
 * WHAT A GREEN RUN DOES NOT PROVE: a maximum. A loaded host wakes a timer
 * late, and nothing here promises otherwise.
 */

import { describe, expect, it } from 'vitest';

import { makeSleep, sleep, type SleepClock } from '../../src/lib/sleep.js';

interface Armed {
  readonly ms: number;
  readonly fire: () => void;
  cleared: boolean;
}

/** A clock that only moves when told to, and a timer that fires when told to. */
function fakeClock(start = 1000.25) {
  let t = start;
  const armed: Armed[] = [];
  const clock: SleepClock = {
    now: () => t,
    setTimer: (fire, ms) => {
      const timer: Armed = { ms, fire, cleared: false };
      armed.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as Armed).cleared = true;
    },
  };
  return {
    clock,
    armed,
    elapsed: () => t - start,
    /** Fire the latest timer `early` ms before its delay is up (negative = late). */
    fireLatest(early: number): void {
      const timer = armed[armed.length - 1]!;
      expect(timer.cleared).toBe(false);
      t += timer.ms - early;
      timer.fire();
    },
  };
}

/** Lets every settled promise run its handlers before the next assertion. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function track(wait: Promise<void>) {
  const state = { resolved: false, rejected: undefined as unknown };
  wait.then(
    () => {
      state.resolved = true;
    },
    (err: unknown) => {
      state.rejected = err;
    },
  );
  return state;
}

describe('sleep — P1 an early timer does not end the wait', () => {
  it('a timer that fires 0.9 ms early re-arms for the rest, and the wait ends at the deadline', async () => {
    const fake = fakeClock();
    const wait = track(makeSleep(fake.clock)(5));
    expect(fake.armed.map((a) => a.ms)).toEqual([5]);

    fake.fireLatest(0.9); // the clock reads 4.1 ms
    await flush();
    expect(wait.resolved).toBe(false);
    expect(fake.armed.map((a) => a.ms)).toEqual([5, 1]); // ceil(0.9)

    fake.fireLatest(0); // the clock reads 5.1 ms
    await flush();
    expect(wait.resolved).toBe(true);
    expect(fake.elapsed()).toBeGreaterThanOrEqual(5);
  });

  it('a timer that fires 2.2 ms early (the coarse-clock shape) keeps re-arming until the deadline passes', async () => {
    const fake = fakeClock();
    const wait = track(makeSleep(fake.clock)(5));

    fake.fireLatest(2.2); // 2.8 ms
    await flush();
    expect(wait.resolved).toBe(false);
    expect(fake.armed.at(-1)!.ms).toBe(3); // ceil(2.2)

    fake.fireLatest(1.2); // 4.6 ms — early again
    await flush();
    expect(wait.resolved).toBe(false);
    expect(fake.armed.at(-1)!.ms).toBe(1); // ceil(0.4)

    fake.fireLatest(0); // 5.6 ms
    await flush();
    expect(wait.resolved).toBe(true);
    expect(fake.armed).toHaveLength(3);
  });

  it('a timer that fires on time ends the wait with no second timer', async () => {
    const fake = fakeClock();
    const wait = track(makeSleep(fake.clock)(200));
    fake.fireLatest(0);
    await flush();
    expect(wait.resolved).toBe(true);
    expect(fake.armed).toHaveLength(1);
  });
});

describe('sleep — P2 boundaries', () => {
  it('a fractional wait arms a timer rounded UP, never truncated', () => {
    const fake = fakeClock();
    void makeSleep(fake.clock)(4.3);
    expect(fake.armed[0]!.ms).toBe(5);
  });

  it('a wait longer than a timer holds is split, never wrapped to 1 ms', async () => {
    const MAX = 2 ** 31 - 1;
    const fake = fakeClock();
    const wait = track(makeSleep(fake.clock)(MAX + 5_000));
    expect(fake.armed[0]!.ms).toBe(MAX);

    fake.fireLatest(0);
    await flush();
    expect(wait.resolved).toBe(false);
    expect(fake.armed[1]!.ms).toBe(5_000);

    fake.fireLatest(0);
    await flush();
    expect(wait.resolved).toBe(true);
  });

  it('zero, a negative and NaN are no wait: resolved at once, no timer, the signal not consulted', async () => {
    const fake = fakeClock();
    const wait = makeSleep(fake.clock);
    for (const ms of [0, -1, Number.NaN]) {
      await expect(wait(ms, AbortSignal.abort(new Error('gone')))).resolves.toBeUndefined();
    }
    expect(fake.armed).toHaveLength(0);
  });
});

/** mulberry32 — a seeded generator, so a failing schedule can be replayed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sleep — P4 property: resolved exactly when the clock reaches the deadline', () => {
  it('400 seeded schedules of early and late fires', async () => {
    // Every time is a whole number of 1/64 ms, so the clock's arithmetic is
    // exact and "reached" below means exactly what the law says.
    const Q = 1 / 64;
    const random = seeded(0x5eed);
    const quanta = (maxMs: number) => Q * Math.floor(random() * maxMs * 64);
    for (let run = 0; run < 400; run++) {
      const ms = 0.25 + quanta(40);
      const fake = fakeClock(quanta(10_000));
      const wait = track(makeSleep(fake.clock)(ms));
      for (let fires = 0; !wait.resolved; fires++) {
        expect(fires, `run ${run}: the wait never ended`).toBeLessThan(200);
        const delay = fake.armed.at(-1)!.ms;
        // Mostly early by up to 2.5 ms (never before the timer's own start),
        // sometimes late — the shapes a real loop produces.
        const early = random() < 0.8 ? Math.min(delay, quanta(2.5)) : -quanta(3);
        fake.fireLatest(early);
        await flush();
        const reached = fake.elapsed() >= ms;
        expect(wait.resolved, `run ${run}: at ${fake.elapsed()} of ${ms} ms`).toBe(reached);
        if (!reached) {
          expect(fake.armed.at(-1)!.ms).toBe(Math.ceil(ms - fake.elapsed()));
        }
      }
    }
  });
});

describe('sleep — P5 abort', () => {
  it('an already-aborted signal rejects at once with its reason and arms nothing', async () => {
    const fake = fakeClock();
    const reason = new Error('run cancelled');
    await expect(makeSleep(fake.clock)(50, AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(fake.armed).toHaveLength(0);
  });

  it('an abort after a re-arm clears the CURRENT timer and rejects with the caller’s error', async () => {
    const fake = fakeClock();
    const controller = new AbortController();
    const mine = new Error('the caller’s own sentence');
    const wait = track(makeSleep(fake.clock)(5, controller.signal, () => mine));
    fake.fireLatest(0.9); // re-armed
    controller.abort();
    await flush();
    expect(wait.rejected).toBe(mine);
    expect(fake.armed.map((a) => a.cleared)).toEqual([false, true]);
  });

  it('the default error is the signal’s reason, else Error("Aborted")', async () => {
    const fake = fakeClock();
    const withReason = new AbortController();
    const reason = new Error('why');
    const a = track(makeSleep(fake.clock)(5, withReason.signal));
    withReason.abort(reason);
    await flush();
    expect(a.rejected).toBe(reason);

    const bare = { aborted: true, reason: undefined } as unknown as AbortSignal;
    await expect(makeSleep(fake.clock)(5, bare)).rejects.toThrow('Aborted');
  });

  it('a wait that ended no longer listens: a later abort reaches nothing', async () => {
    const fake = fakeClock();
    const controller = new AbortController();
    const wait = track(makeSleep(fake.clock)(5, controller.signal));
    fake.fireLatest(0);
    await flush();
    expect(wait.resolved).toBe(true);
    controller.abort();
    await flush();
    expect(wait.rejected).toBeUndefined();
    expect(fake.armed.every((a) => !a.cleared)).toBe(true);
  });
});

describe('sleep — P6 census on the platform clock', () => {
  it('700 concurrent real waits of 1–7 ms: none ends before its ms on performance.now()', async () => {
    // A bare setTimeout fails this on an ordinary machine: its early fires
    // are not rare. Measured with this shape (macOS, Node 22.16, load ~57,
    // 2026-09-30): a bare setTimeout ended early in 64–414 of the 700 waits in
    // every one of 20 runs, by up to 0.98 ms; this wait in 0 of 14,000. The
    // census cannot fail while the law holds — the wait reads this same clock.
    const short: string[] = [];
    for (let round = 0; round < 7; round++) {
      await Promise.all(
        Array.from({ length: 100 }, (_, i) => {
          const ms = 1 + (i % 7);
          const started = performance.now();
          return sleep(ms).then(() => {
            const took = performance.now() - started;
            if (took < ms) short.push(`${ms} ms ended after ${took.toFixed(3)} ms`);
          });
        }),
      );
    }
    expect(short).toEqual([]);
  });
});

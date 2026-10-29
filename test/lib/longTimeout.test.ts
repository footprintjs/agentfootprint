/**
 * setLongTimeout — a host timer for a limit of any length (`lib/longTimeout.ts`,
 * agentfootprint's own copy of a helper footprintjs keeps private).
 *
 * A host timer holds at most 2^31 − 1 ms; Node fires a longer delay after 1 ms.
 * Vitest's fake timers do the same (checked here first), so these tests can
 * tell "after 1 ms" from "at the time asked".
 *
 *   P1 Unit      — `Infinity` arms nothing; `0`, a negative or `NaN` is due at
 *                  once
 *   P2 Boundary  — a delay past 2^31 − 1 ms fires exactly when asked, through
 *                  a chain of timers
 *   P4 Property  — cancelling clears whichever link is armed; `unref` reaches
 *                  every link
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { setLongTimeout } from '../../src/lib/longTimeout.js';

const MAX = 2 ** 31 - 1;
const PAST_ONE_TIMER = 2 ** 31 + 5_000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('setLongTimeout — P1 unit', () => {
  it('P1 the host (and the fake clock) fires an over-long raw setTimeout after 1 ms — the reason this exists', async () => {
    vi.useFakeTimers();
    let fired = false;
    setTimeout(() => (fired = true), PAST_ONE_TIMER);
    await vi.advanceTimersByTimeAsync(1);
    expect(fired).toBe(true);
  });

  it('P1 Infinity arms no timer and never fires', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const cancel = setLongTimeout(fn, Infinity);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MAX);
    expect(fn).not.toHaveBeenCalled();
    cancel(); // a no-op, safe to call
  });

  it.each([0, -5, Number.NaN])('P1 %s is due at once — on the next timer turn', async (ms) => {
    vi.useFakeTimers();
    const fn = vi.fn();
    setLongTimeout(fn, ms);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('setLongTimeout — P2 boundary', () => {
  it('P2 a delay past 2^31 − 1 ms fires exactly when asked — not after 1 ms, not at the first link', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    setLongTimeout(fn, PAST_ONE_TIMER);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn, 'after 1 ms').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MAX - 1);
    expect(fn, 'when the first link ends').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PAST_ONE_TIMER - MAX - 1);
    expect(fn, '1 ms early').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('P2 a delay within one timer is one timer', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    setLongTimeout(fn, 30_000);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('setLongTimeout — P4 property', () => {
  it.each([
    { when: 'before the first link ends', advance: 1_000 },
    { when: 'after the first link, while the second is armed', advance: MAX + 1_000 },
  ])('P4 cancelling $when clears every timer and fn never runs', async ({ advance }) => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const cancel = setLongTimeout(fn, PAST_ONE_TIMER);
    await vi.advanceTimersByTimeAsync(advance);
    expect(vi.getTimerCount()).toBe(1);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * MAX);
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    { unref: true, expectRef: false },
    { unref: false, expectRef: true },
  ])('P4 unref: $unref reaches every link of the chain', async ({ unref, expectRef }) => {
    vi.useFakeTimers();
    const armed = vi.spyOn(globalThis, 'setTimeout');
    setLongTimeout(() => undefined, PAST_ONE_TIMER, { unref });
    await vi.advanceTimersByTimeAsync(MAX); // the second link is armed now
    const links = armed.mock.results.map((r) => r.value as { hasRef(): boolean });
    expect(links).toHaveLength(2);
    expect(links.map((t) => t.hasRef())).toEqual([expectRef, expectRef]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitDeadline } from '../../src/lib/waitDeadline.js';

afterEach(() => vi.useRealTimers());

describe('per-wait deadline owner', () => {
  it('uses the cancellation owner without wrapping the reason or invoking a timeout factory', async () => {
    const caller = new AbortController();
    const reason = new Error('caller fixture');
    const factory = vi.fn(() => new Error('deadline fixture'));
    const deadline = waitDeadline(undefined, caller.signal, factory);
    expect(deadline.signal).toBe(caller.signal);
    const done = deadline.within(new Promise(() => undefined), 'response').catch((error) => error);
    caller.abort(reason);
    expect(await done).toBe(reason);
    expect(factory).not.toHaveBeenCalled();
    deadline.dispose();
  });

  it('does not turn a long configured wait into a one-millisecond timer', async () => {
    vi.useFakeTimers();
    const deadline = waitDeadline(2 ** 31, undefined, () => new Error('deadline fixture'));
    const done = deadline.within(new Promise(() => undefined), 'response').catch((error) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(deadline.signal?.aborted).toBe(false);
    deadline.dispose();
    expect(vi.getTimerCount()).toBe(0);
    // No artificial result is promised for an abandoned owner; do not await done.
    void done;
  });

  it('cleans every timer after success or failure', async () => {
    vi.useFakeTimers();
    const deadline = waitDeadline(20, undefined, () => new Error('deadline fixture'));
    expect(await deadline.within(Promise.resolve(1), 'first')).toBe(1);
    const error = new Error('transport fixture');
    await expect(deadline.within(Promise.reject(error), 'next')).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
    deadline.dispose();
  });
});

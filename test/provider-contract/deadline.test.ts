import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerDeadline } from '../../src/provider-contract/deadline.js';
const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
afterEach(() => vi.useRealTimers());
describe('shared provider allowance accounting', () => {
  it('spends only provider wait time and excludes caller backpressure before output', async () => {
    vi.useFakeTimers();
    const deadline = providerDeadline({ firstOutputTimeoutMs: 100 }, undefined, {
      provider: 'fixture',
      afterOutput: () => false,
    });
    const opening = deadline.within(later(30), 'response');
    await vi.advanceTimersByTimeAsync(30);
    await opening;
    await vi.advanceTimersByTimeAsync(1000);
    const first = deadline.within(later(60), 'first-output');
    await vi.advanceTimersByTimeAsync(60);
    await first;
    const failed = deadline.within(new Promise<void>(() => undefined), 'first-output');
    const rejection = expect(failed).rejects.toMatchObject({
      timeoutMs: 100,
      waitingFor: 'first-output',
    });
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(deadline.signal?.aborted).toBe(true);
    deadline.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps credentials separate from the cumulative opaque answer budget', async () => {
    vi.useFakeTimers();
    const deadline = providerDeadline({ responseTimeoutMs: 100 }, undefined, {
      provider: 'fixture',
      opaque: true,
      afterOutput: () => false,
    });
    const key = deadline.within(later(80), 'credentials');
    await vi.advanceTimersByTimeAsync(80);
    await key;
    const answer = deadline.within(later(80), 'response');
    await vi.advanceTimersByTimeAsync(80);
    await answer;
    deadline.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('has no timer and preserves the exact caller signal when every cap is omitted', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const deadline = providerDeadline({}, caller.signal, {
      provider: 'fixture',
      afterOutput: () => false,
    });
    expect(deadline.signal).toBe(caller.signal);
    await deadline.within(Promise.resolve(), 'response');
    expect(vi.getTimerCount()).toBe(0);
    deadline.dispose();
  });
  it.each([false, true])(
    'refuses an already exhausted cumulative budget before accepting immediate output (opaque=%s)',
    async (opaque) => {
      vi.useFakeTimers();
      const deadline = providerDeadline(
        { firstOutputTimeoutMs: 100, responseTimeoutMs: 100 },
        undefined,
        { provider: 'fixture', opaque, afterOutput: () => false },
      );
      const headers = deadline.within(later(100), 'response');
      await vi.advanceTimersByTimeAsync(100);
      await headers;
      const phase = opaque ? 'body' : 'first-output';
      await expect(deadline.within(Promise.resolve('instant output'), phase)).rejects.toMatchObject(
        { code: 'ERR_PROVIDER_TIMEOUT', waitingFor: phase, timeoutMs: 100 },
      );
      expect(deadline.signal?.aborted).toBe(true);
      deadline.dispose();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('handles rejection of abandoned work when its cumulative allowance is already exhausted', async () => {
    vi.useFakeTimers();
    const deadline = providerDeadline({ firstOutputTimeoutMs: 100 }, undefined, {
      provider: 'fixture',
      afterOutput: () => false,
    });
    const opening = deadline.within(later(100), 'response');
    await vi.advanceTimersByTimeAsync(100);
    await opening;
    await expect(
      deadline.within(Promise.reject(new Error('abandoned transport')), 'first-output'),
    ).rejects.toMatchObject({ code: 'ERR_PROVIDER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(0);
    deadline.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

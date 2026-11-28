import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CircuitOpenError, withCircuitBreaker } from '../../../src/doors/resilience.js';
import {
  answer,
  chunk,
  drain,
  failure,
  request,
  scriptedProvider,
  terminal,
  traceCall,
} from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('shares cooldown across calls and admits two overlapping probes at the exact boundary', async () => {
  const trace = traceCall();
  const outage = failure('provider unavailable');
  const reply = answer('probe reply');
  const probe = () => new Promise<typeof reply>((resolve) => setTimeout(() => resolve(reply), 4));
  const provider = withCircuitBreaker(scriptedProvider('primary', trace, [outage, probe, probe]), {
    failureThreshold: 1,
    cooldownMs: 10,
    halfOpenSuccessThreshold: 2,
    onStateChange: (state) => trace.mark(`callback:${state}`),
  });
  const hooks = {
    onResilience: (event: import('../../../src/provider-contract/types.js').ResilienceReport) => {
      if (event.kind === 'circuit-changed') trace.mark(`event:${event.state}`);
    },
  };
  await expect(provider.complete(request, hooks)).rejects.toBe(outage);
  await vi.advanceTimersByTimeAsync(9);
  await expect(provider.complete(request, hooks)).rejects.toBeInstanceOf(CircuitOpenError);
  expect(trace.requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  const firstProbe = provider.complete(request, hooks);
  const secondProbe = provider.complete(request, hooks);
  expect(trace.requests).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(4);
  expect(await Promise.all([firstProbe, secondProbe])).toEqual([reply, reply]);
  expect(trace.steps).toEqual([
    { at: 0, action: 'primary.complete' },
    { at: 0, action: 'event:open' },
    { at: 0, action: 'callback:open' },
    { at: 10, action: 'event:half-open' },
    { at: 10, action: 'callback:half-open' },
    { at: 10, action: 'primary.complete' },
    { at: 10, action: 'primary.complete' },
    { at: 14, action: 'event:closed' },
    { at: 14, action: 'callback:closed' },
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([chunk(''), chunk('partial')])(
  'counts opening failure but does not count failure after $content',
  async (first) => {
    const trace = traceCall();
    const late = failure('stream tail');
    const opening = failure('stream opening');
    const provider = withCircuitBreaker(
      scriptedProvider(
        'primary',
        trace,
        [],
        [[first, late], [opening], [terminal(answer('probe'))]],
      ),
      { failureThreshold: 1, cooldownMs: 8, halfOpenSuccessThreshold: 1 },
    );
    const hooks = {
      onResilience: (event: import('../../../src/provider-contract/types.js').ResilienceReport) => {
        if (event.kind === 'circuit-changed') trace.mark(event.state);
      },
    };
    await expect(drain(provider.stream!(request, hooks))).rejects.toBe(late);
    await expect(drain(provider.stream!(request, hooks))).rejects.toBe(opening);
    await expect(drain(provider.stream!(request, hooks))).rejects.toBeInstanceOf(CircuitOpenError);
    await vi.advanceTimersByTimeAsync(8);
    await expect(drain(provider.stream!(request, hooks))).resolves.toEqual([
      terminal(answer('probe')),
    ]);
    expect(trace.steps).toEqual([
      { at: 0, action: 'primary.stream' },
      { at: 0, action: 'primary.close' },
      { at: 0, action: 'primary.stream' },
      { at: 0, action: 'primary.close' },
      { at: 0, action: 'open' },
      { at: 8, action: 'half-open' },
      { at: 8, action: 'primary.stream' },
      { at: 8, action: 'primary.close' },
      { at: 8, action: 'closed' },
    ]);
  },
);

it('does not count a cancelled call toward opening the breaker', async () => {
  const controller = new AbortController();
  const trace = traceCall();
  const outage = failure('provider down');
  const reply = answer('ok');
  const primary = scriptedProvider('primary', trace, [
    async () => {
      controller.abort(new Error('caller left'));
      throw outage;
    },
    reply,
  ]);
  const provider = withCircuitBreaker(primary, { failureThreshold: 1 });

  await expect(provider.complete({ ...request, signal: controller.signal })).rejects.toBe(outage);
  await expect(provider.complete(request)).resolves.toEqual(reply);
});

it('defaults to five failures, 30 seconds of cooldown, and two successful probes', async () => {
  const trace = traceCall();
  const outage = failure('provider unavailable');
  const reply = answer('healthy');
  const primary = scriptedProvider('primary', trace, [
    ...Array<Error>(5).fill(outage),
    reply,
    reply,
  ]);
  const provider = withCircuitBreaker(primary);
  const onResilience = vi.fn();

  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(provider.complete(request, { onResilience })).rejects.toBe(outage);
  }
  const nextProbe = Date.now() + 30_000;
  await expect(provider.complete(request)).rejects.toMatchObject({
    name: 'CircuitOpenError',
    cause: outage,
    retryAfter: nextProbe,
  });
  await vi.advanceTimersByTimeAsync(29_999);
  await expect(provider.complete(request)).rejects.toBeInstanceOf(CircuitOpenError);
  expect(trace.requests).toHaveLength(5);
  await vi.advanceTimersByTimeAsync(1);
  await expect(provider.complete(request, { onResilience })).resolves.toBe(reply);
  expect(onResilience.mock.calls.map(([event]) => event.state)).toEqual(['open', 'half-open']);
  await expect(provider.complete(request, { onResilience })).resolves.toBe(reply);
  expect(onResilience.mock.calls.map(([event]) => event.state)).toEqual([
    'open',
    'half-open',
    'closed',
  ]);
  expect(trace.requests).toHaveLength(7);
});

it('resets the consecutive failure count after a normal closed-state success', async () => {
  const trace = traceCall();
  const outage = failure('provider unavailable');
  const reply = answer('healthy');
  const trip = failure('third consecutive failure after success');
  const primary = scriptedProvider('primary', trace, [outage, outage, reply, outage, outage, trip]);
  const provider = withCircuitBreaker(primary, { failureThreshold: 3 });

  await expect(provider.complete(request)).rejects.toBe(outage);
  await expect(provider.complete(request)).rejects.toBe(outage);
  await expect(provider.complete(request)).resolves.toBe(reply);
  await expect(provider.complete(request)).rejects.toBe(outage);
  await expect(provider.complete(request)).rejects.toBe(outage);
  await expect(provider.complete(request)).rejects.toBe(trip);
  await expect(provider.complete(request)).rejects.toMatchObject({
    name: 'CircuitOpenError',
    cause: trip,
  });
  expect(trace.requests).toHaveLength(6);
});

it('reopens after a failed half-open probe and restarts its cooldown and success count', async () => {
  const trace = traceCall();
  const outage = failure('provider unavailable');
  const probeFailure = failure('probe failed');
  const reply = answer('healthy');
  const primary = scriptedProvider('primary', trace, [outage, reply, probeFailure, reply, reply]);
  const onStateChange = vi.fn();
  const provider = withCircuitBreaker(primary, {
    failureThreshold: 1,
    cooldownMs: 10,
    onStateChange,
  });

  await expect(provider.complete(request)).rejects.toBe(outage);
  await vi.advanceTimersByTimeAsync(10);
  await expect(provider.complete(request)).resolves.toBe(reply);
  await vi.advanceTimersByTimeAsync(1);
  await expect(provider.complete(request)).rejects.toBe(probeFailure);
  const nextProbe = Date.now() + 10;
  await vi.advanceTimersByTimeAsync(9);
  await expect(provider.complete(request)).rejects.toMatchObject({
    name: 'CircuitOpenError',
    cause: probeFailure,
    retryAfter: nextProbe,
  });
  expect(trace.requests).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(1);
  await expect(provider.complete(request)).resolves.toBe(reply);
  expect(onStateChange.mock.calls.map(([state]) => state)).toEqual([
    'open',
    'half-open',
    'open',
    'half-open',
  ]);
  await expect(provider.complete(request)).resolves.toBe(reply);
  expect(onStateChange.mock.calls.map(([state]) => state)).toEqual([
    'open',
    'half-open',
    'open',
    'half-open',
    'closed',
  ]);
  expect(trace.steps.map(({ at }) => at)).toEqual([0, 10, 11, 21, 21]);
});

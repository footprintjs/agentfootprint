import { describe, expect, it, vi } from 'vitest';
import { pilotBudget, MODEL, RESERVATION_MICRO_USD } from '../../bench/cache/pilot/budget.mjs';

const body = (extra = {}) => ({
  model: MODEL,
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Synthetic fixture.' }],
  ...extra,
});
const response = (
  usage = {
    input_tokens: 50,
    output_tokens: 20,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
) => ({ id: 'synthetic', usage });
const run = { arm: 'baseline', run: 'lookup' };
function fixture(options = {}) {
  const events: unknown[] = [];
  let time = 0;
  const budget = pilotBudget({
    journal: (e: unknown) => {
      events.push(e);
    },
    now: () => time,
    ...options,
  });
  return {
    budget,
    events,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
describe('pilot hard reservations before transport', () => {
  it('an answer cannot win an overdue timer and settle after its call deadline', async () => {
    const f = fixture({ callTimeoutMs: 5, maxDurationMs: 1000 });
    const send = vi.fn(async () => {
      f.advance(6);
      return response();
    });
    await expect(f.budget.call(body(), send, run)).rejects.toThrow(/timeout/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.budget.snapshot()).toMatchObject({ halted: true, unknownCalls: 1, unsentCalls: 0 });
    expect(f.events.some((e: any) => e.kind === 'settled')).toBe(false);
  });
  it('a delayed dispatch cannot start after its own call deadline, even with total time remaining', async () => {
    const f = fixture({ callTimeoutMs: 5, maxDurationMs: 1000 });
    const send = vi.fn(async () => response());
    const pending = f.budget.call(body(), send, run);
    f.advance(6);
    await expect(pending).rejects.toThrow(/timeout/);
    expect(send).not.toHaveBeenCalled();
    expect(f.budget.snapshot()).toMatchObject({ halted: true, unsentCalls: 1, unknownCalls: 0 });
  });
  it('admits only known standard/global metadata and exact zero server-tool/thinking counts', async () => {
    const f = fixture();
    const usage = {
      ...response().usage,
      service_tier: 'standard',
      inference_geo: 'global',
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      output_tokens_details: { thinking_tokens: 0 },
    };
    await f.budget.call(body(), async () => ({ usage }), run);
    expect(f.events).toContainEqual(
      expect.objectContaining({
        kind: 'settled',
        usage: {
          raw: usage,
          nanoUsd: 150000,
          microUsd: 150,
        },
      }),
    );
  });
  it.each(['deadline', 'abort'])('checks %s at the actual dispatch microtask', async (cause) => {
    const f = fixture({ maxDurationMs: 100 });
    const controller = new AbortController();
    const send = vi.fn(async () => response());
    const pending = f.budget.call(body(), send, { ...run, signal: controller.signal });
    if (cause === 'deadline') f.advance(101);
    else controller.abort();
    await expect(pending).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(f.budget.snapshot()).toMatchObject({
      halted: true,
      unsentCalls: 1,
      unknownCalls: 0,
      reservedMicroUsd: RESERVATION_MICRO_USD,
    });
    expect(f.events).toContainEqual(expect.objectContaining({ kind: 'not-sent' }));
  });
  it.each([
    { headers: { 'x-synthetic-key': 'SYNTHETIC-SECRET' } },
    { server_tool_use: { web_search_requests: 3 } },
    { service_tier: 'priority' },
    { inference_geo: 'us' },
    {
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0, unexpected: 1 },
    },
  ])(
    'unknown usage fields or charge classes halt and never enter the journal: %j',
    async (extra) => {
      const f = fixture();
      const usage = { ...response().usage, ...extra };
      await expect(f.budget.call(body(), async () => ({ usage }), run)).rejects.toThrow(/usage/);
      expect(f.budget.snapshot()).toMatchObject({ halted: true, unknownCalls: 1 });
      expect(JSON.stringify(f.events)).not.toContain('SYNTHETIC-SECRET');
      expect(f.events.some((e: any) => e.kind === 'settled')).toBe(false);
    },
  );
  it.each(['deadline', 'abort'])(
    'checks %s again after the durable reservation before sending',
    async (cause) => {
      let time = 0;
      const events = [];
      const controller = new AbortController();
      const budget = pilotBudget({
        now: () => time,
        journal: (e) => {
          events.push(e);
          if (e.kind === 'reserved') {
            if (cause === 'deadline') time = 600001;
            else controller.abort();
          }
        },
      });
      const send = vi.fn(async () => response());
      await expect(
        budget.call(body(), send, { ...run, signal: controller.signal }),
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
      expect(events).toContainEqual(expect.objectContaining({ kind: 'not-sent', reason: cause }));
      expect(budget.snapshot()).toMatchObject({
        reservedMicroUsd: RESERVATION_MICRO_USD,
        unknownCalls: 0,
        unsentCalls: 1,
        halted: true,
      });
    },
  );
  it('reserves the entire model window at the highest cache-write tariff, not a prompt estimate', () => {
    expect(RESERVATION_MICRO_USD).toBe((200_000 * 2000 + 1024 * 5000) / 1000);
    expect(16 * RESERVATION_MICRO_USD).toBeLessThanOrEqual(10_000_000);
  });
  it('refuses an asynchronous journal before sending', async () => {
    const f = fixture({ journal: () => Promise.resolve() });
    const send = vi.fn();
    await expect(f.budget.call(body(), send, run)).rejects.toThrow(/journal/);
    expect(send).not.toHaveBeenCalled();
  });
  it('unexpected one-hour cache usage stays unknown instead of being priced at five-minute rates', async () => {
    const f = fixture();
    const send = vi.fn(async () =>
      response({
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2 },
      }),
    );
    await expect(f.budget.call(body(), send, run)).rejects.toThrow(/usage/);
    expect(f.budget.snapshot()).toMatchObject({
      unknownCalls: 1,
      halted: true,
      reservedMicroUsd: RESERVATION_MICRO_USD,
    });
  });
  it('persists the entire model-window reservation before the transport runs and never refunds it', async () => {
    const f = fixture();
    const send = vi.fn(async (_body, options) => {
      expect(f.events).toContainEqual(
        expect.objectContaining({ kind: 'reserved', microUsd: RESERVATION_MICRO_USD }),
      );
      expect(options.maxRetries).toBe(0);
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(_body.service_tier).toBe('standard_only');
      return response();
    });
    await f.budget.call(body(), send, run);
    expect(f.budget.snapshot()).toMatchObject({
      calls: 1,
      reservedMicroUsd: RESERVATION_MICRO_USD,
      unknownCalls: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([0, RESERVATION_MICRO_USD - 1])(
    'refuses before sending when the remaining money is %s',
    async (maxMicroUsd) => {
      const f = fixture({ maxMicroUsd });
      const send = vi.fn();
      await expect(f.budget.call(body(), send, run)).rejects.toThrow(/cap/);
      expect(send).not.toHaveBeenCalled();
    },
  );
  it('counts in-flight reservations atomically across both groups', async () => {
    const f = fixture({ maxMicroUsd: RESERVATION_MICRO_USD });
    let finish: () => void = () => undefined;
    const first = f.budget.call(
      body(),
      () =>
        new Promise((resolve) => {
          finish = () => resolve(response());
        }),
      run,
    );
    const second = vi.fn();
    await expect(
      f.budget.call(body(), second, { arm: 'candidate', run: 'lookup' }),
    ).rejects.toThrow(/cap/);
    expect(second).not.toHaveBeenCalled();
    finish();
    await first;
  });
  it.each([undefined, {}, { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0 }])(
    'keeps unknown usage reserved and stops further sends',
    async (usage) => {
      const f = fixture();
      const send = vi.fn(async () => ({ usage }));
      await expect(f.budget.call(body(), send, run)).rejects.toThrow(/usage/);
      expect(f.budget.snapshot()).toMatchObject({
        reservedMicroUsd: RESERVATION_MICRO_USD,
        unknownCalls: 1,
        halted: true,
      });
      await expect(f.budget.call(body(), send, run)).rejects.toThrow(/halt/);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it('a timed-out transport stays reserved even if it ignores cancellation and resolves late', async () => {
    const f = fixture({ callTimeoutMs: 5 });
    let settle: (v: unknown) => void = () => undefined;
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    await expect(f.budget.call(body(), send, run)).rejects.toThrow(/timeout/);
    settle(response());
    await Promise.resolve();
    expect(f.budget.snapshot()).toMatchObject({
      reservedMicroUsd: RESERVATION_MICRO_USD,
      unknownCalls: 1,
      halted: true,
    });
    expect(f.events.filter((e: any) => e.kind === 'settled')).toHaveLength(0);
  });
  it('transport failure, caller abort and journal failure never permit another paid attempt', async () => {
    for (const cause of ['transport', 'abort', 'journal']) {
      const controller = new AbortController();
      const f = fixture(
        cause === 'journal'
          ? {
              journal() {
                throw new Error('disk');
              },
            }
          : {},
      );
      const send = vi.fn(async () => {
        if (cause === 'abort') controller.abort();
        throw new Error('DO-NOT-LEAK');
      });
      await expect(
        f.budget.call(body(), send, { ...run, signal: controller.signal }),
      ).rejects.toThrow();
      const later = vi.fn();
      await expect(f.budget.call(body(), later, run)).rejects.toThrow(/halt/);
      expect(later).not.toHaveBeenCalled();
      if (cause === 'journal') expect(send).not.toHaveBeenCalled();
      expect(JSON.stringify(f.events)).not.toContain('DO-NOT-LEAK');
    }
  });
  it.each([
    { model: 'claude-sonnet-4-5' },
    { max_tokens: 1025 },
    { max_tokens: 0 },
    { stream: true },
    { thinking: { type: 'enabled', budget_tokens: 2048 } },
    { tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
    { system: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
    { messages: [{ role: 'user', content: 'x'.repeat(96_001) }] },
  ])('refuses an unapproved request before reservation or transport: %j', async (extra) => {
    const f = fixture();
    const send = vi.fn();
    await expect(f.budget.call(body(extra), send, run)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(f.budget.snapshot().calls).toBe(0);
  });
  it('does not execute a body getter or toJSON callback', async () => {
    let touched = 0;
    const unsafe = body();
    Object.defineProperty(unsafe, 'metadata', {
      enumerable: true,
      get() {
        touched++;
        return 'secret';
      },
    });
    const f = fixture();
    const send = vi.fn();
    await expect(f.budget.call(unsafe, send, run)).rejects.toThrow();
    expect(touched).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('enforces total, per-arm, per-run call counts and the shared deadline', async () => {
    for (const option of [{ maxCalls: 1 }, { maxCallsPerArm: 1 }, { maxCallsPerRun: 1 }]) {
      const f = fixture(option);
      const send = vi.fn(async () => response());
      await f.budget.call(body(), send, run);
      await expect(f.budget.call(body(), send, run)).rejects.toThrow(/cap/);
      expect(send).toHaveBeenCalledTimes(1);
    }
    const f = fixture();
    f.advance(600_001);
    const send = vi.fn();
    await expect(f.budget.call(body(), send, run)).rejects.toThrow(/deadline/);
    expect(send).not.toHaveBeenCalled();
  });
  it('neither host settings nor reported usage can enlarge the frozen ceilings', async () => {
    expect(() => fixture({ maxMicroUsd: 10_000_001 })).toThrow();
    expect(() => fixture({ maxCalls: 17 })).toThrow();
    const f = fixture();
    const send = vi.fn(async () =>
      response({
        input_tokens: 200001,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }),
    );
    await expect(f.budget.call(body(), send, run)).rejects.toThrow(/usage/);
    expect(f.budget.snapshot().halted).toBe(true);
  });
});

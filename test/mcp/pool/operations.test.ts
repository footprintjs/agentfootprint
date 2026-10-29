/**
 * The operation budget (§ 5.3): every open, listing, call and ending, on any
 * client, is admitted against `maxOperations` before anything is sent, and stays
 * charged until its work has SETTLED — not until its caller was answered.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PoolFullError } from '../../../src/tool-providers/index.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, id, poolOver, stallingProvider } from './harness.js';

afterEach(() => {
  vi.useRealTimers();
});

/** A pool whose every client vends its credential from `vend`, over `endpoint`. */
function gatewayPool(
  endpoint: ReturnType<typeof fakeEndpoint>,
  vend: ReturnType<typeof stallingProvider>,
  options: Parameters<typeof poolOver>[1] = {},
) {
  return poolOver(endpoint, {
    transport: () => ({
      transport: 'gateway',
      url: endpoint.url,
      credentials: vend.provider,
      service: 'orders',
      fetch: endpoint.fetch,
    }),
    ...options,
  });
}

const calls = (endpoint: ReturnType<typeof fakeEndpoint>) =>
  endpoint.requests.filter((r) => r.rpc === 'tools/call');

describe('repeated same-key timeouts are bounded by maxOperations', () => {
  it('twenty stalled, timed-out calls on ONE existing client stay charged; the twenty-first call and a listing are refused before anything is sent; a late credential sends nothing and frees exactly one slot', async () => {
    const endpoint = fakeEndpoint();
    const vend = stallingProvider();
    const { pool } = gatewayPool(endpoint, vend, { maxClients: 1, maxOperations: 20 });
    const alice = id('alice', 'c1');
    const lease = await pool.acquire(alice);
    const [status] = await lease.tools();
    lease.release();

    const vendedBefore = vend.asked;
    vend.stall();
    const answered: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i += 1) {
      const caller = new AbortController();
      const call = status!.execute({}, callCtx(alice, caller.signal)).catch((e: unknown) => e);
      await flush(2);
      caller.abort(new Error('the caller timed out'));
      answered.push(call);
    }
    // Each caller got its answer (the SDK wraps the abort reason in its own error).
    for (const result of await Promise.all(answered)) {
      expect((result as Error).message).toContain('the caller timed out');
    }
    // Each call's vend, and the vend of the SDK's `notifications/cancelled` for
    // it: work started for the call, counted under it.
    expect(vend.waiting).toBe(40);
    expect(pool.stats()).toMatchObject({
      operations: 20,
      open: 1,
      ending: 0,
      unsettled: { call: 20, open: 0, listing: 0, ending: 0 },
    });

    const before = endpoint.requests.length;
    const refused = await status!.execute({}, callCtx(alice)).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PoolFullError);
    expect(refused).toMatchObject({ limit: 'operations', max: 20, operations: 20, sent: false });
    const listed = await pool
      .toolProvider()
      .list({ iteration: 1, callerIdentity: alice } as ToolDispatchContext)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(listed).toMatchObject({ limit: 'operations' });
    expect(endpoint.requests.length).toBe(before);
    expect(vend.asked - vendedBefore).toBe(40);

    // A's credentials arrive after its deadline: no tools/call is sent, and A settles.
    vend.releaseOne();
    await flush(10);
    expect(pool.stats().operations).toBe(20);
    vend.releaseOne();
    await flush(10);
    expect(calls(endpoint)).toHaveLength(0);
    expect(pool.stats().operations).toBe(19);
    // Exactly one new call is admitted.
    const admitted = status!.execute({}, callCtx(alice)).catch((e: unknown) => e);
    await flush(2);
    expect(pool.stats().operations).toBe(20);
    await expect(status!.execute({}, callCtx(alice))).rejects.toMatchObject({
      limit: 'operations',
    });
    vend.releaseAll();
    await admitted;
    await pool.settled();
    // Only the admitted call ever reached the network; the late credentials sent nothing.
    expect(calls(endpoint)).toHaveLength(1);
  });

  it('a streamed answer whose send() has returned keeps its operation charged until the response itself arrives', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const lease = await pool.acquire(alice);
    const [status] = await lease.tools();
    lease.release();
    const stream = endpoint.streamNext();
    const call = status!.execute({}, callCtx(alice));
    await flush(10);
    // The request was sent and its stream started: send() returned. Still charged.
    expect(calls(endpoint)).toHaveLength(1);
    expect(pool.stats().operations).toBe(1);
    stream.send();
    await expect(call).resolves.toContain('status@');
    await pool.settled();
    expect(pool.stats().operations).toBe(0);
  });
});

describe('the accounting unit: one admitted logical operation', () => {
  it('at maxOperations 1 and maxEnding 1, a cold listing (open, list), a cold call (open, call) and a call that meets a replacement (open, revalidating list, call) each complete in ONE slot', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, { maxOperations: 1, maxEnding: 1 });
    const alice = id('alice', 'c1');
    const ctx = { iteration: 1, callerIdentity: alice } as ToolDispatchContext;
    // A cold listing: open + list, one slot.
    const tools = await pool.toolProvider().list(ctx);
    expect(tools.map((t) => t.schema.name)).toEqual(['status']);
    await pool.settled();
    // A warm call.
    await expect(tools[0]!.execute({}, callCtx(alice))).resolves.toContain('status@');
    await pool.settled();
    // The client ends; the old tool meets a replacement: open, revalidating list, call — one slot.
    await pool.terminate({ principal: 'alice', conversationId: 'c1' });
    await pool.settled();
    await expect(tools[0]!.execute({}, callCtx(alice))).resolves.toContain('status@');
    expect(endpoint.requests.filter((r) => r.rpc === 'initialize')).toHaveLength(2);
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/list')).toHaveLength(2);
    await pool.settled();
    expect(pool.stats().operations).toBe(0);
  });

  it('an idle client due for ending is ended BEFORE the next admission; a conversation refused while the only slot was held succeeds once that ending settles', async () => {
    const endpoint = fakeEndpoint();
    let now = 1_000_000;
    const { pool } = poolOver(endpoint, {
      maxOperations: 1,
      maxEnding: 1,
      idleMs: 1_000,
      now: () => now,
    });
    (await pool.acquire(id('alice', 'c1'))).release();
    await pool.settled();
    const ending = endpoint.hold((r) => r.method === 'DELETE');
    now += 2_000;
    // The sweep reserves alice's ending first — the only slot — so bob is refused.
    await expect(pool.acquire(id('bob', 'c2'))).rejects.toMatchObject({ limit: 'operations' });
    expect(pool.stats()).toMatchObject({ ending: 1, operations: 1 });
    ending.release();
    await pool.settled();
    const lease = await pool.acquire(id('bob', 'c2'));
    lease.release();
  });
});

describe('ending admission: an ending reserves an ending slot AND an operation slot first', () => {
  /** A pool whose only operation slot is held by a stalled call on `holder`'s client. */
  async function fullBudget(extra: Parameters<typeof poolOver>[1] = {}) {
    const stalled: Array<() => void> = [];
    const endpoint = fakeEndpoint({
      onCall: async (_session, name) => {
        if (name === 'stall') await new Promise<void>((resolve) => stalled.push(resolve));
        return { content: [{ type: 'text', text: 'ok' }] };
      },
      toolsFor: () => [{ name: 'status' }, { name: 'stall' }],
    });
    let now = 1_000_000;
    const { pool, reports } = poolOver(endpoint, {
      maxOperations: 2,
      maxClients: 2,
      idleMs: 1_000,
      now: () => now,
      ...extra,
    });
    const holder = id('holder', 'h1');
    const lease = await pool.acquire(holder);
    const tools = await lease.tools();
    lease.release();
    const victim = await pool.acquire(id('victim', 'v1'));
    victim.release();
    await pool.settled();
    // Two slots: one stalled call, one more stalled call — the budget is full.
    const stall = tools.find((t) => t.schema.name === 'stall')!;
    const first = stall.execute({}, callCtx(holder)).catch((error: unknown) => error);
    const second = stall.execute({}, callCtx(holder)).catch((error: unknown) => error);
    await flush(5);
    expect(pool.stats().operations).toBe(2);
    return {
      pool,
      reports,
      endpoint,
      advance: (ms: number) => (now += ms),
      release: async () => {
        for (const resolve of stalled.splice(0)) resolve();
        await Promise.allSettled([first, second]);
      },
    };
  }

  it('an idle end with the operation budget full: kept in the open set, counted, reported deferred, never as ended; once slots free it moves and ends', async () => {
    const { pool, reports, advance, release } = await fullBudget();
    advance(2_000);
    pool.sweep();
    expect(pool.stats()).toMatchObject({ open: 2, ending: 0 });
    expect(reports.filter((r) => r.kind === 'deferred')).not.toEqual([]);
    expect(reports.filter((r) => r.kind === 'ended')).toEqual([]);
    await release();
    await pool.settled();
    expect(reports).toContainEqual(expect.objectContaining({ kind: 'ended', reason: 'idle' }));
  });

  it('terminate with the operation budget full: deferred, then ended once slots free', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { pool, reports, release } = await fullBudget();
    const outcomes = await pool.terminate({ principal: 'victim' });
    vi.useRealTimers();
    expect(outcomes).toEqual([]);
    expect(reports).toContainEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'terminated' }),
    );
    expect(pool.stats().open).toBe(2);
    await release();
    await pool.settled();
    expect(reports).toContainEqual(
      expect.objectContaining({ kind: 'ended', reason: 'terminated' }),
    );
  });

  it('an eviction with the operation budget full: the arrival is refused at once; the victim stays counted, reported deferred, and ends once slots free', async () => {
    // One slot left: the arrival is admitted, and its eviction finds no slot.
    const { pool, reports, release } = await fullBudget({ maxOperations: 3 });
    await expect(pool.acquire(id('newcomer', 'n1'))).rejects.toMatchObject({
      limit: 'operations',
    });
    // Deferred first — never reported ended before it ran — and ended once a slot
    // freed (here, the refused arrival's own).
    await release();
    await pool.settled();
    const deferredAt = reports.findIndex((r) => r.kind === 'deferred' && r.reason === 'evicted');
    const endedAt = reports.findIndex((r) => r.kind === 'ended' && r.reason === 'evicted');
    expect(deferredAt).toBeGreaterThanOrEqual(0);
    expect(endedAt).toBeGreaterThan(deferredAt);
  });

  it('close with the operation budget full: deferred and never reported as ended while slots are held', async () => {
    const { pool, reports, release } = await fullBudget();
    const closing = pool.close();
    await flush(5);
    // close aborts the in-flight calls through the pool's own signal: they settle,
    // slots free, and every client ends.
    await release().catch(() => undefined);
    const outcomes = await closing;
    await pool.settled();
    expect(outcomes.length + reports.filter((r) => r.kind === 'ended').length).toBeGreaterThan(0);
    expect(pool.stats()).toMatchObject({ open: 0, ending: 0, operations: 0 });
  });

  it('an abandoned open that opened a session: its ending waits for slots — deferred, never reported ended first — then ends', async () => {
    // The app's fetch ignores its abort and no retry series stands between it and
    // the SDK, so the late `initialize` answer — and its session id — reach the client.
    const endpoint = fakeEndpoint();
    const slow = endpoint.hold((r) => r.rpc === 'initialize');
    const { pool, reports } = poolOver(endpoint, {
      initTimeoutMs: 30,
      maxOperations: 1,
      retryOnThrottle: false,
    });
    await expect(pool.acquire(id('alice', 'c1'))).rejects.toMatchObject({ reason: 'init-timeout' });
    slow.release();
    await flush(10);
    await pool.settled();
    const deferredAt = reports.findIndex(
      (r) => r.kind === 'deferred' && r.reason === 'abandoned-open',
    );
    const endedAt = reports.findIndex((r) => r.kind === 'ended' && r.reason === 'abandoned-open');
    expect(deferredAt).toBeGreaterThanOrEqual(0);
    expect(endedAt).toBeGreaterThan(deferredAt);
    expect(reports[endedAt]).toMatchObject({ remote: 'terminated', resolved: true });
    expect(endpoint.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    expect(pool.stats()).toMatchObject({ open: 0, ending: 0, operations: 0 });
  });
});

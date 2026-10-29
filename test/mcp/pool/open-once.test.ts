/**
 * One open per key (§ 5.1): at most one open in flight per conversation, under
 * the POOL's own signal and `initTimeoutMs`, never a caller's. A failure reaches
 * every waiter and is not cached. A timed-out open refuses every waiter at once,
 * stays counted until its own work settles, and blocks the key until then.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpPoolRefusedError, PoolFullError } from '../../../src/tool-providers/index.js';
import { takeListUses } from '../../../src/tools/mcpClientUse.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, id, poolOver } from './harness.js';

afterEach(() => {
  vi.useRealTimers();
});

const opens = (requests: readonly { rpc?: string }[]) =>
  requests.filter((r) => r.rpc === 'initialize').length;

describe('one open per key', () => {
  it('ten concurrent first acquires under one key open once (counted at the network)', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const leases = await Promise.all(Array.from({ length: 10 }, () => pool.acquire(alice)));
    expect(opens(endpoint.requests)).toBe(1);
    expect(pool.stats()).toMatchObject({ open: 1, busy: 1 });
    for (const lease of leases) lease.release();
    expect(pool.stats()).toMatchObject({ open: 1, idle: 1 });
  });

  it('ten concurrent first CALLS of one tool open once, and every call lands in that one session', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const lease = await pool.acquire(alice);
    const [status] = await lease.tools();
    lease.release();
    await pool.terminate({ principal: 'alice', conversationId: 'c1' });
    // The next ten calls meet no client: they open ONE replacement, together.
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => status!.execute({}, callCtx(alice))),
    );
    expect(opens(endpoint.requests)).toBe(2);
    const sessions = new Set(
      endpoint.requests.filter((r) => r.rpc === 'tools/call').map((r) => r.session),
    );
    expect(sessions.size).toBe(1);
    expect(new Set(answers).size).toBe(1);
  });

  it('a failed open refuses every waiter with init-failed — cause kept, never in the message — and caches nothing', async () => {
    const endpoint = fakeEndpoint();
    let failing = true;
    const { pool } = poolOver(endpoint, {
      transport: () => ({
        transport: 'http',
        url: endpoint.url,
        fetch: async (input, init) => {
          if (failing) throw new TypeError('connect ECONNREFUSED secret-host:443');
          return endpoint.fetch(input, init);
        },
      }),
      retryOnThrottle: false,
    });
    const alice = id('alice', 'c1');
    const results = await Promise.allSettled([pool.acquire(alice), pool.acquire(alice)]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      const error = (result as PromiseRejectedResult).reason as McpPoolRefusedError;
      expect(error).toBeInstanceOf(McpPoolRefusedError);
      expect(error.reason).toBe('init-failed');
      expect(error.sent).toBe(false);
      expect(error.message).not.toContain('secret-host');
      expect(error.cause).toBeDefined();
    }
    await flush();
    expect(pool.stats()).toMatchObject({ open: 0, operations: 0 });
    // Not cached: the next acquire opens again.
    failing = false;
    const lease = await pool.acquire(alice);
    expect(opens(endpoint.requests)).toBe(1);
    lease.release();
  });

  it('an open past initTimeoutMs refuses every waiter at once; until its work settles it is counted and the key cannot open again', async () => {
    const endpoint = fakeEndpoint();
    const stuck = endpoint.hold((r) => r.rpc === 'initialize');
    const { pool } = poolOver(endpoint, { initTimeoutMs: 50, maxClients: 2 });
    const alice = id('alice', 'c1');
    const first = pool.acquire(alice);
    const joiner = pool.acquire(alice);
    await expect(first).rejects.toMatchObject({ reason: 'init-timeout' });
    await expect(joiner).rejects.toMatchObject({ reason: 'init-timeout' });
    // Still charged to the open set: its own work has not settled.
    expect(pool.stats()).toMatchObject({ open: 1, opening: 1 });
    // One key never has two opens: refused at once, same reason, nothing sent —
    // and the record says no client was touched.
    await expect(pool.acquire(alice)).rejects.toMatchObject({ reason: 'init-timeout' });
    const ctx = { iteration: 1, callerIdentity: alice } as never;
    const listed = await pool
      .toolProvider()
      .list(ctx)
      .catch((error: unknown) => error);
    expect(listed).toMatchObject({ reason: 'init-timeout' });
    expect(takeListUses(ctx)).toEqual([
      expect.objectContaining({ client: 'refused', refusal: 'init-timeout' }),
    ]);
    expect(takeListUses(ctx)[0]?.clientId).toBeUndefined();
    expect(stuck.held).toBe(1);
    // Its work settles: the open had opened a session, so the client is ended,
    // never handed to anyone; then the key opens again.
    stuck.release();
    await flush(20);
    await pool.settled();
    expect(pool.stats()).toMatchObject({ open: 0, opening: 0, ending: 0 });
    const lease = await pool.acquire(alice);
    expect(opens(endpoint.requests)).toBe(2);
    lease.release();
  });

  it("one waiter's abort detaches only that waiter; the open goes on for the others", async () => {
    const endpoint = fakeEndpoint();
    const slow = endpoint.hold((r) => r.rpc === 'initialize');
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const quitter = new AbortController();
    const leaving = pool.acquire(alice, { signal: quitter.signal });
    const staying = pool.acquire(alice);
    await flush();
    quitter.abort(new Error('the run was cancelled'));
    await expect(leaving).rejects.toThrow('the run was cancelled');
    slow.release();
    const lease = await staying;
    expect(opens(endpoint.requests)).toBe(1);
    expect(pool.stats()).toMatchObject({ open: 1, busy: 1 });
    lease.release();
  });
});

describe('a shared open runs under the pool’s own signal and deadline', () => {
  it("the creator's cancelled call detaches it; the open continues for a surviving joiner, the creator's charge stays until the open settles, and the creator never sends its tools/call", async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, { maxOperations: 4 });
    const alice = id('alice', 'c1');
    // A listed tool whose client is then ended: its next call opens a replacement.
    const lease = await pool.acquire(alice);
    const [status] = await lease.tools();
    lease.release();
    await pool.terminate({ principal: 'alice', conversationId: 'c1' });
    await pool.settled();

    const slow = endpoint.hold((r) => r.rpc === 'initialize');
    const creator = new AbortController();
    const created = status!.execute({}, callCtx(alice, creator.signal));
    await flush();
    const joined = status!.execute({}, callCtx(alice));
    await flush();
    creator.abort(new Error('the creator gave up'));
    await expect(created).rejects.toThrow('the creator gave up');
    // The creator was answered; its charge stays while the open it started runs.
    expect(pool.stats().operations).toBe(2);
    expect(pool.stats().unsettled.open).toBe(1);

    slow.release();
    await expect(joined).resolves.toContain('status@');
    await pool.settled();
    expect(pool.stats().operations).toBe(0);
    // One open, one call: the detached creator sent nothing after the open.
    expect(opens(endpoint.requests)).toBe(2);
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/call')).toHaveLength(1);
  });

  it('the shared open is bounded by initTimeoutMs even when every caller waits forever', async () => {
    const endpoint = fakeEndpoint();
    endpoint.hold((r) => r.rpc === 'initialize');
    const { pool } = poolOver(endpoint, { initTimeoutMs: 40 });
    const started = Date.now();
    await expect(pool.acquire(id('alice', 'c1'))).rejects.toMatchObject({
      reason: 'init-timeout',
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('the admitted joiner — the accounting unit at small budgets', () => {
  it('with two slots, a joiner is admitted and waits inside its OWN slot; both complete', async () => {
    const endpoint = fakeEndpoint();
    const slow = endpoint.hold((r) => r.rpc === 'initialize');
    const { pool } = poolOver(endpoint, { maxOperations: 2 });
    const alice = id('alice', 'c1');
    const first = pool.acquire(alice);
    const second = pool.acquire(alice);
    await flush();
    expect(pool.stats().operations).toBe(2);
    slow.release();
    const [a, b] = await Promise.all([first, second]);
    expect(opens(endpoint.requests)).toBe(1);
    a.release();
    b.release();
    await pool.settled();
    expect(pool.stats().operations).toBe(0);
  });

  it('with one slot, a concurrent second operation is refused at once (operations), not admitted as a joiner', async () => {
    const endpoint = fakeEndpoint();
    const slow = endpoint.hold((r) => r.rpc === 'initialize');
    const { pool } = poolOver(endpoint, { maxOperations: 1 });
    const alice = id('alice', 'c1');
    const first = pool.acquire(alice);
    await flush();
    const refused = await pool.acquire(alice).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PoolFullError);
    expect(refused).toMatchObject({ limit: 'operations', max: 1, operations: 1 });
    slow.release();
    (await first).release();
  });
});

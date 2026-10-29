/**
 * Leases and a full pool (§ 5.2–5.3): a client in use is never evicted, closed
 * for idleness or ended; a full pool moves its least recently used IDLE client
 * to the ending set, or refuses at once with `PoolFullError` — there is no queue.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
});

import { PoolFullError, POOL_FULL_SENTENCE } from '../../../src/mcp/pool/errors.js';
import { McpPoolRefusedError } from '../../../src/tool-providers/index.js';
import type { McpClientUse } from '../../../src/tools/mcpClientUse.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, id, poolOver } from './harness.js';

/** A clock the test moves. */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('a client in use is never ended', () => {
  it('a leased client is never evicted, idle-closed or terminated — even when it is the oldest', async () => {
    const endpoint = fakeEndpoint();
    const time = clock();
    const { pool, reports } = poolOver(endpoint, { maxClients: 1, idleMs: 1_000, now: time.now });
    const held = await pool.acquire(id('alice', 'c1'));
    time.advance(5_000); // long past idle
    // Eviction: the only client is leased, so a newcomer is refused, not admitted.
    await expect(pool.acquire(id('bob', 'c2'))).rejects.toMatchObject({ limit: 'pool' });
    // Idle sweep: leased, so not swept.
    pool.sweep();
    expect(pool.stats()).toMatchObject({ open: 1, busy: 1, ending: 0 });
    // terminate: it waits up to 5 s for in-flight work; still leased, the client
    // is deferred, never reported ended.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const terminating = pool.terminate({ principal: 'alice', conversationId: 'c1' });
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();
    expect(await terminating).toEqual([]);
    expect(reports.filter((r) => r.kind === 'ended')).toEqual([]);
    expect(reports).toContainEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'terminated' }),
    );
    // …and it ends at the LAST release.
    held.release();
    await pool.settled();
    expect(reports).toContainEqual(
      expect.objectContaining({ kind: 'ended', reason: 'terminated', resolved: true }),
    );
    expect(endpoint.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  });

  it('terminate during an in-flight call: deferred, then ended the moment that call settles — no further pool call needed', async () => {
    let finish!: () => void;
    const endpoint = fakeEndpoint({
      onCall: async () => {
        await new Promise<void>((resolve) => (finish = resolve));
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
    const { pool, reports } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const lease = await pool.acquire(alice);
    const [status] = await lease.tools();
    lease.release();
    const call = status!.execute({}, callCtx(alice));
    await flush();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const terminating = pool.terminate({ principal: 'alice', conversationId: 'c1' });
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();
    expect(await terminating).toEqual([]);
    expect(reports).toContainEqual(
      expect.objectContaining({ kind: 'deferred', reason: 'terminated' }),
    );
    finish();
    await call;
    await flush(10);
    // No acquire, list, release or sweep since: the call's own settlement ended it.
    expect(reports).toContainEqual(
      expect.objectContaining({ kind: 'ended', reason: 'terminated' }),
    );
  });

  it("a full pool moves its least recently used idle client to the ending set; that key's next open says previous: 'evicted'", async () => {
    const endpoint = fakeEndpoint();
    const time = clock();
    const { pool, reports } = poolOver(endpoint, { maxClients: 2, now: time.now });
    const alice = id('alice', 'c1');
    const a = await pool.acquire(alice);
    const aliceTools = await a.tools();
    a.release();
    time.advance(10);
    (await pool.acquire(id('bob', 'c2'))).release();
    time.advance(10);
    // Full: alice's client is the least recently used idle one.
    (await pool.acquire(id('carol', 'c3'))).release();
    await pool.settled();
    expect(reports).toContainEqual(expect.objectContaining({ kind: 'ended', reason: 'evicted' }));
    // Alice's next call opens a replacement — and the record says why.
    const uses: McpClientUse[] = [];
    await aliceTools[0]!.execute({}, callCtx(alice, undefined, uses));
    expect(uses).toEqual([
      expect.objectContaining({ client: 'opened', previous: 'evicted', generation: 2 }),
    ]);
    expect(pool.stats().open).toBe(2);
  });

  it('all busy: PoolFullError at once, with typed fields and the fixed sentence — nothing sent', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, { maxClients: 2 });
    const one = await pool.acquire(id('alice', 'c1'));
    const two = await pool.acquire(id('bob', 'c2'));
    const before = endpoint.requests.length;
    const refused = await pool.acquire(id('carol', 'c3')).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PoolFullError);
    expect(refused).toMatchObject({
      limit: 'pool',
      max: 2,
      busy: 2,
      ending: 0,
      sent: false,
      message: POOL_FULL_SENTENCE,
    });
    expect((refused as Error).message).toBe(
      'The connection pool for this server was full, so the tool call was not sent.',
    );
    expect(endpoint.requests.length).toBe(before);
    one.release();
    two.release();
  });

  it("the per-principal cap ends the principal's OWN least recently used idle client first", async () => {
    const endpoint = fakeEndpoint();
    const time = clock();
    const { pool, reports } = poolOver(endpoint, {
      maxClients: 10,
      maxClientsPerPrincipal: 2,
      now: time.now,
    });
    (await pool.acquire(id('bob', 'b1'))).release(); // the pool's oldest — not alice's
    time.advance(10);
    (await pool.acquire(id('alice', 'a1'))).release();
    time.advance(10);
    (await pool.acquire(id('alice', 'a2'))).release();
    time.advance(10);
    (await pool.acquire(id('alice', 'a3'))).release();
    await pool.settled();
    const ended = reports.filter((r) => r.kind === 'ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ reason: 'evicted' });
    // Bob's older client was not touched: one ending, and it was alice's.
    expect(pool.stats().open).toBe(3);
    // A principal whose clients are all busy is refused by name.
    const x = await pool.acquire(id('dave', 'd1'));
    const y = await pool.acquire(id('dave', 'd2'));
    await expect(pool.acquire(id('dave', 'd3'))).rejects.toMatchObject({
      limit: 'principal',
      max: 2,
    });
    x.release();
    y.release();
  });
});

describe('the app lease', () => {
  it('an app lease past maxLeaseMs is revoked at the next interaction and reported; its in-flight call completes; its next use throws lease-expired', async () => {
    const endpoint = fakeEndpoint({
      onCall: async () => {
        await gate;
        return { content: [{ type: 'text', text: 'done' }] };
      },
    });
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const time = clock();
    const { pool, reports } = poolOver(endpoint, { maxLeaseMs: 1_000, now: time.now });
    const alice = id('alice', 'c1');
    const lease = await pool.acquire(alice);
    const [status] = await lease.tools();
    const inFlight = status!.execute({}, callCtx(alice));
    await flush();
    time.advance(2_000);
    pool.sweep();
    expect(reports).toContainEqual(expect.objectContaining({ kind: 'lease-revoked' }));
    await expect(lease.tools()).rejects.toMatchObject({ reason: 'lease-expired' });
    // The call already in flight keeps its own lease: the client is still busy.
    expect(pool.stats().busy).toBe(1);
    open();
    await expect(inFlight).resolves.toBe('done');
    await pool.settled();
    expect(pool.stats().busy).toBe(0);
  });

  it('release() twice is one release', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const alice = id('alice', 'c1');
    const one = await pool.acquire(alice);
    const two = await pool.acquire(alice);
    one.release();
    one.release();
    // Still held by the second lease: busy.
    expect(pool.stats().busy).toBe(1);
    two.release();
    expect(pool.stats().busy).toBe(0);
    await expect(one.tools()).rejects.toBeInstanceOf(McpPoolRefusedError);
  });

  it('`await using` releases: the lease is AsyncDisposable', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const lease = await pool.acquire(id('alice', 'c1'));
    expect(pool.stats().busy).toBe(1);
    // What `await using lease = …` calls when its block ends.
    await lease[Symbol.asyncDispose]();
    expect(pool.stats().busy).toBe(0);
    await lease[Symbol.asyncDispose]();
    expect(pool.stats().busy).toBe(0);
  });
});

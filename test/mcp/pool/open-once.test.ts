/**
 * One open per key (§ 5.1): at most one open in flight per conversation, under
 * the POOL's own signal and `initTimeoutMs`, never a caller's. A failure reaches
 * every waiter and is not cached. A timed-out open refuses every waiter at once,
 * stays counted until its own work settles, and blocks the key until then.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OpenedClient } from '../../../src/mcp/pool/plan.js';
import type { McpPoolReport } from '../../../src/mcp/pool/record.js';
import {
  mcpClientPool,
  McpPoolRefusedError,
  PoolFullError,
} from '../../../src/tool-providers/index.js';
import { takeListUses } from '../../../src/tools/mcpClientUse.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, id, poolOver } from './harness.js';
import { NO_NETWORK, stubClient } from './stubClient.js';

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

describe('the open → lease handoff: a just-opened client is held for the callers that waited for it', () => {
  it('a second key admitted in the next microtask finds no idle client to end: it is refused at once, and the first lease serves from the client it holds', async () => {
    const ended: string[] = [];
    let complete!: (opened: OpenedClient) => void;
    const firstOpen = new Promise<OpenedClient>((resolve) => (complete = resolve));
    let opened = 0;
    const pool = mcpClientPool({
      name: 'handoff',
      transport: NO_NETWORK,
      maxClients: 1,
      maxOperations: 4,
      _open: () => (++opened === 1 ? firstOpen : Promise.resolve(stubClient('second', { ended }))),
    });
    const alice = id('alice', 'a');
    const first = pool.acquire(alice);
    complete(stubClient('first', { ended }));
    // The open has settled; its caller has not resumed yet.
    await Promise.resolve();
    const second = pool.acquire(id('bob', 'b')).then(
      (lease) => ({ lease }),
      (error: unknown) => ({ error }),
    );
    const lease = await first;
    expect(await second).toMatchObject({ error: { name: 'PoolFullError', limit: 'pool' } });
    expect(ended).toEqual([]);
    // The lease serves from the client it holds: no second open, nothing refused.
    const [status] = await lease.tools();
    await expect(status!.execute({}, callCtx(alice))).resolves.toBe('status@first');
    expect(opened).toBe(1);
    lease.release();
    await pool.close();
    await pool.settled();
    expect(ended).toEqual(['first']);
  });

  it('a joiner is held for too: an arrival between the open settling and the joiner resuming cannot end the client the joiner waited for', async () => {
    const ended: string[] = [];
    let complete!: (opened: OpenedClient) => void;
    const firstOpen = new Promise<OpenedClient>((resolve) => (complete = resolve));
    let opened = 0;
    const pool = mcpClientPool({
      name: 'handoff',
      transport: NO_NETWORK,
      maxClients: 1,
      maxOperations: 4,
      _open: () => (++opened === 1 ? firstOpen : Promise.resolve(stubClient('second', { ended }))),
    });
    const alice = id('alice', 'a');
    const opener = new AbortController();
    // The opener gives up; the joiner waits on.
    const creator = pool.acquire(alice, { signal: opener.signal }).catch((error: unknown) => error);
    const joiner = pool.acquire(alice);
    opener.abort(new Error('the opener gave up'));
    await flush(1);
    complete(stubClient('first', { ended }));
    await Promise.resolve();
    const bob = await pool.acquire(id('bob', 'b')).catch((error: unknown) => error);
    expect(bob).toMatchObject({ name: 'PoolFullError', limit: 'pool' });
    const lease = await joiner;
    expect(await creator).toBeInstanceOf(Error);
    expect(ended).toEqual([]);
    const [status] = await lease.tools();
    await expect(status!.execute({}, callCtx(alice))).resolves.toBe('status@first');
    lease.release();
    await pool.close();
  });
});

describe('the client is checked again after every wait', () => {
  it('a client named by terminate while it opens is never leased: the waiting listing opens the key’s next client and lists there', async () => {
    const ended: string[] = [];
    const listedOn: string[] = [];
    const named = (name: string) =>
      stubClient(name, {
        ended,
        tools: () => {
          listedOn.push(name);
          return ['status'];
        },
      });
    let complete!: (opened: OpenedClient) => void;
    const firstOpen = new Promise<OpenedClient>((resolve) => (complete = resolve));
    let opened = 0;
    const pool = mcpClientPool({
      name: 'renamed',
      transport: NO_NETWORK,
      _open: () => (++opened === 1 ? firstOpen : Promise.resolve(named('second'))),
    });
    const alice = id('alice', 'a');
    const listing = pool
      .toolProvider()
      .list({ iteration: 1, callerIdentity: alice } as ToolDispatchContext);
    await flush(1);
    const terminating = pool.terminate({ principal: 'alice', conversationId: 'a' });
    complete(named('first'));
    const [status] = await listing;
    // The listing never ran on the client the terminate named.
    expect(listedOn).toEqual(['second']);
    await expect(status!.execute({}, callCtx(alice))).resolves.toBe('status@second');
    expect(opened).toBe(2);
    await terminating;
    expect(ended).toEqual(['first']);
    await pool.close();
  });
});

describe('a client is never ended while a waiter holds its reservation', () => {
  it('an open that completes as its deadline aborts it: the waiter is refused (init-timeout), and the client — still reserved by that waiter — is reported deferred, then ended once it lets go', async () => {
    const reports: McpPoolReport[] = [];
    let ends = 0;
    const pool = mcpClientPool({
      name: 'abandoned',
      transport: NO_NETWORK,
      initTimeoutMs: 10,
      onEvent: (report) => reports.push(report),
      // The open completes exactly when its deadline aborts it.
      _open: (_options, seam) =>
        new Promise<OpenedClient>((resolve) =>
          seam.connectSignal.addEventListener('abort', () =>
            resolve(
              stubClient('late', {
                end: () => {
                  ends += 1;
                  return {
                    outcome: Promise.resolve({
                      remote: 'terminated',
                      resolved: true,
                      durationMs: 0,
                    }),
                    settled: Promise.resolve(),
                  };
                },
              }),
            ),
          ),
        ),
    });
    await expect(pool.acquire(id('alice', 'a'))).rejects.toMatchObject({ reason: 'init-timeout' });
    await pool.settled();
    expect(ends).toBe(1);
    expect(reports.map((r) => ({ kind: r.kind, reason: r.reason }))).toEqual([
      { kind: 'deferred', reason: 'abandoned-open' },
      { kind: 'ended', reason: 'abandoned-open' },
    ]);
    expect(pool.stats()).toMatchObject({ open: 0, busy: 0, ending: 0, operations: 0 });
    await pool.close();
  });
});

describe('a caller that has already gone is never served', () => {
  const gone = (): AbortSignal => {
    const caller = new AbortController();
    caller.abort(new Error('the caller gave up'));
    return caller.signal;
  };

  it('a pre-aborted acquire on a WARM client is refused: no lease, nothing held', async () => {
    const pool = mcpClientPool({
      name: 'warm',
      transport: NO_NETWORK,
      _open: async () => stubClient('warm'),
    });
    const alice = id('alice', 'a');
    (await pool.acquire(alice)).release();
    await expect(pool.acquire(alice, { signal: gone() })).rejects.toThrow('the caller gave up');
    await pool.settled();
    expect(pool.stats()).toMatchObject({ open: 1, busy: 0, operations: 0 });
    await pool.close();
  });

  it('a pre-aborted listing on a WARM client with a current list is refused: nothing listed, nothing bound', async () => {
    let listings = 0;
    const pool = mcpClientPool({
      name: 'warm',
      transport: NO_NETWORK,
      _open: async () =>
        stubClient('warm', {
          tools: () => {
            listings += 1;
            return ['status'];
          },
        }),
    });
    const alice = id('alice', 'a');
    const ctx = (signal?: AbortSignal): ToolDispatchContext =>
      ({
        iteration: 1,
        callerIdentity: alice,
        ...(signal !== undefined && { signal }),
      } as ToolDispatchContext);
    await pool.toolProvider().list(ctx());
    expect(listings).toBe(1);
    await expect(pool.toolProvider().list(ctx(gone()))).rejects.toThrow('the caller gave up');
    expect(listings).toBe(1);
    await pool.settled();
    expect(pool.stats()).toMatchObject({ busy: 0, operations: 0 });
    await pool.close();
  });
});

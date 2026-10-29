/**
 * Properties of the pool, over seeded random inputs (mulberry32 — the same
 * draws every run, the repo's convention for property tests).
 *
 *   1. Distinct identity tuples — with `/`, `%`, `_` and empty strings in them —
 *      never share a client.
 *   2. Over random interleavings of acquire, release, call (some stalled in a
 *      credential vend, some given up by their caller), sweep, terminate and
 *      invalidation:
 *        - held clients never exceed `maxClients + maxEnding`;
 *        - running endings never exceed `maxEnding`;
 *        - outstanding operations never exceed `maxOperations`;
 *        - a client with a call in flight is never ended;
 *        - no `tools/call` reaches the network after its caller was answered;
 *        - no `tools/call` reaches the network under a binding that was stale;
 *        - every charge settles, and every lease is released exactly once.
 */

import { describe, expect, it } from 'vitest';

import type { McpClientUse } from '../../../src/tools/mcpClientUse.js';
import type { Tool } from '../../../src/tools/tools.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, poolOver, stallingProvider } from './harness.js';

/** mulberry32 — the same draws every run. */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 1_000 + i * 7);

describe('property: distinct identity tuples never share a client', () => {
  it.each(SEEDS.slice(0, 12))('seed %i', async (seed) => {
    const rand = rng(seed);
    const parts = ['', '_', '/', '%', 'a', 'a/b', 'a%2Fb', '%5F', 'b'];
    const pick = () => parts[Math.floor(rand() * parts.length)]!;
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, {
      requirePrincipal: false,
      maxClients: 500,
      maxClientsPerPrincipal: 500,
    });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const conversationId = pick() || 'c';
      const tenant = pick();
      const principal = pick();
      const identity = {
        conversationId,
        ...(tenant !== '' && { tenant }),
        ...(principal !== '' && { principal }),
      };
      // The reference: equal by value, an empty string being absence.
      seen.add(JSON.stringify([tenant, principal, conversationId]));
      (await pool.acquire(identity)).release();
    }
    expect(endpoint.requests.filter((r) => r.rpc === 'initialize')).toHaveLength(seen.size);
  });
});

describe('property: random interleavings keep every budget and every gate', () => {
  it.each(SEEDS)(
    'seed %i',
    async (seed) => {
      const rand = rng(seed);
      const chance = (p: number) => rand() < p;
      const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

      const limits = { maxClients: 3, maxClientsPerPrincipal: 2, maxEnding: 2, maxOperations: 5 };
      const violations: string[] = [];
      const inFlight = new Map<string, number>();
      /** Calls whose caller was answered before their request reached the network. */
      const answered = new Set<number>();
      let epoch = 0;

      /** The epoch each session's tool list was last taken at, by the network's clock. */
      const listedAt = new Map<string, number>();
      /** What each call's arrival at the network showed — judged once its record says how it was bound. */
      const arrivals = new Map<
        number,
        { readonly argEpoch: number; readonly at: number; readonly sessionListed: number }
      >();
      const endpoint = fakeEndpoint({
        toolsFor: (session) => {
          listedAt.set(session, epoch);
          return [{ name: 'status' }];
        },
        onCall: async (session, _name, args) => {
          const n = args['n'] as number;
          if (answered.has(n))
            violations.push(`call ${n} reached the network after its caller was answered`);
          arrivals.set(n, {
            argEpoch: args['epoch'] as number,
            at: epoch,
            sessionListed: listedAt.get(session) ?? -1,
          });
          inFlight.set(session, (inFlight.get(session) ?? 0) + 1);
          await flush(1);
          inFlight.set(session, (inFlight.get(session) ?? 1) - 1);
          return { content: [{ type: 'text', text: 'ok' }] };
        },
        deleteStatus: (session) => {
          if ((inFlight.get(session) ?? 0) > 0)
            violations.push(`session ${session} ended with a call in flight`);
          return 200;
        },
      });
      const vend = stallingProvider();
      let now = 1_000_000;
      const { pool } = poolOver(endpoint, {
        ...limits,
        idleMs: 100,
        // Opens under a stalled vend are given up quickly — and stay charged.
        initTimeoutMs: 40,
        now: () => now,
        transport: () => ({
          transport: 'gateway',
          url: endpoint.url,
          credentials: vend.provider,
          service: 'orders',
          fetch: endpoint.fetch,
        }),
      });

      const identities = [
        { principal: 'alice', conversationId: 'a1' },
        { principal: 'alice', conversationId: 'a2' },
        { principal: 'alice', conversationId: 'a3' },
        { principal: 'bob', conversationId: 'b1' },
        { principal: 'carol', conversationId: 'c1' },
      ];
      const tools = new Map<number, { tool: Tool; epoch: number }>();
      const uses = new Map<number, McpClientUse[]>();
      const leases: { release(): void }[] = [];
      const calls: Promise<unknown>[] = [];
      let n = 0;

      const check = (): void => {
        const stats = pool.stats();
        if (stats.open + stats.ending > limits.maxClients + limits.maxEnding)
          violations.push('clients over budget');
        if (stats.ending > limits.maxEnding) violations.push('endings over budget');
        if (stats.operations > limits.maxOperations) violations.push('operations over budget');
        if (stats.busy < 0 || stats.idle < 0) violations.push('negative counts');
      };

      for (let step = 0; step < 50; step += 1) {
        const who = Math.floor(rand() * identities.length);
        const identity = identities[who]!;
        const action = pickOf([
          'acquire',
          'release',
          'list',
          'call',
          'call',
          'stall',
          'unstall',
          'sweep',
          'terminate',
          'invalidate',
        ] as const);
        switch (action) {
          case 'acquire': {
            // A caller with a deadline of its own, as a real one has.
            const lease = await pool
              .acquire(identity, { signal: AbortSignal.timeout(40) })
              .catch(() => undefined);
            if (lease !== undefined) leases.push(lease);
            break;
          }
          case 'release':
            if (leases.length > 0) {
              const lease = leases.splice(Math.floor(rand() * leases.length), 1)[0]!;
              lease.release();
              lease.release(); // twice is one release
            }
            break;
          case 'list': {
            const listed = await pool
              .toolProvider()
              .list({
                iteration: 1,
                callerIdentity: identity,
                signal: AbortSignal.timeout(40),
              } as ToolDispatchContext)
              .catch(() => undefined);
            if (listed?.[0] !== undefined) tools.set(who, { tool: listed[0], epoch });
            break;
          }
          case 'call': {
            const bound = tools.get(who);
            if (bound === undefined) break;
            const caller = new AbortController();
            const id = (n += 1);
            const filed: McpClientUse[] = [];
            uses.set(id, filed);
            const call = bound.tool
              .execute({ n: id, epoch: bound.epoch }, callCtx(identity, caller.signal, filed))
              .catch(() => undefined);
            calls.push(call);
            if (chance(0.3)) {
              await flush(1);
              answered.add(id);
              caller.abort(new Error('timed out'));
            }
            break;
          }
          case 'stall':
            vend.stall();
            break;
          case 'unstall':
            vend.releaseAll();
            break;
          case 'sweep':
            now += 150;
            pool.sweep();
            break;
          case 'terminate':
            void pool.terminate({ principal: identity.principal }).catch(() => undefined);
            break;
          case 'invalidate':
            epoch += 1;
            pool.toolsChanged();
            break;
        }
        await flush(2);
        check();
      }

      // Everything let go: every charge settles, and every lease is released.
      vend.releaseAll();
      for (const lease of leases.splice(0)) lease.release();
      await Promise.all(calls);
      const closing = pool.close();
      vend.releaseAll();
      await closing;
      await pool.settled();
      check();
      expect(pool.stats()).toMatchObject({ operations: 0, ending: 0, open: 0, busy: 0 });
      // No tools/call reached the network under a binding that was stale when it
      // was sent: a call the pool revalidated on a replacement ran under that
      // client's fresh list, which must have been taken since the last
      // invalidation; any other call, under the list it was handed.
      for (const [n, arrival] of arrivals) {
        const revalidated = uses.get(n)?.[0]?.revalidated === 'kept';
        const current = revalidated
          ? arrival.sessionListed >= arrival.at
          : arrival.argEpoch >= arrival.at;
        if (!current) violations.push(`call ${n} reached the network under a stale binding`);
      }
      expect(violations).toEqual([]);
    },
    20_000,
  );
});

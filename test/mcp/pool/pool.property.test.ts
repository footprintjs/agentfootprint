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
 *      Some seeds give every client an SDK transport whose `send` cannot be
 *      watched: then nothing at all reaches the network.
 *   3. Over random interleavings of racing arrivals (a second key admitted in
 *      the microtasks between an open settling and its caller resuming), lost
 *      handles, local closes that hang, policy versions that move, terminates,
 *      idle sweeps — and a close that lands in the middle of an acquire:
 *        - a lease an acquire returned holds its client: its tools need no room
 *          and open nothing;
 *        - no more local closes run at once than `maxEnding`, and `settled()`
 *          never resolves while one runs;
 *        - a tool the current policy version does not list never runs;
 *        - an acquire still waiting when the pool closes never returns a lease;
 *        - every client that opened is closed exactly once, and every charge
 *          settles.
 */

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { OpenedClient } from '../../../src/mcp/pool/plan.js';
import { mcpClientPool, PoolFullError } from '../../../src/tool-providers/index.js';
import { LocalSessionHandleLostError } from '../../../src/index.js';
import type { McpClientUse } from '../../../src/tools/mcpClientUse.js';
import type { Tool } from '../../../src/tools/tools.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, poolOver, stallingProvider } from './harness.js';
import { confirmedEnding, heldCloses, NO_NETWORK, stubClient } from './stubClient.js';

/** The SDK's own transport, its `send` made a fixed property: nothing can watch it. */
class FixedSendTransport extends StreamableHTTPClientTransport {
  constructor(...args: ConstructorParameters<typeof StreamableHTTPClientTransport>) {
    super(...args);
    Object.defineProperty(this, 'send', {
      value: this.send.bind(this),
      configurable: false,
      writable: false,
    });
  }
}

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
      /** Each principal's invalidation count: `toolsChanged` moves them all, `permissionsChanged` one. */
      const epochs = new Map<string, number>();
      const epochOf = (principal: string): number => epochs.get(principal) ?? 0;
      /** Which principal's client opened each session. */
      const owner = new Map<string, string>();
      // Some seeds: an SDK transport whose `send` the pool cannot watch.
      const unwatchable = rand() < 0.25;

      /** The epoch each session's tool list was last taken at, by the network's clock. */
      const listedAt = new Map<string, number>();
      /** What each call's arrival at the network showed — judged once its record says how it was bound. */
      const arrivals = new Map<
        number,
        { readonly argEpoch: number; readonly at: number; readonly sessionListed: number }
      >();
      const endpoint = fakeEndpoint({
        toolsFor: (session) => {
          listedAt.set(session, epochOf(owner.get(session) ?? ''));
          return [{ name: 'status' }];
        },
        onCall: async (session, _name, args) => {
          const n = args['n'] as number;
          if (answered.has(n))
            violations.push(`call ${n} reached the network after its caller was answered`);
          arrivals.set(n, {
            argEpoch: args['epoch'] as number,
            at: epochOf(args['principal'] as string),
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
        ...(unwatchable && { sdk: { Client, StreamableHTTPClientTransport: FixedSendTransport } }),
        transport: (identity) => ({
          transport: 'gateway',
          url: endpoint.url,
          credentials: vend.provider,
          service: 'orders',
          // Learn which principal each session belongs to, from its initialize answer.
          fetch: async (input: string | URL | Request, init?: RequestInit) => {
            const response = await endpoint.fetch(input, init);
            const session = response.headers.get('mcp-session-id');
            if (session !== null) owner.set(session, identity.principal ?? '');
            return response;
          },
        }),
      });

      const identities = [
        { principal: 'alice', conversationId: 'a1' },
        { principal: 'alice', conversationId: 'a2' },
        { principal: 'alice', conversationId: 'a3' },
        { principal: 'bob', conversationId: 'b1' },
        { principal: 'carol', conversationId: 'c1' },
      ];
      const tools = new Map<number, { tool: Tool; epoch: number; principal: string }>();
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
          'permissions',
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
            if (listed?.[0] !== undefined) {
              tools.set(who, {
                tool: listed[0],
                epoch: epochOf(identity.principal),
                principal: identity.principal,
              });
            }
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
              .execute(
                { n: id, epoch: bound.epoch, principal: bound.principal },
                callCtx(identity, caller.signal, filed),
              )
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
            for (const { principal } of identities) epochs.set(principal, epochOf(principal) + 1);
            pool.toolsChanged();
            break;
          case 'permissions':
            epochs.set(identity.principal, epochOf(identity.principal) + 1);
            pool.permissionsChanged({ principal: identity.principal });
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
      // A transport the pool cannot watch is never opened: nothing reached the network.
      if (unwatchable && endpoint.requests.length > 0) {
        violations.push(`${endpoint.requests.length} request(s) reached the network unwatched`);
      }
      expect(violations).toEqual([]);
    },
    20_000,
  );
});

describe('property: racing arrivals, a closing pool, lost handles, hanging closes and policy versions', () => {
  it.each(SEEDS)(
    'seed %i',
    async (seed) => {
      const rand = rng(seed);
      const chance = (p: number) => rand() < p;
      const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

      const limits = {
        maxClients: pickOf([1, 2]),
        maxClientsPerPrincipal: 2,
        maxEnding: pickOf([1, 2]),
        maxOperations: pickOf([3, 4, 6]),
      };
      const violations: string[] = [];
      const policy = { version: 1 };
      const closes = heldCloses();
      let losing = false;
      let opened = 0;
      let openCalls = 0;
      const pending: Array<{ resolve(): void; reject(): void }> = [];
      let now = 1_000_000;
      const pool = mcpClientPool({
        name: 'race',
        transport: NO_NETWORK,
        ...limits,
        idleMs: 100,
        now: () => now,
        definitions: {
          share: () => ({ configuration: 'srv', authorization: `role@policy-${policy.version}` }),
        },
        _open: () => {
          openCalls += 1;
          const name = `c${openCalls}`;
          return new Promise<OpenedClient>((resolve, reject) => {
            pending.push({
              resolve: () => {
                opened += 1;
                resolve(
                  stubClient(name, {
                    tools: () => (policy.version === 1 ? ['status', 'refund'] : ['status']),
                    call: async (tool) => {
                      if (losing) throw new LocalSessionHandleLostError();
                      if (tool === 'refund' && policy.version !== 1) {
                        violations.push(`refund ran under policy ${policy.version}`);
                      }
                      return `${tool}@${name}`;
                    },
                    close: closes.close,
                    end: confirmedEnding(closes.close, 30),
                  }),
                );
              },
              reject: () => reject(new Error('the server refused the connection')),
            });
          });
        },
      });

      /** Settle every open waiting now — a few refused. */
      const settleOpens = (): void => {
        for (const open of pending.splice(0)) {
          if (chance(0.1)) open.reject();
          else open.resolve();
        }
      };
      /** Drive `work` to its end, settling the opens it waits for. */
      const finish = async <T>(work: Promise<T>): Promise<T> => {
        let done = false;
        void work.then(
          () => (done = true),
          () => (done = true),
        );
        for (let i = 0; i < 40 && !done; i += 1) {
          settleOpens();
          await flush(1);
        }
        return work;
      };
      const check = async (): Promise<void> => {
        const stats = pool.stats();
        if (stats.open + stats.ending > limits.maxClients + limits.maxEnding)
          violations.push('clients over budget');
        if (stats.ending > limits.maxEnding) violations.push('endings over budget');
        if (stats.operations > limits.maxOperations) violations.push('operations over budget');
        if (closes.running > limits.maxEnding) {
          violations.push(`${closes.running} local closes ran at once`);
        }
        if (closes.running > 0) {
          let settled = false;
          void pool.settled().then(() => (settled = true));
          await flush(1);
          if (settled) violations.push('settled() resolved while a local close ran');
        }
      };

      const identities = [
        { principal: 'alice', conversationId: 'a1' },
        { principal: 'alice', conversationId: 'a2' },
        { principal: 'bob', conversationId: 'b1' },
        { principal: 'carol', conversationId: 'c1' },
      ];
      const listCtx = (identity: (typeof identities)[number]): ToolDispatchContext =>
        ({ iteration: 1, callerIdentity: identity } as ToolDispatchContext);
      const bound = new Map<number, readonly Tool[]>();

      for (let step = 0; step < 40; step += 1) {
        const who = Math.floor(rand() * identities.length);
        const identity = identities[who]!;
        const action = pickOf([
          'race',
          'race',
          'list',
          'call',
          'call',
          'lose',
          'version',
          'release-close',
          'terminate',
          'sweep',
        ] as const);
        switch (action) {
          case 'race': {
            // A second key arrives in the microtasks between the first key's
            // open settling and its caller resuming.
            const other = identities[(who + 1 + Math.floor(rand() * 3)) % identities.length]!;
            const first = pool.acquire(identity).then(
              (lease) => ({ lease }),
              () => ({}),
            );
            for (const open of pending.splice(0)) open.resolve();
            const gap = Math.floor(rand() * 4);
            for (let i = 0; i < gap; i += 1) await Promise.resolve();
            const second = pool.acquire(other).then(
              (lease) => ({ lease }),
              () => ({}),
            );
            const outcomes = await Promise.all([finish(first), finish(second)]);
            for (const outcome of outcomes) {
              if (!('lease' in outcome)) continue;
              const before = openCalls;
              const listed = await finish(outcome.lease.tools()).catch((error: unknown) => error);
              if (listed instanceof PoolFullError && listed.limit !== 'operations') {
                violations.push(`a held lease needed room (${listed.limit})`);
              }
              if (openCalls !== before) violations.push('a held lease opened another client');
              outcome.lease.release();
            }
            break;
          }
          case 'list': {
            const listed = await finish(pool.toolProvider().list(listCtx(identity))).catch(
              () => undefined,
            );
            if (listed !== undefined) bound.set(who, listed);
            break;
          }
          case 'call': {
            const tools = bound.get(who);
            if (tools === undefined || tools.length === 0) break;
            const tool = pickOf(tools);
            await finish(tool.execute({}, callCtx(identity))).catch(() => undefined);
            break;
          }
          case 'lose': {
            const listed = await finish(pool.toolProvider().list(listCtx(identity))).catch(
              () => undefined,
            );
            const tool = listed?.[0];
            if (tool === undefined) break;
            losing = true;
            await finish(tool.execute({}, callCtx(identity))).catch(() => undefined);
            losing = false;
            break;
          }
          case 'version':
            if (policy.version < 3) policy.version += 1;
            break;
          case 'release-close':
            closes.releaseOne();
            break;
          case 'terminate':
            void pool.terminate({ principal: identity.principal }).catch(() => undefined);
            break;
          case 'sweep':
            now += 150;
            pool.sweep();
            break;
        }
        await flush(2);
        await check();
      }

      // A close that lands in the middle of an acquire on a warm client.
      const warmId = pickOf(identities);
      const warm = await finish(pool.acquire(warmId)).catch(() => undefined);
      warm?.release();
      const late = pool.acquire(warmId).then(
        (lease) => ({ lease }),
        () => ({}),
      );
      const closing = pool.close();
      const outcome = await finish(late);
      if ('lease' in outcome) {
        violations.push('an acquire returned a lease after the pool closed');
        outcome.lease.release();
      }
      let closed = false;
      void closing.then(() => (closed = true));
      for (let i = 0; i < 200 && !closed; i += 1) {
        closes.releaseAll();
        settleOpens();
        await flush(1);
      }
      for (let i = 0; i < 50 && (closes.running > 0 || pending.length > 0); i += 1) {
        closes.releaseAll();
        settleOpens();
        await flush(1);
      }
      await finish(pool.settled());
      expect(closed).toBe(true);
      expect(pool.stats()).toMatchObject({ open: 0, ending: 0, operations: 0, busy: 0 });
      // Every client that opened was closed exactly once.
      if (closes.started !== opened) {
        violations.push(`${opened} client(s) opened, ${closes.started} closed`);
      }
      expect(violations).toEqual([]);
    },
    20_000,
  );
});

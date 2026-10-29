/**
 * Churn (§ 5.3, § 7): `maxClients: 1`, `maxEnding: 1`, and a hundred short
 * conversations whose endings are fast, slow (past the local wait), failing
 * (500 and 403), 405, stalled in a credential provider that never answers until
 * released, and sent through an app `fetch` that ignores its abort.
 *
 * At every transition: at most two clients held and at most one ending charged,
 * settled or not. While a hung ending holds its slot, every arrival that needs
 * room is refused (`limit: 'ending'`) and `stats().unsettled` shows the charge;
 * the ending still answers by its deadline (`timed-out`). A late credential
 * sends nothing; the slot frees only at settlement, and that is reported.
 * `unresolvedEndings` counts exactly the endings that were not confirmed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PoolFullError } from '../../../src/tool-providers/index.js';
import type { McpTransport } from '../../../src/mcp/types.js';
import { TOOL_TEARDOWN_TIMEOUT_MS } from '../../../src/tools/toolSessions.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { flush, id, poolOver, stallingProvider } from './harness.js';

afterEach(() => {
  vi.useRealTimers();
});

const KINDS = [
  'fast',
  'slow',
  'fail500',
  'fail403',
  'not-offered',
  'stalled',
  'abort-ignoring',
] as const;
type Kind = (typeof KINDS)[number];

describe('churn: a hundred short conversations through one client slot and one ending slot', () => {
  it('holds at most two clients and one ending; refuses room while a hung ending holds its slot; sends nothing late; counts exactly the unresolved endings', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const endpoint = fakeEndpoint();
    const kindOf = (conversation: string): Kind =>
      KINDS[Number(conversation.slice(1)) % KINDS.length]!;
    const vends = new Map<string, ReturnType<typeof stallingProvider>>();
    const ignoring: Array<() => void> = [];
    // The moment any ending's deadline passed: no request may reach the network after it.
    let lastDeadlineAt = -1;

    const deleteFor = (kind: Kind) => async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'DELETE') return endpoint.fetch(input, init);
      switch (kind) {
        case 'slow':
          // Honours its abort: it would take longer than the local wait.
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          });
        case 'fail500':
          return new Response('boom', { status: 500 });
        case 'fail403':
          return new Response('nope', { status: 403 });
        case 'not-offered':
          return new Response(null, { status: 405 });
        case 'abort-ignoring':
          // Ignores its abort; gives up only when released — and never forwards.
          return new Promise<Response>((_resolve, reject) => {
            ignoring.push(() => reject(new TypeError('the app fetch gave up')));
          });
        default:
          return endpoint.fetch(input, init);
      }
    };

    const { pool, reports } = poolOver(endpoint, {
      maxClients: 1,
      maxEnding: 1,
      transport: (identity): McpTransport => {
        const kind = kindOf(identity.conversationId);
        if (kind === 'stalled') {
          const vend = stallingProvider();
          vends.set(identity.conversationId, vend);
          return {
            transport: 'gateway',
            url: endpoint.url,
            credentials: vend.provider,
            service: 'orders',
            fetch: endpoint.fetch,
          };
        }
        return { transport: 'http', url: endpoint.url, fetch: deleteFor(kind) };
      },
    });

    const invariant = (): void => {
      const stats = pool.stats();
      expect(stats.open + stats.ending).toBeLessThanOrEqual(2);
      expect(stats.ending).toBeLessThanOrEqual(1);
    };
    const networkSince = (seq: number) => endpoint.requests.filter((r) => r.seq > seq);

    let refusals = 0;
    let stillCharged = 0;
    for (let i = 0; i < 100; i += 1) {
      const conversation = `c${i}`;
      for (;;) {
        invariant();
        const outcome = await pool.acquire(id(`p${i}`, conversation)).catch((e: unknown) => e);
        invariant();
        if (!(outcome instanceof Error)) {
          (outcome as { release(): void }).release();
          break;
        }
        expect(outcome).toBeInstanceOf(PoolFullError);
        expect(outcome).toMatchObject({ limit: 'ending' });
        refusals += 1;
        // A hung ending holds the slot. Past its deadline it has its answer, and
        // is still charged until its work settles.
        const deadline = endpoint.requests.at(-1)?.seq ?? 0;
        await vi.advanceTimersByTimeAsync(TOOL_TEARDOWN_TIMEOUT_MS);
        await flush();
        invariant();
        lastDeadlineAt = Math.max(lastDeadlineAt, deadline);
        if (pool.stats().ending === 1) {
          stillCharged += 1;
          expect(pool.stats().unsettled.ending).toBe(1);
          const again = await pool.acquire(id(`p${i}`, conversation)).catch((e: unknown) => e);
          expect(again).toMatchObject({ limit: 'ending' });
          refusals += 1;
          // Released after its deadline: the stalled provider's late credential,
          // or the abort-ignoring fetch giving up.
          for (const vend of vends.values()) vend.releaseAll();
          for (const release of ignoring.splice(0)) release();
          await flush(10);
          invariant();
        }
      }
      // A conversation's client stays until the next arrival evicts it; a
      // stalled-vend client's ending vend stalls from here.
      vends.get(conversation)?.stall();
    }
    // Ending the last one.
    const closing = pool.close();
    await vi.advanceTimersByTimeAsync(TOOL_TEARDOWN_TIMEOUT_MS * 2);
    for (const vend of vends.values()) vend.releaseAll();
    for (const release of ignoring.splice(0)) release();
    await closing;
    await pool.settled();
    invariant();

    // Nothing reached the network after any ending's deadline: a slow, stalled
    // or abort-ignoring ending never sent its DELETE — not even once its late
    // credential arrived — and the failing ones were answered before the network.
    // Only the fast endings' DELETEs ever reached it.
    const kinds = Array.from({ length: 100 }, (_, i) => kindOf(`c${i}`));
    const deletes = endpoint.requests.filter((r) => r.method === 'DELETE');
    expect(deletes).toHaveLength(kinds.filter((kind) => kind === 'fast').length);
    expect(
      networkSince(lastDeadlineAt).filter((r) => r.method === 'DELETE').length,
    ).toBeLessThanOrEqual(deletes.length);
    expect(refusals).toBeGreaterThan(0);

    const ended = reports.filter((r) => r.kind === 'ended');
    expect(ended).toHaveLength(100);
    const unresolvedKinds = kinds.filter((kind) => kind !== 'fast').length;
    expect(pool.stats().unresolvedEndings).toBe(unresolvedKinds);
    expect(ended.filter((r) => r.resolved === false)).toHaveLength(unresolvedKinds);
    // Answered by the deadline: every slow, stalled and abort-ignoring ending.
    expect(ended.filter((r) => r.remote === 'timed-out')).toHaveLength(
      kinds.filter((k) => k === 'slow' || k === 'stalled' || k === 'abort-ignoring').length,
    );
    expect(ended.filter((r) => r.remote === 'failed')).toHaveLength(
      kinds.filter((k) => k === 'fail500' || k === 'fail403').length,
    );
    expect(ended.filter((r) => r.remote === 'not-offered')).toHaveLength(
      kinds.filter((k) => k === 'not-offered').length,
    );
    // Past their deadline the stalled and abort-ignoring endings stayed charged.
    expect(stillCharged).toBe(
      kinds.filter((k) => k === 'stalled' || k === 'abort-ignoring').length,
    );
    // Each hung ending's late settlement was reported.
    expect(reports.some((r) => r.kind === 'settled-late' && r.work === 'ending')).toBe(true);
    expect(pool.stats()).toMatchObject({ open: 0, ending: 0, operations: 0 });
  });
});

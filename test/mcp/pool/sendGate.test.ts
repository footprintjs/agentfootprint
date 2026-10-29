/**
 * The send gate's boundaries (§ 6.3), each pinned on its own:
 *
 *   - the watched `send` — the last boundary on a transport whose `send` writes
 *     without waiting (stdio): a pooled call's gate refuses there and nothing
 *     reaches the transport;
 *   - the pool's own fetch — the first boundary on HTTP: a refusal there hands
 *     nothing to the transport's fetch;
 *   - every guard's count: work it was handed stays counted until it settles.
 */

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { RequestLedger } from '../../../src/mcp/requestLedger.js';
import { CALL_MARKER_KEY, markParams } from '../../../src/mcp/callMarker.js';
import type { PooledClientSeam } from '../../../src/mcp/clientPort.js';
import type { RequestGuard } from '../../../src/mcp/requestGuard.js';
import { openPooledClient } from '../../../src/mcp/mcpClient.js';
import {
  ledgeredFetch,
  retryingFetch,
  type ThrottleFetch,
} from '../../../src/mcp/throttleRetry.js';
import type { McpClientOptions, McpSdk } from '../../../src/mcp/types.js';
import type { RequestEvidence } from '../../../src/tools/requestEvidence.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, id, poolOver, stallingProvider } from './harness.js';

const listCtx = (identity: ReturnType<typeof id>): ToolDispatchContext =>
  ({ iteration: 1, callerIdentity: identity } as ToolDispatchContext);

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

/** The SDK's own client, rebuilding a tool call's params without their `_meta`. */
class RebuildingClient extends Client {
  override callTool(...args: Parameters<Client['callTool']>): ReturnType<Client['callTool']> {
    const [params, ...rest] = args;
    const rebuilt = Object.fromEntries(Object.entries(params).filter(([key]) => key !== '_meta'));
    return super.callTool(rebuilt as typeof params, ...rest);
  }
}

/** A guard whose check refuses with `refusal`, counting what it was handed. */
function refusingGuard(refusal: Error): RequestGuard & { tracked: number } {
  return {
    tracked: 0,
    check: () => {
      throw refusal;
    },
    track(): void {
      this.tracked += 1;
    },
  };
}

describe('the watched send: the last boundary on a transport that writes without waiting', () => {
  it("a pooled call's gate refuses at send(): the transport's own send is never reached", async () => {
    const sent: unknown[] = [];
    const transport = { send: async (message: unknown) => void sent.push(message) };
    const ledger = new RequestLedger({ server: 'orders', strict: false });
    ledger.watch(transport);
    const refusal = new Error('stale binding');
    const issued = ledger.issue(undefined, refusingGuard(refusal));
    const request = {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'status', arguments: {}, _meta: { [CALL_MARKER_KEY]: issued.marker } },
    };
    await expect(transport.send(request)).rejects.toBe(refusal);
    expect(sent).toEqual([]);
    expect(ledger.toolCallsSent).toBe(0);
  });

  it('a request that is not a pooled call is refused by the pool’s phase guard; a notification never is', async () => {
    const sent: unknown[] = [];
    const transport = { send: async (message: unknown) => void sent.push(message) };
    const guard = refusingGuard(new Error('the open ran out of time'));
    const ledger = new RequestLedger({ server: 'orders', strict: false, guardFor: () => guard });
    ledger.watch(transport);
    await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).rejects.toThrow(
      'the open ran out of time',
    );
    await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(sent).toEqual([{ jsonrpc: '2.0', method: 'notifications/initialized' }]);
    expect(guard.tracked).toBe(1);
  });
});

describe("the pool's own fetch: the first boundary on HTTP", () => {
  it('a refused request is never handed to the transport’s fetch', async () => {
    const endpoint = fakeEndpoint();
    let seam: PooledClientSeam | undefined;
    const { pool } = poolOver(endpoint, {
      _open: (options: McpClientOptions, given: PooledClientSeam) => {
        seam = given;
        return openPooledClient(options, given);
      },
    });
    (await pool.acquire(id('alice', 'c1'))).release();
    const handed: unknown[] = [];
    const inner = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      handed.push([input, init]);
      return new Response('{}');
    };
    const refusal = new Error('stale binding');
    const fetch = seam!.wrapFetch(inner, () => refusingGuard(refusal));
    const body = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {} });
    await expect(fetch('https://orders.example.test/mcp', { method: 'POST', body })).rejects.toBe(
      refusal,
    );
    expect(handed).toEqual([]);
  });

  it('the client’s own stream (a GET) and a notification pass untouched — never refused, never cut', async () => {
    const endpoint = fakeEndpoint();
    let seam: PooledClientSeam | undefined;
    const { pool } = poolOver(endpoint, {
      _open: (options: McpClientOptions, given: PooledClientSeam) => {
        seam = given;
        return openPooledClient(options, given);
      },
    });
    (await pool.acquire(id('alice', 'c1'))).release();
    const handed: (RequestInit | undefined)[] = [];
    const inner = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      handed.push(init);
      return new Response(null, { status: 202 });
    };
    const fetch = seam!.wrapFetch(inner, () => refusingGuard(new Error('never asked')));
    const get: RequestInit = { method: 'GET' };
    const notice: RequestInit = {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }),
    };
    await fetch('https://orders.example.test/mcp', get);
    await fetch('https://orders.example.test/mcp', notice);
    expect(handed).toEqual([get, notice]);
  });
});

describe('a pooled call is sent only through a guard that can refuse it', () => {
  /** List, stall the credential vend, call, change permissions, release the credential. */
  async function staleDuringVend(sdk: McpSdk) {
    const endpoint = fakeEndpoint();
    const vend = stallingProvider();
    const { pool } = poolOver(endpoint, {
      sdk,
      transport: () => ({
        transport: 'gateway',
        url: endpoint.url,
        service: 'orders',
        fetch: endpoint.fetch,
        credentials: vend.provider,
      }),
    });
    const alice = id('alice', 'a');
    const listed = await pool
      .toolProvider()
      .list(listCtx(alice))
      .catch((error: unknown) => error);
    if (listed instanceof Error) return { listed, endpoint, pool };
    const [status] = listed;
    vend.stall();
    const call = status!.execute({}, callCtx(alice)).catch((error: unknown) => error);
    await flush();
    pool.permissionsChanged({ principal: 'alice' });
    vend.releaseAll();
    return { outcome: await call, endpoint, pool };
  }

  it('the control — a transport the pool can watch: the stale call is refused once its credential arrives, nothing sent', async () => {
    const { outcome, endpoint, pool } = await staleDuringVend({
      Client,
      StreamableHTTPClientTransport,
    });
    expect(outcome).toMatchObject({ name: 'McpPoolRefusedError', reason: 'stale-tools' });
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/call')).toHaveLength(0);
    await pool.close();
  });

  it('a transport whose `send` cannot be watched is never opened by a pool: refused (init-failed, the reason as cause) before anything reaches the network', async () => {
    const { listed, outcome, endpoint, pool } = await staleDuringVend({
      Client,
      StreamableHTTPClientTransport: FixedSendTransport,
    });
    expect(outcome).toBeUndefined();
    expect(listed).toMatchObject({ name: 'McpPoolRefusedError', reason: 'init-failed' });
    expect(String((listed as Error).cause)).toMatch(/send/);
    expect(endpoint.requests).toEqual([]);
    await pool.close();
  });

  it('a tool call that reaches `send` without its call (an SDK that rebuilt the params) is refused there, under the default policy — nothing sent', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, {
      sdk: { Client: RebuildingClient, StreamableHTTPClientTransport },
    });
    const alice = id('alice', 'a');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    await expect(status!.execute({}, callCtx(alice))).rejects.toMatchObject({
      name: 'McpPoolRefusedError',
      reason: 'request-unmatched',
      sent: false,
    });
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/call')).toHaveLength(0);
    await pool.close();
  });

  it('a tool call without its call is refused even while a listing runs on its client — it never borrows the listing’s guard', async () => {
    const endpoint = fakeEndpoint();
    let now = 1_000_000;
    const { pool } = poolOver(endpoint, {
      sdk: { Client: RebuildingClient, StreamableHTTPClientTransport },
      definitionTtlMs: 1_000,
      now: () => now,
    });
    const alice = id('alice', 'a');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    // The list's time limit lapses: the next listing lists again on the same
    // client, and its tools/list is held at the network while the call is made.
    now += 5_000;
    const held = endpoint.hold((r) => r.rpc === 'tools/list');
    const relisting = pool.toolProvider().list(listCtx(alice));
    await flush();
    expect(held.held).toBe(1);
    await expect(status!.execute({}, callCtx(alice))).rejects.toMatchObject({
      name: 'McpPoolRefusedError',
      reason: 'request-unmatched',
    });
    held.release();
    await relisting;
    expect(endpoint.requests.filter((r) => r.rpc === 'tools/call')).toHaveLength(0);
    await pool.close();
  });

  it("the pool's fetch refuses a request no guard covers; an answer to the server and a notification pass untouched", async () => {
    const endpoint = fakeEndpoint();
    let seam: PooledClientSeam | undefined;
    const { pool } = poolOver(endpoint, {
      _open: (options: McpClientOptions, given: PooledClientSeam) => {
        seam = given;
        return openPooledClient(options, given);
      },
    });
    (await pool.acquire(id('alice', 'c1'))).release();
    const handed: (RequestInit | undefined)[] = [];
    const inner = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      handed.push(init);
      return new Response(null, { status: 202 });
    };
    // No call claims it, and the idle client has no open, listing or ending under way.
    const fetch = seam!.wrapFetch(inner, () => undefined);
    const url = 'https://orders.example.test/mcp';
    const request = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} });
    await expect(fetch(url, { method: 'POST', body: request })).rejects.toMatchObject({
      name: 'McpPoolRefusedError',
      reason: 'request-unmatched',
    });
    await expect(fetch(url, { method: 'DELETE' })).rejects.toMatchObject({
      reason: 'request-unmatched',
    });
    const answer: RequestInit = {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} }),
    };
    const notice: RequestInit = {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} }),
    };
    await fetch(url, answer);
    await fetch(url, notice);
    expect(handed).toEqual([answer, notice]);
    await pool.close();
  });
});

describe('a gate stop before a retry is a decision, never a sent attempt', () => {
  it.each([
    ['while the attempt is out', 'out'],
    ['during the wait before the retry', 'wait'],
  ] as const)(
    'the binding goes stale %s: the series ends on the last answer the server sent, and its record holds that one sent attempt and the stop',
    async (_when, when) => {
      let sent = 0;
      let stale = false;
      const ledger = new RequestLedger({ server: 'orders', strict: false });
      const series = ledgeredFetch(
        retryingFetch(
          async () => {
            sent += 1;
            if (when === 'out') stale = true;
            return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
          },
          {
            baseDelayMs: 1,
            onRetry: () => {
              if (when === 'wait') stale = true;
            },
          },
        ) as ThrottleFetch,
        ledger,
      ) as ThrottleFetch;
      const transport = ledger.watch({
        send: async (message: unknown): Promise<unknown> =>
          series('https://orders.example.test/mcp', {
            method: 'POST',
            body: JSON.stringify(message),
          }),
      });
      const guard: RequestGuard = {
        check: () => {
          if (stale) throw new Error('stale binding');
        },
        track: () => undefined,
      };
      const filed: RequestEvidence[] = [];
      const issued = ledger.issue({ sink: { file: (evidence) => filed.push(evidence) } }, guard);
      const params = markParams({ name: 'refund', arguments: {} }, issued.marker);
      const response = (await transport!.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params,
      })) as Response;
      // The caller hears the last answer the server really sent.
      expect(response.status).toBe(429);
      expect(sent).toBe(1);
      ledger.settle(issued);
      await flush();
      // One sent attempt, then the stop — no row for an attempt that never left.
      expect(filed).toHaveLength(1);
      expect(filed[0]!.attempts).toHaveLength(1);
      expect(filed[0]!.attempts[0]).toMatchObject({ attempt: 1, status: 429 });
      expect(filed[0]!.end).toMatchObject({
        outcome: 'refused',
        reason: 'not-permitted',
        status: 429,
        attempts: 1,
      });
    },
  );
});

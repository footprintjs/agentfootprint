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

import { RequestLedger } from '../../../src/mcp/requestLedger.js';
import { CALL_MARKER_KEY } from '../../../src/mcp/callMarker.js';
import type { PooledClientSeam } from '../../../src/mcp/clientPort.js';
import type { RequestGuard } from '../../../src/mcp/requestGuard.js';
import { openPooledClient } from '../../../src/mcp/mcpClient.js';
import type { McpClientOptions } from '../../../src/mcp/types.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { id, poolOver } from './harness.js';

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

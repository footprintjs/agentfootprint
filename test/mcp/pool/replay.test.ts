/**
 * The app's replay declaration (`McpClientOptions.replay`) reaches every client
 * the pool opens: who may send a tool call again is the app's, on a pooled
 * client as on a standalone one. The default stays `'compatibility'`. The
 * pool's own send gate is not the declaration's: a pooled request it cannot
 * check is refused under either policy (`sendGate.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { mcpClientPool } from '../../../src/tool-providers/index.js';
import type { McpReplayOptions } from '../../../src/mcp/replay.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import { fakeEndpoint, type FakeEndpoint } from './fakeEndpoint.js';
import { callCtx, id, poolOver } from './harness.js';

const alice = id('alice', 'a');
const listCtx: ToolDispatchContext = {
  iteration: 1,
  callerIdentity: alice,
} as ToolDispatchContext;
const callsOf = (endpoint: FakeEndpoint) => endpoint.requests.filter((r) => r.rpc === 'tools/call');

/**
 * The SDK's own client, connecting as an older SDK did: it replaces the
 * transport's message handler instead of keeping it, so the library never
 * sees an answer arrive.
 */
class ReplacingClient extends Client {
  override async connect(...args: Parameters<Client['connect']>): Promise<void> {
    const [transport] = args;
    transport.onmessage = undefined;
    return super.connect(...args);
  }
}

/** An app fetch that throttles the first tool call once, then lets everything through. */
function throttledOnce(endpoint: FakeEndpoint) {
  let throttled = false;
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    if (!throttled && typeof init?.body === 'string' && init.body.includes('"tools/call"')) {
      throttled = true;
      await endpoint.fetch(input, init); // it reached the network
      return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
    }
    return endpoint.fetch(input, init);
  };
}

describe('the replay declaration reaches every pooled client', () => {
  it("'app-authorized' is the pooled client's policy: a connection whose answers it cannot see refuses the call before sending", async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, {
      sdk: { Client: ReplacingClient, StreamableHTTPClientTransport },
      replay: { policy: 'app-authorized' },
    });
    const [status] = await pool.toolProvider().list(listCtx);
    await expect(status!.execute({}, callCtx(alice))).rejects.toMatchObject({
      name: 'McpReplayUnavailableError',
      reason: 'answers-unobserved',
      sent: false,
    });
    expect(callsOf(endpoint)).toHaveLength(0);
    await pool.close();
  });

  it("the default stays 'compatibility': the same connection runs the call", async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, {
      sdk: { Client: ReplacingClient, StreamableHTTPClientTransport },
    });
    const [status] = await pool.toolProvider().list(listCtx);
    await expect(status!.execute({}, callCtx(alice))).resolves.toContain('status@');
    expect(callsOf(endpoint)).toHaveLength(1);
    await pool.close();
  });

  it.each([
    ['declared for throttle: asked again, and it runs', { status: { on: ['throttle'] } }, 2],
    ['not declared: never asked again — the 429 is the answer', {}, 1],
  ] as const)("'app-authorized' with a tool %s", async (_what, tools, expected) => {
    const endpoint = fakeEndpoint();
    const replay = { policy: 'app-authorized', tools } as McpReplayOptions;
    const { pool } = poolOver(endpoint, {
      transport: () => ({ transport: 'http', url: endpoint.url, fetch: throttledOnce(endpoint) }),
      retryOnThrottle: { baseDelayMs: 1 },
      replay,
    });
    const [status] = await pool.toolProvider().list(listCtx);
    const outcome = await status!.execute({}, callCtx(alice)).catch((error: unknown) => error);
    expect(callsOf(endpoint)).toHaveLength(expected);
    if (expected === 2) expect(outcome).toContain('status@');
    else expect(outcome).toBeInstanceOf(Error);
    await pool.close();
  });

  it('a declaration the client would refuse is refused when the pool is built, by name', () => {
    const endpoint = fakeEndpoint();
    expect(() =>
      mcpClientPool({
        name: 'orders',
        transport: { transport: 'http', url: endpoint.url, fetch: endpoint.fetch },
        replay: { policy: 'whenever' } as unknown as McpReplayOptions,
      }),
    ).toThrow(/replay/);
  });
});

/**
 * A server's expiry and a lost handle (§ 5.5) — two failures that arrive alike,
 * kept two. Only documented evidence raises an expiry: an MCP server's own 404
 * (a JSON-RPC error) to a request that carried the session id it issued.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { LocalSessionHandleLostError, SessionExpiredError } from '../../../src/index.js';
import { agentCoreRuntimeMcpTransport, mcpClientPool } from '../../../src/tool-providers/index.js';
import { staticTokens } from '../../../src/identity/staticTokens.js';
import type { McpTransport } from '../../../src/mcp/types.js';
import { takeListUses, type McpClientUse } from '../../../src/tools/mcpClientUse.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';
import type { Tool } from '../../../src/tools/tools.js';
import { REAL_TRANSPORT_TIMEOUT } from '../realTransportSupport.js';
import { fakeEndpoint, type FakeEndpoint } from './fakeEndpoint.js';
import { callCtx, flush, id, poolOver } from './harness.js';
import { startSessionServer, type SessionServer } from './sessionServer.js';
import { heldCloses, NO_NETWORK, stubClient } from './stubClient.js';

const ARN = 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders-a1b2c3';
const listCtx = (identity: ReturnType<typeof id>): ToolDispatchContext =>
  ({ iteration: 1, callerIdentity: identity } as ToolDispatchContext);

/** A stand-in AgentCore Runtime endpoint (the bearer HTTPS path) over `endpoint`. */
function fakePlatform(endpoint: FakeEndpoint, stop: () => Response = () => new Response('{}')) {
  const stops: (string | null)[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/stopruntimesession')) {
      stops.push(new Headers(init?.headers).get('x-amzn-bedrock-agentcore-runtime-session-id'));
      return stop();
    }
    return endpoint.fetch(input, init);
  };
  const transport = (): McpTransport =>
    agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: 'us-west-2',
      session: 'reuse',
      retry: false,
      auth: { bearer: staticTokens({ runtime: 't' }), fetch },
    });
  return { fetch, stops, transport };
}

const servers: SessionServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('(a) a lost handle is not an expiry', () => {
  it(
    'a shared reuse transport past 256 handles gives the oldest client LocalSessionHandleLostError, not SessionExpiredError; no stop is sent; one unresolved ending is counted; the next open says previous: handle-lost',
    async () => {
      const endpoint = fakeEndpoint();
      const platform = fakePlatform(endpoint);
      const shared = platform.transport();
      const { pool, reports } = poolOver(endpoint, {
        transport: shared,
        maxClients: 300,
        retryOnThrottle: false,
      });
      const oldest = id('p0', 'c0');
      const [status] = await pool.toolProvider().list(listCtx(oldest));
      for (let i = 1; i <= 256; i += 1) {
        (await pool.acquire(id(`p${i}`, `c${i}`))).release();
      }
      const uses: McpClientUse[] = [];
      const failure = await status!
        .execute({}, callCtx(oldest, undefined, uses))
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(LocalSessionHandleLostError);
      expect(failure).not.toBeInstanceOf(SessionExpiredError);
      expect(failure).toMatchObject({
        evidence: 'transport-forgot-handle',
        remote: 'unknown',
        message:
          'The session for the call this result answers could not be reached from here, so that call was not sent.',
      });
      expect(uses[0]).toMatchObject({ client: 'handle-lost', evidence: 'transport-forgot-handle' });
      expect(platform.stops).toEqual([]);
      expect(pool.stats().unresolvedEndings).toBe(1);
      expect(reports).toContainEqual(
        expect.objectContaining({
          kind: 'ended',
          reason: 'handle-lost',
          remote: 'handle-lost',
          resolved: false,
        }),
      );
      // The next use opens the next client under the SAME key, and says why.
      const again = listCtx(oldest);
      const [fresh] = await pool.toolProvider().list(again);
      expect(takeListUses(again)).toEqual([
        expect.objectContaining({ client: 'opened', previous: 'handle-lost', generation: 2 }),
      ]);
      await expect(fresh!.execute({}, callCtx(oldest))).resolves.toContain('status@');
      await pool.close();
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

describe("(a′) a lost handle's local close is work, charged like any ending until it settles", () => {
  /** A pool whose every client loses its handle at the first call, and whose closes wait until released. */
  function losingPool(limits: { maxClients: number; maxEnding: number; maxOperations: number }) {
    const closes = heldCloses();
    let opened = 0;
    const pool = mcpClientPool({
      name: 'lost-handle',
      transport: NO_NETWORK,
      ...limits,
      _open: async () => {
        opened += 1;
        return stubClient(`lost-${opened}`, {
          call: async () => {
            throw new LocalSessionHandleLostError();
          },
          close: closes.close,
        });
      },
    });
    return { pool, closes, opened: () => opened };
  }

  it('one slot each: the close holds the ending and operation slots, settled() waits for it, and the next arrival is refused at once until it settles', async () => {
    const { pool, closes, opened } = losingPool({ maxClients: 1, maxEnding: 1, maxOperations: 1 });
    const alice = id('alice', 'a');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    await expect(status!.execute({}, callCtx(alice))).rejects.toBeInstanceOf(
      LocalSessionHandleLostError,
    );
    await flush();
    expect(closes.running).toBe(1);
    expect(pool.stats()).toMatchObject({ open: 0, ending: 1, operations: 1, unresolvedEndings: 1 });
    let settled = false;
    void pool.settled().then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    // The slots are held: refused at once, and nothing opens.
    await expect(pool.toolProvider().list(listCtx(alice))).rejects.toMatchObject({
      name: 'PoolFullError',
      limit: 'operations',
    });
    expect(opened()).toBe(1);
    // The close settles: the slots free, settled() resolves, the key opens its next client.
    closes.releaseOne();
    await flush();
    expect(settled).toBe(true);
    expect(pool.stats()).toMatchObject({ open: 0, ending: 0, operations: 0 });
    await pool.toolProvider().list(listCtx(alice));
    expect(opened()).toBe(2);
    const closing = pool.close();
    await flush();
    closes.releaseAll();
    await closing;
    await pool.settled();
  });

  it('five lost handles in a row never run more local closes than maxEnding: the rest wait, counted, and every one settles before settled() resolves', async () => {
    const limits = { maxClients: 1, maxEnding: 1, maxOperations: 3 };
    const { pool, closes } = losingPool(limits);
    const alice = id('alice', 'a');
    let lost = 0;
    let refused = 0;
    for (let i = 0; i < 5; i += 1) {
      const listed = await pool
        .toolProvider()
        .list(listCtx(alice))
        .catch((error: unknown) => error);
      if (listed instanceof Error) {
        expect(listed).toMatchObject({ name: 'PoolFullError' });
        refused += 1;
      } else {
        const outcome = await (listed as readonly Tool[])[0]!
          .execute({}, callCtx(alice))
          .catch((error: unknown) => error);
        if (outcome instanceof LocalSessionHandleLostError) lost += 1;
      }
      await flush();
      expect(closes.running).toBeLessThanOrEqual(limits.maxEnding);
      const stats = pool.stats();
      expect(stats.open + stats.ending).toBeLessThanOrEqual(limits.maxClients + limits.maxEnding);
      expect(stats.operations).toBeLessThanOrEqual(limits.maxOperations);
    }
    expect(lost).toBeGreaterThanOrEqual(2);
    expect(lost + refused).toBe(5);
    let settled = false;
    void pool.settled().then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    // Release closes one at a time: the waiting ones start, never more than maxEnding at once.
    for (let i = 0; i < 10 && closes.running > 0; i += 1) {
      closes.releaseOne();
      await flush();
      expect(closes.running).toBeLessThanOrEqual(limits.maxEnding);
    }
    const closing = pool.close();
    await flush();
    closes.releaseAll();
    await closing;
    await pool.settled();
    expect(settled).toBe(true);
    expect(closes.started).toBe(lost);
    expect(pool.stats()).toMatchObject({ open: 0, ending: 0, operations: 0 });
  });
});

describe('(b) a failed stop is unresolved', () => {
  for (const [status, type] of [
    [403, 'AccessDeniedException'],
    [500, 'InternalServerException'],
  ] as const) {
    it(`StopRuntimeSession answering ${status}: failed, counted unresolved, with its class and never its message`, async () => {
      const endpoint = fakeEndpoint();
      const platform = fakePlatform(
        endpoint,
        () =>
          new Response(
            JSON.stringify({ message: `${type}: role arn:aws:iam::123:role/secret-role` }),
            {
              status,
              headers: { 'content-type': 'application/json', 'x-amzn-errortype': type },
            },
          ),
      );
      const { pool, reports } = poolOver(endpoint, { transport: platform.transport });
      (await pool.acquire(id('alice', 'c1'))).release();
      const [outcome] = await pool.terminate({ principal: 'alice', conversationId: 'c1' });
      expect(outcome).toMatchObject({ remote: 'failed', resolved: false, status });
      expect(outcome!.errorClass).toBe('StreamableHTTPError');
      expect(JSON.stringify([outcome, reports])).not.toContain('secret-role');
      expect(platform.stops).toHaveLength(1);
      expect(pool.stats().unresolvedEndings).toBe(1);
    });
  }

  it('StopRuntimeSession answering 404 ResourceNotFoundException: already-gone, resolved', async () => {
    const endpoint = fakeEndpoint();
    const platform = fakePlatform(
      endpoint,
      () =>
        new Response('{}', {
          status: 404,
          headers: {
            'content-type': 'application/json',
            'x-amzn-errortype': 'ResourceNotFoundException',
          },
        }),
    );
    const { pool } = poolOver(endpoint, { transport: platform.transport });
    (await pool.acquire(id('alice', 'c1'))).release();
    const [outcome] = await pool.terminate({ principal: 'alice', conversationId: 'c1' });
    expect(outcome).toMatchObject({ remote: 'already-gone', resolved: true, status: 404 });
    expect(pool.stats().unresolvedEndings).toBe(0);
  });
});

describe('(c) a real MCP session 404 is an expiry', () => {
  it(
    'from a real SDK server that ended a stateful session: SessionExpiredError with its evidence, then terminate(), then a new client under the same key',
    async () => {
      const server = await startSessionServer();
      servers.push(server);
      const { pool, reports } = poolOver(fakeEndpoint(), {
        transport: () => ({ transport: 'http', url: server.url }),
      });
      const alice = id('alice', 'c1');
      const [status] = await pool.toolProvider().list(listCtx(alice));
      await expect(status!.execute({}, callCtx(alice))).resolves.toContain('status@');
      const [ended] = server.sessions();
      server.endSession(ended!);

      const uses: McpClientUse[] = [];
      const failure = await status!
        .execute({}, callCtx(alice, undefined, uses))
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(SessionExpiredError);
      expect(failure).toMatchObject({
        evidence: 'server-404',
        message:
          "The server had already ended the conversation's session when the call this result answers reached it.",
      });
      expect((failure as Error).cause).toBeDefined();
      expect(uses[0]).toMatchObject({ client: 'expired', evidence: 'server-404' });
      await pool.settled();
      // Ended through terminate(): the DELETE met the session the server no longer held.
      expect(reports).toContainEqual(
        expect.objectContaining({ kind: 'ended', reason: 'expired', remote: 'already-gone' }),
      );
      // Not repeated; the next use opens the next client under the same key.
      const again = listCtx(alice);
      const [fresh] = await pool.toolProvider().list(again);
      expect(takeListUses(again)).toEqual([
        expect.objectContaining({ client: 'opened', previous: 'expired', generation: 2 }),
      ]);
      await expect(fresh!.execute({}, callCtx(alice))).resolves.toContain('status@');
      expect(server.sessions()).toHaveLength(1);
      expect(server.sessions()[0]).not.toBe(ended);
      await pool.close();
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

describe('(d) an AgentCore compute restart', () => {
  it('with a stateless hosted server, the next call succeeds and no expiry is claimed', async () => {
    const endpoint = fakeEndpoint({ issueSessions: false });
    const platform = fakePlatform(endpoint);
    const { pool } = poolOver(endpoint, { transport: platform.transport });
    const alice = id('alice', 'c1');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    await expect(status!.execute({}, callCtx(alice))).resolves.toContain('status@');
    // The platform stops the compute; a stateless server on new compute answers anyway.
    await expect(status!.execute({}, callCtx(alice))).resolves.toContain('status@');
    expect(pool.stats().unresolvedEndings).toBe(0);
  });

  it('with a stateful hosted server, its 404 on new compute gives SessionExpiredError', async () => {
    const endpoint = fakeEndpoint();
    const platform = fakePlatform(endpoint);
    const { pool } = poolOver(endpoint, { transport: platform.transport });
    const alice = id('alice', 'c1');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    await expect(status!.execute({}, callCtx(alice))).resolves.toContain('status@');
    // New compute: the hosted server no longer holds the MCP session.
    for (const session of endpoint.sessions()) endpoint.endSession(session);
    await expect(status!.execute({}, callCtx(alice))).rejects.toBeInstanceOf(SessionExpiredError);
  });
});

describe('(e) failures that are not expiry', () => {
  it('a platform ResourceNotFoundException (not the MCP server’s answer) is a failure; the client keeps its key', async () => {
    const endpoint = fakeEndpoint();
    let missing = false;
    const standIn = async (input: string | URL | Request, init?: RequestInit) => {
      if (missing && typeof init?.body === 'string' && init.body.includes('"tools/call"')) {
        return new Response(JSON.stringify({ message: 'No endpoint or agent found' }), {
          status: 404,
          headers: {
            'content-type': 'application/json',
            'x-amzn-errortype': 'ResourceNotFoundException',
          },
        });
      }
      return endpoint.fetch(input, init);
    };
    const { pool } = poolOver(endpoint, {
      transport: () =>
        agentCoreRuntimeMcpTransport({
          agentRuntimeArn: ARN,
          region: 'us-west-2',
          session: 'reuse',
          retry: false,
          auth: { bearer: staticTokens({ runtime: 't' }), fetch: standIn },
        }),
    });
    const alice = id('alice', 'c1');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    missing = true;
    const failure = await status!.execute({}, callCtx(alice)).catch((e: unknown) => e);
    expect(failure).not.toBeInstanceOf(SessionExpiredError);
    missing = false;
    const uses: McpClientUse[] = [];
    await expect(status!.execute({}, callCtx(alice, undefined, uses))).resolves.toContain(
      'status@',
    );
    expect(uses[0]).toMatchObject({ client: 'reused' });
  });

  it('a 404 to initialize is a wrong address: init-failed, never an expiry', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint, {
      transport: () => ({
        transport: 'http',
        url: endpoint.url,
        fetch: async () =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32001, message: 'Session not found' },
            }),
            {
              status: 404,
              headers: { 'content-type': 'application/json' },
            },
          ),
      }),
    });
    await expect(pool.acquire(id('alice', 'c1'))).rejects.toMatchObject({ reason: 'init-failed' });
  });

  it('a 500 and a network failure are failures, never an expiry', async () => {
    const endpoint = fakeEndpoint();
    let mode: 'ok' | '500' | 'network' = 'ok';
    const { pool } = poolOver(endpoint, {
      retryOnThrottle: false,
      transport: () => ({
        transport: 'http',
        url: endpoint.url,
        fetch: async (input, init) => {
          const call = typeof init?.body === 'string' && init.body.includes('"tools/call"');
          if (call && mode === '500') return new Response('boom', { status: 500 });
          if (call && mode === 'network') throw new TypeError('fetch failed');
          return endpoint.fetch(input, init);
        },
      }),
    });
    const alice = id('alice', 'c1');
    const [status] = await pool.toolProvider().list(listCtx(alice));
    mode = '500';
    const serverError = await status!.execute({}, callCtx(alice)).catch((e: unknown) => e);
    mode = 'network';
    const network = await status!.execute({}, callCtx(alice)).catch((e: unknown) => e);
    for (const failure of [serverError, network]) {
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(SessionExpiredError);
      expect(failure).not.toBeInstanceOf(LocalSessionHandleLostError);
    }
    mode = 'ok';
    await expect(status!.execute({}, callCtx(alice))).resolves.toContain('status@');
    expect(pool.stats().unresolvedEndings).toBe(0);
  });
});

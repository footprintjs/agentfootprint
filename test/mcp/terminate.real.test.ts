/**
 * `McpClient.terminate()` against a REAL Streamable HTTP server — the remote
 * answer read by the library itself, because the SDK treats a 405 as success.
 *
 * Pins: 204 → terminated; 405 → not-offered (although the SDK reports success);
 * 404 → already-gone; 500 → failed; a server that issues no session id →
 * no-session; the `connection` arm → unavailable; `close()` sends no DELETE
 * (pinned, so an SDK that changes it is noticed); `canTerminate` is true for
 * `mcpClient()` and `mockMcpClient()` and false for a hand-written client.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { canTerminate, mcpClient, mockMcpClient } from '../../src/tool-providers/index.js';
import type { McpClient, McpConnection } from '../../src/mcp/types.js';
import { REAL_TRANSPORT_TIMEOUT } from './realTransportSupport.js';
import { startSessionServer, type SessionServer } from './pool/sessionServer.js';

const servers: SessionServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function serve(deleteStatus: number | 'sdk', issueSessions = true): Promise<SessionServer> {
  const server = await startSessionServer({ deleteStatus, issueSessions });
  servers.push(server);
  return server;
}

async function connect(server: SessionServer): Promise<McpClient> {
  const client = await mcpClient({
    name: 'orders',
    transport: { transport: 'http', url: server.url },
  });
  await client.tools(); // a request in the session, so it is live
  return client;
}

const deletes = (server: SessionServer) => server.requests.filter((r) => r.httpMethod === 'DELETE');

describe('McpClient.terminate() — the remote answer, read by the library', () => {
  it(
    '204 → terminated, resolved',
    async () => {
      const server = await serve(204);
      const client = await connect(server);
      const outcome = await client.terminate!();
      expect(outcome).toMatchObject({ remote: 'terminated', resolved: true, status: 204 });
      expect(deletes(server)).toHaveLength(1);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    '405 → not-offered, unresolved — although the SDK reports success',
    async () => {
      const server = await serve(405);
      const client = await connect(server);
      const outcome = await client.terminate!();
      expect(outcome).toMatchObject({ remote: 'not-offered', resolved: false, status: 405 });
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    '404 → already-gone, resolved',
    async () => {
      const server = await serve(404);
      const client = await connect(server);
      const outcome = await client.terminate!();
      expect(outcome).toMatchObject({ remote: 'already-gone', resolved: true, status: 404 });
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    '500 → failed, unresolved, with its class and never its message',
    async () => {
      const server = await serve(500);
      const client = await connect(server);
      const outcome = await client.terminate!();
      expect(outcome).toMatchObject({ remote: 'failed', resolved: false, status: 500 });
      expect(outcome.errorClass).toBe('StreamableHTTPError');
      expect(JSON.stringify(outcome)).not.toContain('Error POSTing');
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'the SDK ending the session (its own DELETE handling) → terminated',
    async () => {
      const server = await serve('sdk');
      const client = await connect(server);
      expect(server.sessions()).toHaveLength(1);
      const outcome = await client.terminate!();
      expect(outcome).toMatchObject({ remote: 'terminated', resolved: true });
      expect(server.sessions()).toHaveLength(0);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'a server that issues no session id → no-session, and nothing is sent',
    async () => {
      const server = await serve('sdk', false);
      const client = await connect(server);
      const outcome = await client.terminate!();
      expect(outcome).toMatchObject({ remote: 'no-session', resolved: true });
      expect(deletes(server)).toHaveLength(0);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'ends at most once: a second terminate answers the first outcome and sends nothing',
    async () => {
      const server = await serve(204);
      const client = await connect(server);
      const first = await client.terminate!();
      const second = await client.terminate!();
      expect(second).toBe(first);
      expect(deletes(server)).toHaveLength(1);
      // terminate closed it locally: a later use throws, as after close().
      await expect(client.tools()).rejects.toThrow(/after close\(\)/);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'close() sends no DELETE — it ends only the local side (pinned against the SDK)',
    async () => {
      const server = await serve(204);
      const client = await connect(server);
      await client.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(deletes(server)).toHaveLength(0);
      expect(server.sessions()).toHaveLength(1);
      // After close(), terminate is refused like every other method.
      await expect(client.terminate!()).rejects.toThrow(/after close\(\)/);
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

describe('McpClient.terminate() — the arms that cannot end a session', () => {
  it('the connection arm → unavailable: the library did not build the transport', async () => {
    let closed = 0;
    const connection: McpConnection = {
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      close: async () => {
        closed += 1;
      },
    };
    const client = await mcpClient({ name: 'byo', connection });
    const outcome = await client.terminate!();
    expect(outcome).toMatchObject({ remote: 'unavailable', resolved: false });
    expect(closed).toBe(1);
  });

  it('the mock → no-session, resolved, and closed', async () => {
    const client = mockMcpClient({ tools: [] });
    expect(await client.terminate!()).toMatchObject({ remote: 'no-session', resolved: true });
    await expect(client.tools()).rejects.toThrow(/after close\(\)/);
  });
});

describe('canTerminate — read the member, never assume it', () => {
  it('true for mcpClient() and mockMcpClient(); false for a hand-written client without it', async () => {
    const server = await serve(204);
    const real = await connect(server);
    expect(canTerminate(real)).toBe(true);
    expect(canTerminate(mockMcpClient({ tools: [] }))).toBe(true);
    const handWritten: McpClient = {
      name: 'hand',
      tools: async () => [],
      refresh: async () => [],
      close: async () => undefined,
    };
    expect(canTerminate(handWritten)).toBe(false);
    expect(canTerminate(null)).toBe(false);
    expect(canTerminate({ terminate: 'no' })).toBe(false);
    await real.close();
  });
});

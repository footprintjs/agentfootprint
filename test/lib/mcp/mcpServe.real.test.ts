/**
 * mcpServe — against the REAL @modelcontextprotocol/sdk.
 *
 * `mcpServe.test.ts` injects a fake server and proves the dispatch logic.
 * This file proves the part injection cannot reach: that the transports
 * mcpServe actually builds — a stdio pipe to a spawned process, a
 * streamable-HTTP listener on a real socket — speak the protocol a real
 * MCP client speaks.
 *
 * That gap was not academic. Both fixes below were found by running this
 * file for the first time:
 *   - the streamable-HTTP path served exactly ONE request and then
 *     answered 500 forever (the SDK's stateless transport is single-use);
 *   - `mcpClient` posted its abort signal as a request PARAM, where it
 *     serializes to `{}` and cancels nothing (see mcpClient.real.test.ts).
 *
 * The client here is always the SDK's own `Client` — the point is to be
 * judged by someone else's implementation, not by our own.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { mcpServe } from '../../../src/tool-providers/index.js';
import type { McpServeHandle } from '../../../src/lib/mcp/types.js';
import {
  DELETE_INPUT_SCHEMA,
  DENIAL_MESSAGE,
  ECHO_INPUT_SCHEMA,
  servedTools,
} from './fixtures/servedTools.js';
import {
  REAL_TRANSPORT_TIMEOUT,
  REPO_ROOT,
  bundleEntry,
  freePort,
  waitForExit,
} from './realTransportSupport.js';

/** The SDK types content blocks as a union; tests only read text. */
type Textish = { type: string; text?: string };
const textOf = (result: { content: unknown }): string =>
  (result.content as Textish[]).map((c) => c.text ?? `[${c.type}]`).join('\n');

const newClient = (): Client =>
  new Client({ name: 'agentfootprint-real-test', version: '1.0.0' }, { capabilities: {} });

/** A dead keep-alive socket handed over by the pool, and nothing else. */
const isDeadPooledSocket = (err: unknown): boolean => {
  const cause = (err as { cause?: { code?: string; message?: string } } | undefined)?.cause;
  return (
    String(err).includes('fetch failed') ||
    cause?.code === 'UND_ERR_SOCKET' ||
    String(cause?.message ?? '').includes('other side closed')
  );
};

/**
 * A `fetch` that survives the pool handing it a socket the previous server owned.
 *
 * Node's `fetch` keeps connections alive in a GLOBAL undici pool keyed by
 * ORIGIN, not by server instance. So when a test closes one listener and starts
 * another on the same port, the next client can be handed a socket the closed
 * server was holding — and it fails with `UND_ERR_SOCKET` ("other side closed")
 * on whichever request happens to draw it: the initialize exchange just as
 * easily as a later call. Retrying the REQUEST evicts that socket and dials a
 * fresh one, which is why the tolerance lives here rather than around any single
 * call: every request the SDK transport makes goes through this function.
 *
 * Bounded at three attempts, and narrow — anything that is not a dead pooled
 * socket is rethrown untouched. The law under test is that the PORT is reusable
 * (a listener still holding it would `EADDRINUSE` when the second server binds);
 * connection-pool hygiene is undici's surface and never was this library's.
 */
const pooledSocketTolerantFetch: typeof fetch = async (url, init) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      // Three attempts, because the pool can hold more than one stale socket
      // for an origin — and a body this transport sends is always a string, so
      // replaying the request costs nothing that cannot be replayed.
      if (attempt >= 3 || !isDeadPooledSocket(err)) throw err;
    }
  }
};

// ─── (a) stdio — a real child process, a real pipe ────────────────

describe('mcpServe over a real stdio transport', () => {
  let entry: string;

  beforeAll(async () => {
    entry = await bundleEntry(
      'test/lib/mcp/fixtures/stdioServerEntry.ts',
      'stdio-server-entry.cjs',
    );
  }, REAL_TRANSPORT_TIMEOUT);

  async function spawnAndConnect(): Promise<{ client: Client; transport: StdioClientTransport }> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      cwd: REPO_ROOT,
    });
    const client = newClient();
    await client.connect(transport);
    return { client, transport };
  }

  it(
    'the served process introduces itself with the name and version it was given',
    async () => {
      const { client } = await spawnAndConnect();
      try {
        expect(client.getServerVersion()).toMatchObject({
          name: 'support-desk',
          version: '1.2.3',
        });
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: tools/list maps schemas 1:1 — the JSON Schema survives the wire unchanged',
    async () => {
      const { client } = await spawnAndConnect();
      try {
        const listed = await client.listTools();

        expect(listed.tools.map((t) => t.name)).toEqual(['echo', 'delete_account']);
        expect(listed.tools[0]).toMatchObject({
          name: 'echo',
          description: 'Echo the input back',
          inputSchema: ECHO_INPUT_SCHEMA,
        });
        expect(listed.tools[1]).toMatchObject({
          name: 'delete_account',
          description: 'Delete an account permanently',
          inputSchema: DELETE_INPUT_SCHEMA,
        });
        // Same source of truth on both sides of the pipe.
        const local = servedTools();
        for (const [i, tool] of local.entries()) {
          expect(listed.tools[i]!.inputSchema).toEqual(tool.schema.inputSchema);
        }
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'a call returns the tool result',
    async () => {
      const { client } = await spawnAndConnect();
      try {
        const result = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });

        expect(textOf(result)).toBe('echo: hi');
        expect(result.isError).toBeFalsy();
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: governance survives the wire — the denying tool comes back as a tool error',
    async () => {
      const { client } = await spawnAndConnect();
      try {
        const denied = await client.callTool({
          name: 'delete_account',
          arguments: { id: 'acct-1' },
        });

        // Serving is the same door with a longer corridor: the permission
        // check inside `execute` is what answered the remote client.
        expect(denied.isError).toBe(true);
        expect(textOf(denied)).toBe(DENIAL_MESSAGE);

        // And the refusal did not take the server down.
        const after = await client.callTool({ name: 'echo', arguments: { text: 'still here' } });
        expect(textOf(after)).toBe('echo: still here');
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'an unknown tool name is a tool error over the wire, not a dropped connection',
    async () => {
      const { client } = await spawnAndConnect();
      try {
        const result = await client.callTool({ name: 'rm_rf', arguments: {} });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toMatch(
          /Unknown tool 'rm_rf'\. Served tools: echo, delete_account\./,
        );
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'close() terminates the child process cleanly',
    async () => {
      const { client, transport } = await spawnAndConnect();
      const pid = transport.pid;
      expect(typeof pid).toBe('number');

      await client.close();

      expect(await waitForExit(pid!)).toBe(true);
      await expect(client.listTools()).rejects.toThrow();
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

// ─── (b) streamable HTTP — a real socket ──────────────────────────

describe('mcpServe over a real streamable-HTTP transport', () => {
  const open: McpServeHandle[] = [];

  const serveOnHttp = async (port: number): Promise<McpServeHandle> => {
    const handle = await mcpServe(servedTools(), {
      name: 'support-desk',
      version: '1.2.3',
      transport: { transport: 'http', port, host: '127.0.0.1' },
    });
    open.push(handle);
    return handle;
  };

  const connectHttp = async (
    port: number,
    path = '/mcp',
    options: { fetch?: typeof fetch } = {},
  ): Promise<Client> => {
    const client = newClient();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${path}`), {
        ...(options.fetch && { fetch: options.fetch }),
      }),
    );
    return client;
  };

  afterEach(async () => {
    while (open.length) await open.pop()!.close();
  });

  it(
    'LAW: port 0 is usable from the outside — the handle reports the socket it bound',
    async () => {
      // "Any free port" was unusable before 7.19.1: the OS picked a number
      // that lived inside a listener nobody could see, so every caller had
      // to guess a port up front and race whoever else wanted it. The handle
      // now says where it landed, and that answer has to be good enough to
      // dial — which is what connecting to it proves.
      const handle = await mcpServe(servedTools(), {
        name: 'support-desk',
        version: '1.2.3',
        transport: { transport: 'http', port: 0, host: '127.0.0.1' },
      });
      open.push(handle);

      expect(handle.port).toBeGreaterThan(0);
      expect(handle.address).toBe('127.0.0.1');

      const client = await connectHttp(handle.port!);
      try {
        expect(textOf(await client.callTool({ name: 'echo', arguments: { text: 'zero' } }))).toBe(
          'echo: zero',
        );
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'an explicitly chosen port is reported back unchanged, so callers need not branch',
    async () => {
      const port = await freePort();
      const handle = await serveOnHttp(port);
      expect(handle.port).toBe(port);
      expect(handle.address).toBe('127.0.0.1');
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'REGRESSION: the listener answers MANY requests, not just the first',
    async () => {
      // The SDK's stateless transport refuses to handle a second request,
      // so a server that builds ONE transport up front initializes fine and
      // then 500s forever. That is what shipped, and only a real client
      // could see it: every injected test passes either way.
      const port = await freePort();
      await serveOnHttp(port);
      const client = await connectHttp(port);
      try {
        for (const word of ['one', 'two', 'three']) {
          expect(textOf(await client.callTool({ name: 'echo', arguments: { text: word } }))).toBe(
            `echo: ${word}`,
          );
        }
        expect((await client.listTools()).tools).toHaveLength(2);
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: tools/list maps schemas 1:1 over HTTP too',
    async () => {
      const port = await freePort();
      await serveOnHttp(port);
      const client = await connectHttp(port);
      try {
        const listed = await client.listTools();

        expect(client.getServerVersion()).toMatchObject({
          name: 'support-desk',
          version: '1.2.3',
        });
        expect(listed.tools.map((t) => t.name)).toEqual(['echo', 'delete_account']);
        expect(listed.tools[0]!.inputSchema).toEqual(ECHO_INPUT_SCHEMA);
        expect(listed.tools[1]!.inputSchema).toEqual(DELETE_INPUT_SCHEMA);
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'a call returns the tool result, and the denying tool comes back as a tool error',
    async () => {
      const port = await freePort();
      await serveOnHttp(port);
      const client = await connectHttp(port);
      try {
        const ok = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
        expect(textOf(ok)).toBe('echo: hi');
        expect(ok.isError).toBeFalsy();

        const denied = await client.callTool({
          name: 'delete_account',
          arguments: { id: 'acct-1' },
        });
        expect(denied.isError).toBe(true);
        expect(textOf(denied)).toBe(DENIAL_MESSAGE);

        // Governance refused, and the next caller is still served.
        expect(textOf(await client.callTool({ name: 'echo', arguments: { text: 'after' } }))).toBe(
          'echo: after',
        );
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'requests off the MCP path are 404, and a custom path is honoured',
    async () => {
      const port = await freePort();
      await serveOnHttp(port);

      const stray = await fetch(`http://127.0.0.1:${port}/not-mcp`, { method: 'POST' });
      expect(stray.status).toBe(404);
      await stray.arrayBuffer();

      const custom = await freePort();
      const handle = await mcpServe(servedTools(), {
        transport: { transport: 'http', port: custom, host: '127.0.0.1', path: '/tools' },
      });
      open.push(handle);
      const client = await connectHttp(custom, '/tools');
      try {
        expect((await client.listTools()).tools).toHaveLength(2);
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: close() frees the port — the same port can be served again',
    async () => {
      const port = await freePort();
      const first = await serveOnHttp(port);
      const client = await connectHttp(port);
      expect(textOf(await client.callTool({ name: 'echo', arguments: { text: 'a' } }))).toBe(
        'echo: a',
      );
      await client.close();

      await first.close();
      open.pop();

      // If the listener were still holding the socket this would EADDRINUSE.
      const second = await serveOnHttp(port);
      expect(second.toolNames).toEqual(['echo', 'delete_account']);
      // The reconnect gets its OWN fetch, tolerant of one dead pooled socket —
      // see `pooledSocketTolerantFetch`. Every request the transport makes goes
      // through it, so the tolerance covers the connect/initialize exchange as
      // well as the call below; a retry wrapped around only the call left the
      // handshake exposed, which is where this last flaked.
      const reconnected = await connectHttp(port, '/mcp', { fetch: pooledSocketTolerantFetch });
      try {
        expect(textOf(await reconnected.callTool({ name: 'echo', arguments: { text: 'b' } }))).toBe(
          'echo: b',
        );
      } finally {
        await reconnected.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'close() is idempotent on a live socket',
    async () => {
      const port = await freePort();
      const handle = await serveOnHttp(port);

      await handle.close();
      await handle.close();
      open.pop();

      await expect(connectHttp(port)).rejects.toThrow();
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

// ─── (c) the runtime container contract, settled ──────────────────

/**
 * Does the streamable-HTTP transport satisfy the container contract this repo
 * documents for a managed agent runtime?
 *
 * The contract, as written down HERE (`examples/deploy/README.md`,
 * `docs/guides/agentcore.md`, and the adapter's own header in
 * `src/adapters/hosting/agentcore.ts`): `POST /invocations` taking
 * `{ "prompt" }` and answering `{ "response", "status" }`, `GET /ping`
 * answering a health body, both on `0.0.0.0:8080`, with the conversation id in
 * a request header. Those documents describe ONE protocol — that HTTP one —
 * and say nothing anywhere about serving MCP as a runtime's own protocol.
 *
 * **Verdict, pinned below: it does not, and it is not trying to.** `mcpServe`
 * serves the MCP endpoint (a path it owns, a port you choose, stateless so a
 * replica set is safe) and NEITHER of the contract's two routes: `/ping` and
 * `/invocations` are 404s from it. The two are different protocols on
 * different paths, so a deployment that must answer both needs both — which is
 * what `httpHost({ server })` is for since 7.22.0: the runtime host attaches to
 * a server you own, and anything else you serve on that port stays yours.
 * `mcpServe` has no such option today; its HTTP transport always owns its
 * listener, so "MCP and the runtime contract on ONE port" is not reachable in
 * this release.
 */
describe('mcpServe vs the runtime container contract', () => {
  const open: McpServeHandle[] = [];
  afterEach(async () => {
    while (open.length) await open.pop()!.close();
  });

  it(
    'CONFORMANCE: serves MCP statelessly on the path and port you choose — and answers neither /ping nor /invocations',
    async () => {
      const handle = await mcpServe(servedTools(), {
        name: 'support-desk',
        version: '1.2.3',
        // The contract's own port and interface are expressible; the test binds
        // an ephemeral one so it never collides with whatever is on :8080.
        transport: { transport: 'http', port: 0, host: '127.0.0.1', path: '/mcp' },
      });
      open.push(handle);
      const base = `http://127.0.0.1:${handle.port!}`;

      // (1) The MCP endpoint is real, judged by the SDK's own client.
      const client = newClient();
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      try {
        expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
          'echo',
          'delete_account',
        ]);
        expect(textOf(await client.callTool({ name: 'echo', arguments: { text: 'hi' } }))).toBe(
          'echo: hi',
        );
      } finally {
        await client.close();
      }

      // (2) Stateless: the transport neither issues nor demands a session id,
      // so any replica can answer any request — the property a managed runtime
      // in front of N containers needs.
      const initialize = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'conformance-probe', version: '1.0.0' },
          },
        }),
      });
      expect(initialize.status).toBe(200);
      expect(initialize.headers.get('mcp-session-id')).toBeNull();
      await initialize.arrayBuffer();

      // (3) And it is NOT the documented container contract. Both of that
      // contract's routes are 404 here, which is the honest answer: they belong
      // to the hosting adapter, on its own paths, in its own body dialect.
      const ping = await fetch(`${base}/ping`);
      expect(ping.status).toBe(404);
      await ping.arrayBuffer();

      const invocations = await fetch(`${base}/invocations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      expect(invocations.status).toBe(404);
      await invocations.arrayBuffer();
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

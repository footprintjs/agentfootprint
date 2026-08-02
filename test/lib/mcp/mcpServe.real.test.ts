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

  const connectHttp = async (port: number, path = '/mcp'): Promise<Client> => {
    const client = newClient();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${path}`)),
    );
    return client;
  };

  afterEach(async () => {
    while (open.length) await open.pop()!.close();
  });

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
      const reconnected = await connectHttp(port);
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

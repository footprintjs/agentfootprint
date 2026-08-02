/**
 * mcpClient — against a REAL MCP server, over a real socket and a real pipe.
 *
 * `mcpClient.test.ts` injects `_client` and pins the adapter's laws in
 * microseconds. Everything it proves, it proves about a hand-written
 * mock. This file re-proves the same laws against a server built with
 * @modelcontextprotocol/sdk itself — so "the adapter is correct" stops
 * meaning "the adapter agrees with our mock".
 *
 * One law was only false on the real wire: `signal` was being posted
 * INSIDE the JSON-RPC params, where an AbortSignal serializes to `{}` and
 * cancels nothing. The mock happily accepted it. A socket did not.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { Server as HttpServer } from 'node:http';
import { createServer } from 'node:http';

import { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { mcpClient } from '../../../src/tool-providers/index.js';
import { DENIAL_MESSAGE } from './fixtures/servedTools.js';
import {
  REAL_TRANSPORT_TIMEOUT,
  REPO_ROOT,
  bundleEntry,
  freePort,
} from './realTransportSupport.js';

// ─── A minimal REAL MCP server, built with the SDK ────────────────

const SEARCH_INPUT_SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
} as const;

/** A 1x1 transparent PNG — the SDK validates image blocks as base64. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface RealServer {
  readonly url: string;
  /** How many times the server answered tools/list — proves client caching. */
  listCalls(): number;
  close(): Promise<void>;
}

/**
 * Stand up an SDK server on an ephemeral port. Deliberately hand-rolled
 * from the SDK's own primitives rather than from `mcpServe`, so this file
 * tests `mcpClient` against someone else's implementation of the protocol.
 *
 * The per-request server/transport shape is the SDK's stateless contract:
 * a stateless transport refuses to handle a second request.
 */
async function startRealServer(): Promise<RealServer> {
  let listCalls = 0;

  const build = (): SdkServer => {
    const server = new SdkServer(
      { name: 'stock-desk', version: '4.5.6' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => {
      listCalls++;
      return {
        tools: [
          { name: 'search', description: 'Search the web', inputSchema: SEARCH_INPUT_SCHEMA },
          { name: 'multi', description: 'Two text blocks', inputSchema: { type: 'object' } },
          { name: 'mixed', description: 'Text plus attachments', inputSchema: { type: 'object' } },
          { name: 'broken', description: 'Always refuses', inputSchema: { type: 'object' } },
          { name: 'slow', description: 'Never answers', inputSchema: { type: 'object' } },
          {
            name: 'echoArgs',
            description: 'Returns the args it received',
            inputSchema: { type: 'object' },
          },
        ],
      };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      switch (name) {
        case 'search':
          return { content: [{ type: 'text', text: `results for ${String(args?.query)}` }] };
        case 'multi':
          return {
            content: [
              { type: 'text', text: 'line 1' },
              { type: 'text', text: 'line 2' },
            ],
          };
        case 'mixed':
          return {
            content: [
              { type: 'text', text: 'caption' },
              { type: 'image', data: PIXEL, mimeType: 'image/png' },
              { type: 'resource', resource: { uri: 'file:///notes.txt', text: 'notes' } },
            ],
          };
        case 'broken':
          return { content: [{ type: 'text', text: DENIAL_MESSAGE }], isError: true };
        case 'slow':
          // Never resolves during the test. The timer is unref'd so a
          // cancelled call cannot keep the worker alive.
          return new Promise((resolve) => {
            setTimeout(resolve, 60_000).unref();
          });
        default:
          return { content: [{ type: 'text', text: JSON.stringify(args ?? null) }] };
      }
    });
    return server;
  };

  const listener: HttpServer = createServer((req, res) => {
    void (async () => {
      const server = build();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    })().catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  });

  const port = await freePort();
  await new Promise<void>((done, fail) => {
    listener.once('error', fail);
    listener.listen(port, '127.0.0.1', done);
  });

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    listCalls: () => listCalls,
    close: () =>
      new Promise<void>((done, fail) => {
        listener.closeAllConnections();
        listener.close((err) => (err ? fail(err) : done()));
      }),
  };
}

// ─── Against a real SDK server, over HTTP ─────────────────────────

describe('mcpClient against a real SDK server (streamable HTTP)', () => {
  const servers: RealServer[] = [];

  const start = async (): Promise<RealServer> => {
    const server = await startRealServer();
    servers.push(server);
    return server;
  };

  afterAll(async () => {
    while (servers.length) await servers.pop()!.close();
  });

  it(
    'discovers the server tools and preserves each schema',
    async () => {
      const server = await start();
      const client = await mcpClient({
        name: 'stock-desk',
        transport: { transport: 'http', url: server.url },
      });
      try {
        const tools = await client.tools();

        expect(tools.map((t) => t.schema.name)).toEqual([
          'search',
          'multi',
          'mixed',
          'broken',
          'slow',
          'echoArgs',
        ]);
        expect(tools[0]!.schema.description).toBe('Search the web');
        expect(tools[0]!.schema.inputSchema).toEqual(SEARCH_INPUT_SCHEMA);
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'execute() round-trips: args go out, the result comes back',
    async () => {
      const server = await start();
      const client = await mcpClient({ transport: { transport: 'http', url: server.url } });
      try {
        const tools = await client.tools();
        const search = tools.find((t) => t.schema.name === 'search')!;

        expect(await search.execute({ query: 'ACME' })).toBe('results for ACME');
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: text blocks are concatenated, non-text blocks are summarized by type',
    async () => {
      const server = await start();
      const client = await mcpClient({ transport: { transport: 'http', url: server.url } });
      try {
        const tools = await client.tools();
        const byName = (n: string) => tools.find((t) => t.schema.name === n)!;

        expect(await byName('multi').execute({})).toBe('line 1\nline 2');
        expect(await byName('mixed').execute({})).toBe('caption\n[image]\n[resource]');
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: isError=true becomes a thrown Error naming the tool and the server',
    async () => {
      const server = await start();
      const client = await mcpClient({
        name: 'auth-server',
        transport: { transport: 'http', url: server.url },
      });
      try {
        const broken = (await client.tools()).find((t) => t.schema.name === 'broken')!;

        await expect(broken.execute({})).rejects.toThrow(
          /'broken'.*server 'auth-server'.*not permitted/,
        );
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: non-object args coerce to {} rather than failing the SDK call',
    async () => {
      const server = await start();
      const client = await mcpClient({ transport: { transport: 'http', url: server.url } });
      try {
        const echoArgs = (await client.tools()).find((t) => t.schema.name === 'echoArgs')!;

        // The SDK's request schema would reject a scalar `arguments`, so
        // this coercion is what keeps a hallucinated scalar from becoming
        // a protocol error instead of a tool error.
        expect(await echoArgs.execute(null)).toBe('{}');
        expect(await echoArgs.execute('oops' as never)).toBe('{}');
        expect(await echoArgs.execute(['oops'] as never)).toBe('{}');
        expect(await echoArgs.execute({ a: 1 })).toBe('{"a":1}');
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: .tools() caches across a real round trip; .refresh() goes back to the server',
    async () => {
      const server = await start();
      const client = await mcpClient({ transport: { transport: 'http', url: server.url } });
      try {
        const before = server.listCalls();
        await client.tools();
        await client.tools();
        await client.tools();
        expect(server.listCalls()).toBe(before + 1);

        await client.refresh();
        expect(server.listCalls()).toBe(before + 2);
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'REGRESSION: McpClientOptions.signal actually cancels a hung call',
    async () => {
      // The signal used to be posted inside the request params, where it
      // JSON-serializes to `{}`. Against the mock that looked like a pass;
      // against a socket the call simply hung forever. The SDK reads it
      // from its trailing RequestOptions argument.
      const server = await start();
      const controller = new AbortController();
      const client = await mcpClient({
        transport: { transport: 'http', url: server.url },
        signal: controller.signal,
      });
      try {
        const slow = (await client.tools()).find((t) => t.schema.name === 'slow')!;

        const pending = slow.execute({});
        const settled = await Promise.race([
          pending.then(
            () => 'resolved',
            () => 'rejected',
          ),
          new Promise((r) => setTimeout(() => r('still-hanging'), 250)),
        ]);
        expect(settled).toBe('still-hanging');

        controller.abort();
        await expect(pending).rejects.toThrow();
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: after close() the client refuses to touch the torn-down transport',
    async () => {
      const server = await start();
      const client = await mcpClient({
        name: 'test',
        transport: { transport: 'http', url: server.url },
      });
      await client.tools();
      await client.close();

      await expect(client.tools()).rejects.toThrow(
        /mcpClient\[test\]\.tools\(\) called after close/,
      );
      await expect(client.refresh()).rejects.toThrow(
        /mcpClient\[test\]\.refresh\(\) called after close/,
      );
      await client.close(); // idempotent
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

// ─── The full loop: our client, our server, a real stdio pipe ─────

describe('mcpClient ↔ mcpServe over a real stdio pipe', () => {
  it(
    'both directions of the adapter meet in the middle: tools out, results back, refusal preserved',
    async () => {
      const entry = await bundleEntry(
        'test/lib/mcp/fixtures/stdioServerEntry.ts',
        'stdio-server-entry-loop.cjs',
      );
      const client = await mcpClient({
        name: 'support-desk',
        transport: {
          transport: 'stdio',
          command: process.execPath,
          args: [entry],
          cwd: REPO_ROOT,
        },
      });
      try {
        const tools = await client.tools();
        expect(tools.map((t) => t.schema.name)).toEqual(['echo', 'delete_account']);

        expect(await tools[0]!.execute({ text: 'round trip' })).toBe('echo: round trip');

        // mcpServe reports the refusal as a tool error; mcpClient turns a
        // tool error back into a thrown Error. The governance decision
        // survives both translations.
        await expect(tools[1]!.execute({ id: 'acct-1' })).rejects.toThrow(
          /'delete_account'.*server 'support-desk'.*not permitted/,
        );
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

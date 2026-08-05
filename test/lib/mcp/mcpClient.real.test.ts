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
  /** Every request's headers, as the socket received them. */
  headersSeen(): ReadonlyArray<Readonly<Record<string, string | string[] | undefined>>>;
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
          {
            name: 'legacy',
            description: 'Answers in the 2024-10-07 shape',
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
        case 'legacy':
          // The 2024-10-07 answer: a bare `toolResult`, no `content` at all.
          // Servers this old are still running, and the SDK still accepts them.
          return { toolResult: 'ledger balance 41.20' } as never;
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

  const headersSeen: Record<string, string | string[] | undefined>[] = [];
  const listener: HttpServer = createServer((req, res) => {
    headersSeen.push({ ...req.headers });
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
    headersSeen: () => headersSeen,
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
          'legacy',
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

// ─── A caller-supplied fetch, over the real wire (7.23.0) ─────────

/**
 * The seam the SDK already had and this library did not pass through. Some
 * endpoints do not want a header, they want a SIGNATURE over the request —
 * which cannot be decided when the connection is built, because it is computed
 * from the bytes about to be sent.
 *
 * Everything below runs against a real socket, because the whole question is
 * what actually reaches the wire.
 */
describe('mcpClient — a caller-supplied fetch (real HTTP)', () => {
  const servers: RealServer[] = [];
  const start = async (): Promise<RealServer> => {
    const server = await startRealServer();
    servers.push(server);
    return server;
  };

  afterAll(async () => {
    while (servers.length) await servers.pop()!.close();
  });

  interface SeenRequest {
    readonly method: string;
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body: string;
  }

  /** A fetch that records everything it was handed, then does the real thing. */
  function capturingFetch(sign?: (seen: SeenRequest) => string): {
    seen: SeenRequest[];
    fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  } {
    const seen: SeenRequest[] = [];
    return {
      seen,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        const record: SeenRequest = {
          method: init?.method ?? 'GET',
          url: String(input),
          headers: Object.fromEntries(headers.entries()),
          body: typeof init?.body === 'string' ? init.body : '',
        };
        seen.push(record);
        if (sign) headers.set('authorization', sign(record));
        return fetch(input, { ...init, headers });
      },
    };
  }

  const rpcMethods = (seen: readonly SeenRequest[]): string[] =>
    seen
      .filter((r) => r.body !== '')
      .map((r) => (JSON.parse(r.body) as { method?: string }).method ?? '(none)');

  it(
    'LAW: the supplied fetch sees EVERY request — initialize, tools/list and tools/call',
    async () => {
      const server = await start();
      const cap = capturingFetch();
      const client = await mcpClient({
        transport: { transport: 'http', url: server.url, fetch: cap.fetch },
      });
      try {
        const tools = await client.tools();
        const search = tools.find((t) => t.schema.name === 'search')!;
        expect(await search.execute({ query: 'ACME' })).toBe('results for ACME');

        // Every hop went through the caller's function, and each one carried
        // the method, the url, the headers and the body it was sending.
        expect(rpcMethods(cap.seen)).toEqual(
          expect.arrayContaining(['initialize', 'tools/list', 'tools/call']),
        );
        for (const r of cap.seen.filter((x) => x.body !== '')) {
          expect(r.method).toBe('POST');
          expect(r.url).toBe(server.url);
          expect(r.headers['content-type']).toContain('application/json');
        }
        const call = cap.seen.find((r) => r.body.includes('tools/call'))!;
        expect(JSON.parse(call.body)).toMatchObject({
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'ACME' } },
        });
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: with no fetch, byte-identical — a passthrough changes nothing observable',
    async () => {
      const server = await start();
      const plain = await mcpClient({ transport: { transport: 'http', url: server.url } });
      const passthrough = await mcpClient({
        transport: {
          transport: 'http',
          url: server.url,
          fetch: (input, init) => fetch(input, init),
        },
      });
      try {
        const a = await plain.tools();
        const b = await passthrough.tools();
        expect(b.map((t) => t.schema)).toEqual(a.map((t) => t.schema));
        expect(await b.find((t) => t.schema.name === 'search')!.execute({ query: 'ACME' })).toBe(
          await a.find((t) => t.schema.name === 'search')!.execute({ query: 'ACME' }),
        );
      } finally {
        await plain.close();
        await passthrough.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: headers and fetch COMPOSE — the signer sees the static headers and has the last word',
    async () => {
      // The precedence answer, pinned rather than assumed: the SDK folds
      // `requestInit.headers` into the init it hands the custom fetch, so a
      // signer reads them and, writing last, decides what goes on the wire.
      const server = await start();
      const cap = capturingFetch(() => 'Signed per-request');
      const client = await mcpClient({
        transport: {
          transport: 'http',
          url: server.url,
          headers: { 'x-tenant': 'acme', authorization: 'Static should-not-win' },
          fetch: cap.fetch,
        },
      });
      try {
        await client.tools();

        // The signer SAW both static headers…
        expect(cap.seen[0]!.headers['x-tenant']).toBe('acme');
        expect(cap.seen[0]!.headers['authorization']).toBe('Static should-not-win');

        // …and the socket received the tenant header untouched plus the
        // signature, never the static credential it collided with.
        const onWire = server.headersSeen();
        expect(onWire.length).toBeGreaterThan(0);
        for (const h of onWire) {
          expect(h['x-tenant']).toBe('acme');
          expect(h['authorization']).toBe('Signed per-request');
        }
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'a generic per-request signer needs no vendor SDK — and signs each request separately',
    async () => {
      const server = await start();
      // Signs over the method, the url and the body — the three things a
      // connect-time header cannot know. Node's own crypto, nothing else.
      const { createHmac } = await import('node:crypto');
      const sign = (r: SeenRequest): string =>
        `HMAC ${createHmac('sha256', 'shared-secret')
          .update(`${r.method}\n${r.url}\n${r.body}`)
          .digest('hex')}`;
      const cap = capturingFetch(sign);
      const client = await mcpClient({
        transport: { transport: 'http', url: server.url, fetch: cap.fetch },
      });
      try {
        const tools = await client.tools();
        await tools.find((t) => t.schema.name === 'search')!.execute({ query: 'ACME' });

        const signatures = server
          .headersSeen()
          .map((h) => h['authorization'])
          .filter((v): v is string => typeof v === 'string');
        expect(signatures.length).toBeGreaterThanOrEqual(3);
        // Different bodies ⇒ different signatures. A signature computed once
        // at connect time could not have done this.
        expect(new Set(signatures).size).toBeGreaterThan(1);
        // And each one verifies against what that request actually carried.
        for (const r of cap.seen.filter((x) => x.body !== '')) {
          expect(signatures).toContain(sign(r));
        }
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    "SECURITY: a signing fetch's Authorization never reaches a log, a result or an error",
    async () => {
      // The four pins gatewayTransport already holds, applied to the seam that
      // now also carries credentials.
      const SECRET = 'sig-2f6a-never-log-me';
      const server = await start();
      const said: string[] = [];
      const channels = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
      const original = channels.map((c) => [c, console[c]] as const);
      for (const c of channels) {
        // eslint-disable-next-line no-console
        console[c] = (...parts: unknown[]) => said.push(parts.map(String).join(' '));
      }

      const descriptor = {
        transport: 'http' as const,
        url: server.url,
        fetch: async (input: string | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          headers.set('authorization', `Bearer ${SECRET}`);
          return fetch(input, { ...init, headers });
        },
      };

      try {
        const client = await mcpClient({ name: 'signed', transport: descriptor });
        try {
          const tools = await client.tools();
          const search = tools.find((t) => t.schema.name === 'search')!;
          const result = await search.execute({ query: 'ACME' });
          const failure = await tools
            .find((t) => t.schema.name === 'broken')!
            .execute({})
            .catch((e: Error) => e);

          // 1. a hostile logger watching every console channel saw nothing;
          expect(said.join('\n')).not.toContain(SECRET);
          // 2. the descriptor holds no token — the value lives inside a
          //    closure that runs per request, so serializing it reveals nothing;
          expect(JSON.stringify(descriptor)).not.toContain(SECRET);
          // 3. the tool result carries none of it;
          expect(result).not.toContain(SECRET);
          // 4. and neither does an error thrown downstream of the signature.
          expect((failure as Error).message).not.toContain(SECRET);
          expect((failure as Error).message).toMatch(/'broken'.*server 'signed'/);
        } finally {
          await client.close();
        }
      } finally {
        for (const [c, fn] of original) (console[c] as unknown) = fn;
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: a real server answering the 2024-10-07 shape is READ, not lost',
    async () => {
      // The union bug, end to end. The server sends `{ toolResult }` and no
      // content; the SDK's default schema hands us an empty `content` beside
      // it; reading that first would have answered a real result with ''.
      const server = await start();
      const client = await mcpClient({
        name: 'old-server',
        transport: { transport: 'http', url: server.url },
      });
      try {
        const legacy = (await client.tools()).find((t) => t.schema.name === 'legacy')!;
        expect(await legacy.execute({})).toBe('ledger balance 41.20');
      } finally {
        await client.close();
      }
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

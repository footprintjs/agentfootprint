/**
 * The browser seams, driven over a real socket with the real SDK.
 *
 * `mcpConnection.test.ts` pins the laws against hand-written fakes in
 * microseconds. Everything it proves, it proves about our own doubles. This
 * file re-proves the same seams against @modelcontextprotocol/sdk itself —
 * a real `Client`, a real `StreamableHTTPClientTransport`, a real listening
 * socket — because a code path that is only ever mocked is a code path nobody
 * has run.
 *
 * Both SDK modules are imported STATICALLY here, which is exactly what a
 * browser consumer writes. That is the point: the arms exist so the SDK can be
 * loaded by the bundler rather than by a Node loader, and a static import is
 * the shape of that.
 *
 * **What this does NOT prove.** It is Node. Nobody has driven
 * initialize/listTools/callTool from an actual page, and this file cannot say
 * they have. What it proves is that the non-`lazyRequire` code path really
 * speaks MCP end to end, and that the graph fence (`browserGraph.test.ts`) is
 * fencing a path that works.
 *
 * Test types (Convention 3): integration (both arms, end to end) ·
 * regression (`_meta` declarations survive on both) · scenario (the documented
 * browser call site, run for real).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { defineTool } from '../../../src/index.js';
import { mcpClient, mcpServe, retryingFetch } from '../../../src/tool-providers/index.js';
import type { McpClient, McpServeHandle } from '../../../src/lib/mcp/types.js';
import { REAL_TRANSPORT_TIMEOUT } from './realTransportSupport.js';

// ─── What the server serves ───────────────────────────────────────

const lookup = defineTool({
  name: 'port_status',
  description: 'Reads the status of one port.',
  inputSchema: {
    type: 'object',
    properties: { port: { type: 'string' } },
    required: ['port'],
  },
  argumentsFrom: ['list_ports'],
  resultKind: 'dataset/ports',
  resultCeiling: { maxChars: 4_000, narrowBy: ['port'] },
  execute: (args) => `port ${String((args as { port: string }).port)}: online`,
});

const servers: McpServeHandle[] = [];
const clients: McpClient[] = [];
const rawClients: Client[] = [];

afterEach(async () => {
  while (clients.length) await clients.pop()!.close();
  while (rawClients.length)
    await rawClients
      .pop()!
      .close()
      .catch(() => undefined);
  while (servers.length) await servers.pop()!.close();
});

async function serve(): Promise<string> {
  const handle = await mcpServe([lookup], {
    name: 'fabric-desk',
    version: '1.0.0',
    transport: { transport: 'http', port: 0, host: '127.0.0.1' },
  });
  servers.push(handle);
  return `http://127.0.0.1:${handle.port}/mcp`;
}

/** Every assertion both arms owe, so neither can quietly do less than the other. */
async function assertServes(client: McpClient, server: string): Promise<void> {
  const tools = await client.tools();
  expect(tools.map((t) => t.schema.name)).toEqual(['port_status']);

  const tool = tools[0]!;
  expect(tool.source).toBe(server);
  expect(tool.schema.inputSchema).toMatchObject({ required: ['port'] });
  // The `_meta` bag survived the SDK's own tools/list validation and was read
  // by `readToolExtras` — which never throws, so a drop here would be silent.
  expect(tool.argumentsFrom).toEqual(['list_ports']);
  expect(tool.resultKind).toBe('dataset/ports');
  expect(tool.resultCeiling).toEqual({ maxChars: 4_000, narrowBy: ['port'] });

  expect(await tool.execute({ port: 'fc1/3' })).toBe('port fc1/3: online');
}

// ─── The `connection` arm ─────────────────────────────────────────

describe('mcpClient({ connection }) over a real socket', () => {
  it(
    'a client you connected yourself serves tools, declarations and a call',
    async () => {
      const url = await serve();

      // Exactly what a browser consumer writes — nothing here is reachable
      // through the Node loader, and nothing here asks the library to build.
      const connection = new Client({ name: 'browser', version: '1.0.0' }, { capabilities: {} });
      rawClients.push(connection);
      await connection.connect(new StreamableHTTPClientTransport(new URL(url)));

      const client = await mcpClient({ name: 'own-connection', connection });
      clients.push(client);

      await assertServes(client, 'own-connection');
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'close() really closes the connection that was handed over',
    async () => {
      const url = await serve();
      const connection = new Client({ name: 'browser', version: '1.0.0' }, { capabilities: {} });
      await connection.connect(new StreamableHTTPClientTransport(new URL(url)));

      const client = await mcpClient({ connection });
      await client.tools();
      await client.close();

      // The SDK's own answer to "you closed me": a rejected request, not a hang.
      await expect(connection.listTools()).rejects.toThrow();
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'retryingFetch is reachable, so the connection arm can keep its 429 handling',
    async () => {
      // The asymmetry this export closes: on the `transport` arm the library
      // applies this for you, ON by default. Here the caller applies it —
      // same implementation, same place in the stack.
      const url = await serve();
      let calls = 0;
      const counted = retryingFetch((input, init) => {
        calls++;
        return fetch(input, init);
      }, true)!;

      const connection = new Client({ name: 'browser', version: '1.0.0' }, { capabilities: {} });
      rawClients.push(connection);
      await connection.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: counted }));
      const client = await mcpClient({ name: 'retrying', connection });
      clients.push(client);

      await assertServes(client, 'retrying');
      expect(calls).toBeGreaterThanOrEqual(3); // initialize + tools/list + tools/call
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

// ─── The `sdk` arm ────────────────────────────────────────────────

describe('mcpClient({ sdk, transport }) over a real socket', () => {
  it(
    'the library builds the transport from modules you imported — the documented browser call',
    async () => {
      const url = await serve();

      const client = await mcpClient({
        name: 'sidecar',
        sdk: { Client, StreamableHTTPClientTransport },
        transport: { transport: 'http', url },
      });
      clients.push(client);

      await assertServes(client, 'sidecar');
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'and it still carries the headers and the fetch the transport arm always carried',
    async () => {
      const url = await serve();
      const seen: Record<string, string>[] = [];

      const client = await mcpClient({
        name: 'sidecar',
        sdk: { Client, StreamableHTTPClientTransport },
        transport: {
          transport: 'http',
          url,
          headers: { 'x-tenant': 'acme' },
          fetch: (input, init) => {
            seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
            return fetch(input, init);
          },
        },
      });
      clients.push(client);

      await client.tools();
      expect(seen.length).toBeGreaterThan(0);
      for (const headers of seen) expect(headers['x-tenant']).toBe('acme');
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'LAW: the two arms and the default arm agree, tool for tool',
    async () => {
      const url = await serve();

      const viaDefault = await mcpClient({ name: 's', transport: { transport: 'http', url } });
      const viaSdk = await mcpClient({
        name: 's',
        sdk: { Client, StreamableHTTPClientTransport },
        transport: { transport: 'http', url },
      });
      const connection = new Client({ name: 'browser', version: '1.0.0' }, { capabilities: {} });
      rawClients.push(connection);
      await connection.connect(new StreamableHTTPClientTransport(new URL(url)));
      const viaConnection = await mcpClient({ name: 's', connection });
      clients.push(viaDefault, viaSdk, viaConnection);

      const shapeOf = async (client: McpClient): Promise<unknown> =>
        (await client.tools()).map((t) => ({
          schema: t.schema,
          source: t.source,
          argumentsFrom: t.argumentsFrom,
          resultKind: t.resultKind,
          resultCeiling: t.resultCeiling,
        }));

      const baseline = await shapeOf(viaDefault);
      expect(await shapeOf(viaSdk)).toEqual(baseline);
      expect(await shapeOf(viaConnection)).toEqual(baseline);
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

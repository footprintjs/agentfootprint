/**
 * 22 — MCP from a browser: hand the library what its Node loader would
 * have found.
 *
 * The barrier was never the protocol and never the SDK. `mcpClient` loads
 * `@modelcontextprotocol/sdk` through a Node `require` loader, and that
 * loader does not exist in a browser bundle. So there are two seams:
 *
 *   sdk:        you import the two SDK modules statically (your bundler
 *               resolves them) and the library STILL builds the transport —
 *               headers, your own fetch, gateway vending, throttle retry.
 *   connection: you build and connect the client yourself; the library only
 *               adapts its tools. The full escape hatch, and the only arm
 *               that reaches the SDK's own `jsonSchemaValidator` — which is
 *               how you keep ajv's `new Function` off a page with a strict
 *               CSP.
 *
 * This example runs in Node, because an example has to run somewhere. What
 * it demonstrates is the CALL SITE: the imports below are exactly the ones a
 * browser entry writes, and the three clients it builds are compared to each
 * other, tool for tool, so "the browser arms do the same thing" is a claim
 * this file checks rather than one it makes.
 *
 * Not portable, and said out loud: `transport: 'stdio'` spawns a subprocess,
 * and `mcpServe` (used here to have something to talk to) listens on a Node
 * socket. Neither can run in a browser, and both refuse in words there.
 *
 * Run:  npm run example examples/context-engineering/22-mcp-in-a-browser.ts
 */

// The two static imports a browser entry writes. The subpaths are not
// optional: the SDK's root export does not resolve, and `client/stdio.js` is
// the one client module that imports Node.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { defineTool, type LLMProvider } from '../../src/index.js';
import { mcpClient, mcpServe, retryingFetch } from '../../src/doors/providers.js';
import type { McpClient } from '../../src/lib/mcp/types.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/22-mcp-in-a-browser',
  title: 'MCP from a browser — supply the SDK, or the connection',
  group: 'context-engineering',
  description:
    'A browser has no Node require loader, so hand mcpClient the two SDK modules ' +
    '(`sdk`) or a client you connected yourself (`connection`). Both produce the ' +
    'same Tool[]; options a transport would have consumed are refused, not ignored.',
  defaultInput: 'fc1/3',
  providerSlots: [],
  tags: ['context-engineering', 'mcp', 'browser', 'tools', 'integration'],
};

export async function run(input: string, _provider?: LLMProvider): Promise<string> {
  const port = defineTool<{ port: string }, string>({
    name: 'port_status',
    description: 'Reads the status of one port.',
    inputSchema: {
      type: 'object',
      properties: { port: { type: 'string' } },
      required: ['port'],
    },
    resultKind: 'dataset/ports',
    execute: ({ port: id }) => `port ${id}: online`,
  });

  // Something to talk to. In the real deployment this is your sidecar, and it
  // is the app's job — not the library's — to answer the CORS preflight every
  // MCP request makes and to expose `Mcp-Session-Id`.
  const server = await mcpServe([port], {
    name: 'fabric-desk',
    version: '1.0.0',
    transport: { transport: 'http', port: 0, host: '127.0.0.1' },
  });
  const url = `http://127.0.0.1:${server.port}/mcp`;
  const clients: McpClient[] = [];

  try {
    // #region sdk-arm
    // ── Arm 1: give it the modules. The library still builds the transport,
    //    so `headers`, your own `fetch` and throttle retry all keep working.
    const viaSdk = await mcpClient({
      name: 'sidecar',
      sdk: { Client, StreamableHTTPClientTransport },
      transport: { transport: 'http', url, headers: { 'x-tenant': 'acme' } },
    });
    // #endregion sdk-arm
    clients.push(viaSdk);

    // #region connection-arm
    // ── Arm 2: give it the whole connection. Nothing is constructed here by
    //    the library — which is what lets you pass the SDK's own
    //    `jsonSchemaValidator`, and why `retryingFetch` is public: on this arm
    //    the 429 handling is yours to apply.
    const connection = new Client({ name: 'browser', version: '1.0.0' }, { capabilities: {} });
    await connection.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        fetch: retryingFetch(undefined, { maxAttempts: 5 }),
      }),
    );
    const viaConnection = await mcpClient({ name: 'sidecar', connection });
    // #endregion connection-arm
    clients.push(viaConnection);

    // ── And the arm every Node consumer already uses, unchanged.
    const viaLoader = await mcpClient({ name: 'sidecar', transport: { transport: 'http', url } });
    clients.push(viaLoader);

    const shapeOf = async (client: McpClient): Promise<string> =>
      JSON.stringify(
        (await client.tools()).map((t) => ({
          name: t.schema.name,
          source: t.source,
          resultKind: t.resultKind,
        })),
      );

    const baseline = await shapeOf(viaLoader);
    console.log(`the Node loader arm  → ${baseline}`);
    console.log(`the sdk arm          → ${await shapeOf(viaSdk)}`);
    console.log(`the connection arm   → ${await shapeOf(viaConnection)}`);
    console.log(
      `\nall three agree      → ${
        (await shapeOf(viaSdk)) === baseline && (await shapeOf(viaConnection)) === baseline
      }`,
    );

    // ── The declarations ride MCP's `_meta` bag either way, so an integrity
    //    check armed by a remote declaration arms on every arm.
    const tool = (await viaSdk.tools()).find((t) => t.schema.name === 'port_status')!;
    // The agent supplies the second argument (the execution context); an MCP
    // tool reads none of it, so an example calling one directly passes nothing.
    const answer = String(await tool.execute({ port: input.trim() || 'fc1/3' }, {} as never));
    console.log(`\ntools/call port_status → ${answer}`);

    // ── An option a transport would have consumed is REFUSED on the
    //    connection arm, not accepted and quietly ignored. `retryOnThrottle`
    //    is the sharp one: it is ON by default everywhere else.
    try {
      await mcpClient({ connection, retryOnThrottle: { maxAttempts: 5 } } as never);
    } catch (error) {
      console.log(`\nRefused at construction:\n  ${(error as Error).message}`);
    }

    // ── And a relative url, which is what a same-origin sidecar looks like,
    //    resolves against the page in a browser and is refused BY NAME here.
    try {
      await mcpClient({
        sdk: { Client, StreamableHTTPClientTransport },
        transport: { transport: 'http', url: '/py/mcp' },
      });
    } catch (error) {
      console.log(`\nIn Node, a relative url says so:\n  ${(error as Error).message}`);
    }

    return answer;
  } finally {
    while (clients.length) await clients.pop()!.close();
    await server.close();
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

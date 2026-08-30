/**
 * Compile-level regression test — the two ports the browser seams rest on.
 *
 * `mcpClient({ sdk })` and `mcpClient({ connection })` both work by taking the
 * SDK's own objects and passing them through a STRUCTURAL type this library
 * declares. Nothing checks that the structure still matches except a compiler,
 * and nothing runs that compiler over the pairing except this file (it lives
 * under ./tsconfig.json, run by `npm run test:types`; its name also matches
 * `test/**\/*.test.ts` so `npm test` runs the runtime assertions).
 *
 * Both assignments below pass against @modelcontextprotocol/sdk 1.30.0. The
 * value of the file is the day they stop: an SDK upgrade that changes either
 * shape becomes a RED BUILD here, instead of a compile error in a consumer's
 * app with no clue whose fault it is.
 *
 * Three things are pinned:
 *
 *   1. a real SDK `Client` is an `McpConnection` AND an `McpSdkClient`;
 *   2. `{ Client, StreamableHTTPClientTransport }` is an `McpSdk` — the exact
 *      object the documented two-import snippet produces;
 *   3. `McpConnection` has NO `connect`. That absence is the contract: the
 *      library must never call `connect()` on a client somebody else already
 *      connected, and a type that carried the method would let it.
 */
import { describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { McpConnection, McpSdk, McpSdkClient } from '../../src/tool-providers/index';

// ─── 1. The SDK's client satisfies both ports ─────────────────────

const realClient = new Client({ name: 'af-test', version: '0.0.0' }, { capabilities: {} });

/** The handed-over half: three methods, no `connect`. */
const asConnection: McpConnection = realClient;

/** The library-built half: the same three plus the one it calls itself. */
const asSdkClient: McpSdkClient = realClient;

/** And the narrower port accepts the wider one, which is what makes the split free. */
const widenedToConnection: McpConnection = asSdkClient;

// ─── 2. The two modules, exactly as the docs tell you to import them ──

const modules: McpSdk = { Client, StreamableHTTPClientTransport };

/**
 * The transport really is constructible through the shim's signature — the
 * `new URL(...)` first argument and the optional `{ requestInit, fetch }`
 * second, which is the whole surface `buildTransport` uses.
 */
function buildThroughTheShim(sdk: McpSdk): unknown {
  return new sdk.StreamableHTTPClientTransport(new URL('https://example.invalid/mcp'), {
    requestInit: { headers: { 'x-tenant': 'acme' } },
    fetch: (url, init) => fetch(url, init),
  });
}

// ─── 3. `connect` is absent from the connection port, on purpose ──

function neverConnects(connection: McpConnection): unknown {
  // @ts-expect-error — `connect` is deliberately NOT on `McpConnection`. A
  // connection you handed over is already connected, and the library calling
  // `connect()` on it a second time is the bug this absence prevents. If this
  // line ever stops erroring, the split has been undone.
  return connection.connect;
}

/** A fake with the three methods is a connection — no vendor anywhere in it. */
const handWritten: McpConnection = {
  listTools: () => Promise.resolve({ tools: [] }),
  callTool: () => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] }),
  close: () => Promise.resolve(),
};

describe('McpConnection / McpSdk — type regressions against the real SDK', () => {
  it("the SDK's Client satisfies both ports, and the wider one widens", () => {
    expect(typeof asConnection.listTools).toBe('function');
    expect(typeof asConnection.callTool).toBe('function');
    expect(typeof asConnection.close).toBe('function');
    expect(typeof asSdkClient.connect).toBe('function');
    expect(widenedToConnection).toBe(realClient);
  });

  it('the two documented imports really are an McpSdk, and the transport builds through it', () => {
    expect(modules.Client).toBe(Client);
    expect(modules.StreamableHTTPClientTransport).toBe(StreamableHTTPClientTransport);
    expect(buildThroughTheShim(modules)).toBeInstanceOf(StreamableHTTPClientTransport);
  });

  it('a hand-written connection needs no vendor code at all', async () => {
    expect(await handWritten.listTools()).toEqual({ tools: [] });
    expect(typeof neverConnects).toBe('function');
  });
});

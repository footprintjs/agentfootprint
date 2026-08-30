/**
 * `transport.url` is read the way the runtime it runs in would read it.
 *
 * The second, independent browser blocker — and the one nobody would have
 * guessed, because it is not about the SDK at all. `new URL('/py/mcp')` throws
 * `TypeError: Invalid URL`, which is correct in Node (no document, no base) and
 * wrong in a browser (a page HAS a base, and a same-origin path is the ordinary
 * way to reach a sidecar without a CORS preflight at all). Before this, a
 * browser consumer's first attempt died inside the transport constructor with a
 * message naming neither the url nor the fix.
 *
 * The back-compat half matters as much as the fix: an absolute url takes the
 * identical first branch it always took, so Node behaviour cannot have moved.
 */

import { describe, expect, it } from 'vitest';

import { mcpClient } from '../../../src/tool-providers/index.js';
import { transportUrl } from '../../../src/lib/mcp/transportUrl.js';
import type { McpSdk } from '../../../src/lib/mcp/types.js';

// ─── A stubbed page ───────────────────────────────────────────────

const NO_LOCATION = Symbol('absent');

function withLocation(href: string | typeof NO_LOCATION, run: () => void): void {
  const holder = globalThis as { location?: unknown };
  const had = 'location' in holder;
  const previous = holder.location;
  if (href === NO_LOCATION) delete holder.location;
  else holder.location = { href };
  try {
    run();
  } finally {
    if (had) holder.location = previous;
    else delete holder.location;
  }
}

// ─── The rule ─────────────────────────────────────────────────────

describe('transportUrl', () => {
  it('the premise: a bare path is not a URL, which is why this function exists', () => {
    expect(() => new URL('/py/mcp')).toThrow(TypeError);
  });

  it('resolves a relative path against the document base', () => {
    withLocation('http://localhost:5219/app/index.html', () => {
      expect(transportUrl('/py/mcp', 'mcpClient').href).toBe('http://localhost:5219/py/mcp');
      expect(transportUrl('mcp', 'mcpClient').href).toBe('http://localhost:5219/app/mcp');
    });
  });

  it('LAW: an absolute url takes the identical first branch, base or no base', () => {
    const absolute = 'https://gateway.example.invalid/mcp';
    withLocation('http://localhost:5219/', () => {
      expect(transportUrl(absolute, 'mcpClient').href).toBe(`${absolute}`);
    });
    withLocation(NO_LOCATION, () => {
      expect(transportUrl(absolute, 'mcpClient').href).toBe(`${absolute}`);
    });
  });

  it('refuses in Node, naming which world it is in and what to pass', () => {
    withLocation(NO_LOCATION, () => {
      expect(() => transportUrl('/py/mcp', 'mcpClient')).toThrow(
        /mcpClient: transport\.url "\/py\/mcp" is not an absolute URL/,
      );
      expect(() => transportUrl('/py/mcp', 'mcpClient')).toThrow(
        /no document base to resolve it against \(Node, a worker, a test\)/,
      );
      expect(() => transportUrl('/py/mcp', 'mcpClient')).toThrow(/Pass an absolute URL/);
    });
  });

  it('survives a runtime whose `location` is present but useless', () => {
    // A worker double, a jsdom stub with no href, a sandboxed frame. Reading
    // it must degrade to the Node refusal, never crash on the way there.
    withLocation('', () => {
      expect(() => transportUrl('/py/mcp', 'mcpClient')).toThrow(/no document base/);
    });
  });
});

// ─── Through mcpClient, which is where it is actually reached ─────

describe('mcpClient — a relative transport.url', () => {
  const builds: { url: URL }[] = [];

  function fakeSdk(): McpSdk {
    return {
      Client: class {
        listTools = async () => ({ tools: [] });
        callTool = async () => ({ content: [] });
        close = async () => {};
        connect = async (): Promise<void> => {};
      } as unknown as McpSdk['Client'],
      StreamableHTTPClientTransport: class {
        constructor(readonly url: URL) {
          builds.push(this);
        }
      } as unknown as McpSdk['StreamableHTTPClientTransport'],
    };
  }

  it('reaches the transport already resolved against the page', async () => {
    let client: { close(): Promise<void> } | undefined;
    const sdk = fakeSdk();
    const holder = globalThis as { location?: unknown };
    const had = 'location' in holder;
    const previous = holder.location;
    holder.location = { href: 'http://localhost:5219/index.html' };
    try {
      client = await mcpClient({
        sdk,
        transport: { transport: 'http', url: '/py/mcp' },
      });
      expect(builds.at(-1)!.url.href).toBe('http://localhost:5219/py/mcp');
    } finally {
      if (had) holder.location = previous;
      else delete holder.location;
      await client?.close();
    }
  });

  it('in Node the refusal names mcpClient, not a bare TypeError', async () => {
    await expect(
      mcpClient({ sdk: fakeSdk(), transport: { transport: 'http', url: '/py/mcp' } }),
    ).rejects.toThrow(/mcpClient: transport\.url "\/py\/mcp" is not an absolute URL/);
  });
});

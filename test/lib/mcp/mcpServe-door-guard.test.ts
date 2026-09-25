/**
 * mcpServe over HTTP keeps the hosting door guard — over a real socket, with
 * the real MCP SDK behind it.
 *
 * ── Why this door is in the door-hardening packet ───────────────────────────
 * `mcpServe({ transport: { transport: 'http' } })` is a door this library
 * ships: it runs tools for whoever reaches the port. The MCP transport
 * specification (2025-06-18, Streamable HTTP, "Security Warning") says servers
 * "MUST validate the `Origin` header on all incoming connections to prevent DNS
 * rebinding attacks". Before this change nothing did — the SDK's own
 * `enableDnsRebindingProtection` defaults to off — so a page that re-pointed
 * its own name at the port could list and CALL tools and read the results.
 *
 * The laws pinned (the same rules, the same owner, as `httpHost`):
 *   • a foreign `Origin` (or `null`) is refused before any tool runs — 403;
 *   • with `allowedHosts`, a Host the endpoint was not configured for is
 *     refused before any tool runs — 421;
 *   • a native client (the SDK's own, no `Origin`) is served exactly as before;
 *   • the refusal speaks the SDK's JSON-RPC error shape and never repeats what
 *     the caller sent;
 *   • configuration that could only be a mistake is refused at start;
 *   • `allowedHosts` unset prints ONE warning naming it.
 */

import { request as httpRequest } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { defineTool } from '../../../src/index.js';
import type { Tool } from '../../../src/core/tools.js';
import { mcpServe } from '../../../src/tool-providers/index.js';
import type { McpHttpServeTransport, McpServeHandle } from '../../../src/lib/mcp/types.js';
import { REAL_TRANSPORT_TIMEOUT } from './realTransportSupport.js';

const open: McpServeHandle[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((handle) => handle.close()));
  vi.restoreAllMocks();
});

/** One tool that counts every time it actually runs. */
function countingTools(): { tools: Tool[]; runs: () => number } {
  let runs = 0;
  const ping = defineTool<Record<string, never>, string>({
    name: 'ping',
    description: 'Answer pong',
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      runs += 1;
      return 'pong';
    },
  });
  return { tools: [ping], runs: () => runs };
}

async function serve(
  extra: Partial<Pick<McpHttpServeTransport, 'allowedOrigins' | 'allowedHosts' | 'host'>> = {},
): Promise<{ port: number; runs: () => number }> {
  const { tools, runs } = countingTools();
  const handle = await mcpServe(tools, {
    name: 'door-guard',
    transport: { transport: 'http', port: 0, host: '127.0.0.1', ...extra },
  });
  open.push(handle);
  return { port: handle.port!, runs };
}

/** A raw JSON-RPC `tools/call` — every header, `Host` included, under the test's control. */
function callPing(
  port: number,
  headers: Readonly<Record<string, string>> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/mcp',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'ping', arguments: {} },
      }),
    );
  });
}

describe('mcpServe(http) — the door guard in front of the tools', () => {
  it(
    'refuses a foreign Origin before any tool runs, in the JSON-RPC error shape (403)',
    async () => {
      const { port, runs } = await serve();
      const refused = await callPing(port, { origin: 'https://evil.example' });
      expect(refused.status).toBe(403);
      const body = JSON.parse(refused.body) as {
        jsonrpc: string;
        error: { code: number; message: string; data: { code: string } };
      };
      expect(body.jsonrpc).toBe('2.0');
      expect(body.error.data.code).toBe('ERR_ORIGIN_NOT_ALLOWED');
      expect(body.error.message).not.toContain('evil.example');
      expect((await callPing(port, { origin: 'null' })).status).toBe(403);
      expect(runs()).toBe(0);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'refuses the rebinding shape (Host = the attacker name) once allowedHosts is set (421)',
    async () => {
      const { port, runs } = await serve({ allowedHosts: ['127.0.0.1'] });
      const rebinding = await callPing(port, {
        host: `rebind.evil.example:${port}`,
        origin: `http://rebind.evil.example:${port}`,
      });
      expect(rebinding.status).toBe(421);
      expect(runs()).toBe(0);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'serves the SDK’s own client unchanged — a native client sends no Origin',
    async () => {
      const { port, runs } = await serve({ allowedHosts: ['127.0.0.1'] });
      const client = new Client(
        { name: 'door-guard-test', version: '1.0.0' },
        { capabilities: {} },
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
      );
      try {
        const result = (await client.callTool({ name: 'ping', arguments: {} })) as {
          content: { text?: string }[];
        };
        expect(result.content[0]?.text).toBe('pong');
        expect(runs()).toBe(1);
      } finally {
        await client.close();
      }
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'a page on the endpoint’s own host is served; so is a listed origin',
    async () => {
      const same = await serve();
      const own = await callPing(same.port, { origin: `http://127.0.0.1:${same.port}` });
      expect(own.status).toBe(200);
      const listed = await serve({ allowedOrigins: ['https://tools.corp.example'] });
      const partner = await callPing(listed.port, { origin: 'https://tools.corp.example' });
      expect(partner.status).toBe(200);
      expect(same.runs() + listed.runs()).toBe(2);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'a LOOPBACK bind refuses the classic rebinding tools/call with no options at all (421)',
    async () => {
      // The attack the transport spec's MUST exists for: a page re-points its
      // name at 127.0.0.1 and is then same-origin with the server.
      const { port, runs } = await serve();
      const rebinding = await callPing(port, {
        host: `rebind.evil.example:${port}`,
        origin: `http://rebind.evil.example:${port}`,
      });
      expect(rebinding.status).toBe(421);
      expect(runs()).toBe(0);
      for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
        expect((await callPing(port, { host })).status).toBe(200);
      }
      expect(runs()).toBe(2);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'owns the JSON rule itself — a text/plain POST is the library’s 415, whatever the SDK version',
    async () => {
      const { port, runs } = await serve();
      const refused = await callPing(port, { 'content-type': 'text/plain;charset=UTF-8' });
      expect(refused.status).toBe(415);
      const body = JSON.parse(refused.body) as { error: { data: { code: string } } };
      expect(body.error.data.code).toBe('ERR_UNSUPPORTED_MEDIA_TYPE');
      expect(runs()).toBe(0);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it('refuses configuration that could only be a mistake, before a socket exists', async () => {
    const { tools } = countingTools();
    await expect(
      mcpServe(tools, { transport: { transport: 'http', port: 0, allowedHosts: [] } }),
    ).rejects.toThrow(/every request/);
    await expect(
      mcpServe(tools, { transport: { transport: 'http', port: 0, allowedOrigins: ['null'] } }),
    ).rejects.toThrow(/null/);
  });

  it(
    'prints one warning naming allowedHosts when it is unset, and none when it is set',
    async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const aboutHosts = () =>
        warn.mock.calls.filter((call) => String(call[0]).includes('allowedHosts')).length;
      const { tools } = countingTools();
      const unique = `door-guard-warn-${Date.now()}`;
      for (let i = 0; i < 2; i++) {
        open.push(
          await mcpServe(tools, {
            name: unique,
            transport: { transport: 'http', port: 0, host: '0.0.0.0' },
          }),
        );
      }
      expect(aboutHosts()).toBe(1);
      // A loopback bind is silent: its loopback names ARE its allowedHosts.
      open.push(
        await mcpServe(tools, {
          name: `${unique}-loopback`,
          transport: { transport: 'http', port: 0, host: '127.0.0.1' },
        }),
      );
      expect(aboutHosts()).toBe(1);
      open.push(
        await mcpServe(tools, {
          name: `${unique}-set`,
          transport: { transport: 'http', port: 0, host: '127.0.0.1', allowedHosts: ['127.0.0.1'] },
        }),
      );
      expect(aboutHosts()).toBe(1);
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

/**
 * MCP tool declarations over a REAL socket — `mcpServe` → wire → `mcpClient`.
 *
 * `mcpToolExtras.test.ts` injects both ends and pins the logic in
 * milliseconds. It cannot answer the one question that decides whether the
 * carrier works at all: does `_meta` survive @modelcontextprotocol/sdk's own
 * `tools/list` validation, in both directions? The SDK parses every listing
 * through `ToolSchema`, and a field that schema drops would vanish silently —
 * every injected test still green, every real server still mute.
 *
 * So this file serves on a real port with the real SDK, connects with our own
 * `mcpClient` over Streamable HTTP, and reads the declarations off the
 * registered `Tool`. Both halves of the round trip are this library's code;
 * the protocol between them is somebody else's.
 *
 * Test types (Convention 3): integration (the five fields, end to end) ·
 * regression (a tool declaring nothing sends no bag over the wire either).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { defineTool } from '../../../src/index.js';
import { mcpClient, mcpServe } from '../../../src/tool-providers/index.js';
import type { McpClient } from '../../../src/lib/mcp/types.js';
import type { McpServeHandle } from '../../../src/lib/mcp/types.js';
import { REAL_TRANSPORT_TIMEOUT } from './realTransportSupport.js';

const declaring = defineTool({
  name: 'backup_status',
  description: 'Reads the backup record for one machine.',
  inputSchema: {
    type: 'object',
    properties: { machine: { type: 'string' } },
    required: ['machine'],
  },
  argumentsFrom: ['fleet_report'],
  resultKind: 'dataset/backups',
  owner: { kind: 'registry', id: 'fleet-desk' },
  resultClass: 'triage',
  resultCeiling: { maxChars: 4_000, narrowBy: ['machine'] },
  execute: () => 'no backup record found',
});

const silent = defineTool({
  name: 'fleet_report',
  description: 'Lists the machines in the fleet.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'FLEET: callisto-02',
});

const servers: McpServeHandle[] = [];
const clients: McpClient[] = [];

afterEach(async () => {
  while (clients.length) await clients.pop()!.close();
  while (servers.length) await servers.pop()!.close();
});

/** Serve on any free port, then connect our own client to the port it bound. */
async function roundTrip(tools: Parameters<typeof mcpServe>[0]): Promise<McpClient> {
  const handle = await mcpServe(tools, {
    name: 'fleet-desk',
    version: '1.0.0',
    transport: { transport: 'http', port: 0, host: '127.0.0.1' },
  });
  servers.push(handle);
  const client = await mcpClient({
    name: 'fleet-mcp',
    transport: { transport: 'http', url: `http://127.0.0.1:${handle.port}/mcp` },
  });
  clients.push(client);
  return client;
}

describe('integration — the declarations survive a real MCP round trip', () => {
  it(
    'all five come back byte-equal on the registered Tool',
    async () => {
      const client = await roundTrip([declaring, silent]);
      const tools = await client.tools();
      const remote = tools.find((t) => t.schema.name === 'backup_status')!;

      expect(remote.argumentsFrom).toEqual(['fleet_report']);
      expect(remote.resultKind).toBe('dataset/backups');
      expect(remote.owner).toEqual({ kind: 'registry', id: 'fleet-desk' });
      expect(remote.resultClass).toBe('triage');
      expect(remote.resultCeiling).toEqual({ maxChars: 4_000, narrowBy: ['machine'] });
      // Provenance still says which server, exactly as before.
      expect(remote.source).toBe('fleet-mcp');
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'a tool that declares nothing carries nothing across — no keys invented on the way',
    async () => {
      const client = await roundTrip([declaring, silent]);
      const tools = await client.tools();
      const plain = tools.find((t) => t.schema.name === 'fleet_report')!;
      expect(Object.keys(plain).sort()).toEqual(['execute', 'schema', 'source']);
    },
    REAL_TRANSPORT_TIMEOUT,
  );

  it(
    'and the tool still WORKS — the bag rode beside the call path, not through it',
    async () => {
      const client = await roundTrip([declaring, silent]);
      const tools = await client.tools();
      const remote = tools.find((t) => t.schema.name === 'backup_status')!;
      const result = await remote.execute({ machine: 'callisto-02' } as never, {} as never);
      expect(result).toBe('no backup record found');
    },
    REAL_TRANSPORT_TIMEOUT,
  );
});

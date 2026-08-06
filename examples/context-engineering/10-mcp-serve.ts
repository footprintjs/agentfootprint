/**
 * 10 — MCP, the other direction: `mcpServe`.
 *
 * `mcpClient` pulls someone else's tools into your agent. `mcpServe`
 * pushes yours out, so the tool you already wrote, tested and governed
 * can be called by any MCP client — a desktop host, another team's
 * agent, an IDE.
 *
 * Production usage (a real stdio server, the shape an MCP host expects):
 *
 *   const handle = await mcpServe([lookupOrder, refundOrder], {
 *     name: 'support-desk',
 *     version: '1.0.0',
 *   });
 *   process.on('SIGINT', () => void handle.close());
 *
 * This example injects a fake SDK server (`_server`) so it runs
 * end-to-end without @modelcontextprotocol/sdk installed and without
 * seizing this process's stdio. The handlers exercised below are
 * exactly the ones a real client's `tools/list` and `tools/call`
 * requests reach.
 *
 * Run:  npm run example examples/context-engineering/10-mcp-serve.ts
 */

import { defineTool, type LLMProvider, type Tool } from '../../src/index.js';
import { mcpServe } from '../../src/doors/providers.js';
import { PermissionPolicy } from '../../src/doors/security.js';
import type { McpCallToolRequest, McpSdkServer } from '../../src/lib/mcp/types.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/10-mcp-serve',
  title: 'MCP — serve your tools to other clients',
  group: 'context-engineering',
  description:
    'Expose agentfootprint Tool[] AS an MCP server. Schemas map 1:1, the served ' +
    'tool is the same object, so governance you wrapped around it still runs.',
  defaultInput: 'lookup order 5512',
  providerSlots: [],
  tags: ['context-engineering', 'mcp', 'tools', 'integration', 'governance'],
};

/**
 * A stand-in for the SDK's low-level `Server`: it captures the two
 * request handlers so this example can call them the way a client would.
 */
function fakeSdkServer() {
  const handlers = new Map<string, (req: McpCallToolRequest, extra: object) => unknown>();
  const server: McpSdkServer & {
    list: () => Promise<{ tools: { name: string; description?: string }[] }>;
    call: (name: string, args: unknown) => Promise<{
      content: { type: string; text: string }[];
      isError?: boolean;
    }>;
  } = {
    setRequestHandler: (schema, handler) =>
      handlers.set((schema as { method: string }).method, handler),
    connect: async () => {},
    close: async () => {},
    list: async () => (await handlers.get('tools/list')?.({}, {})) as never,
    call: async (name, args) =>
      (await handlers.get('tools/call')?.({ params: { name, arguments: args } }, {})) as never,
  };
  return server;
}

export async function run(input: string, _provider?: LLMProvider): Promise<string> {
  // ── The tools. Ordinary agentfootprint tools — nothing MCP-shaped. ──
  const orders: Record<string, string> = {
    '5512': 'order 5512 — 2 items, delivered 2026-07-30',
  };

  // The consumer's own governance lives INSIDE execute. This is the
  // thing serving must not be able to route around.
  const policy = PermissionPolicy.fromRoles(
    { readonly: ['lookup_order'], admin: ['lookup_order', 'refund_order'] },
    'readonly',
  );
  const guarded = (inner: Tool): Tool => ({
    ...inner,
    execute: (args, ctx) =>
      policy.isAllowed(inner.schema.name)
        ? inner.execute(args, ctx)
        : `denied: '${inner.schema.name}' is not permitted for this role`,
  });

  const lookupOrder = guarded(
    defineTool<{ id: string }, string>({
      name: 'lookup_order',
      description: 'Look up an order by id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: ({ id }) => orders[id] ?? `no order '${id}'`,
    }),
  );
  const refundOrder = guarded(
    defineTool<{ id: string }, string>({
      name: 'refund_order',
      description: 'Refund an order by id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      execute: ({ id }) => `refunded ${id}`,
    }),
  );

  // #region serve
  const sdk = fakeSdkServer();
  const handle = await mcpServe([lookupOrder, refundOrder], {
    name: 'support-desk',
    version: '1.0.0',
    _server: sdk, // ← test injection; remove for a real stdio/http server
  });
  // #endregion serve

  console.log(`Serving ${handle.toolNames.length} tools as '${handle.name}':`);
  const listed = await sdk.list();
  for (const tool of listed.tools) console.log(`  - ${tool.name}: ${tool.description}`);

  // ── A client calls a tool. Schemas mapped 1:1; execute runs as usual.
  const id = input.match(/\d+/)?.[0] ?? '5512';
  const found = await sdk.call('lookup_order', { id });
  console.log(`\ntools/call lookup_order → ${found.content[0]?.text}`);

  // ── The permission wrapper is NOT bypassed by serving. ──
  const refused = await sdk.call('refund_order', { id });
  console.log(`tools/call refund_order → ${refused.content[0]?.text}`);

  // ── A hostile client is the tool's problem, never the loop's. ──
  const unknown = await sdk.call('rm_rf', { path: '/' });
  console.log(`\ntools/call rm_rf → isError=${unknown.isError}: ${unknown.content[0]?.text}`);
  const garbage = await sdk.call('lookup_order', 'not-an-object');
  console.log(`tools/call lookup_order("not-an-object") → ${garbage.content[0]?.text}`);
  const stillAlive = await sdk.call('lookup_order', { id });
  console.log(`server still answering → ${stillAlive.content[0]?.text}`);

  // ── Demands MCP cannot keep are refused at construction, not dropped.
  try {
    await mcpServe(
      [
        defineTool({
          name: 'wire_transfer',
          description: 'Send money',
          checkIn: 'always',
          execute: () => 'sent',
        }),
      ],
      { _server: fakeSdkServer() },
    );
  } catch (error) {
    console.log(`\nRefused at construction:\n  ${(error as Error).message}`);
  }

  await handle.close();
  return found.content[0]?.text ?? '';
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

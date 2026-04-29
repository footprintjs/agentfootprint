/**
 * 08 — MCP: connect to a Model Context Protocol server, register
 * its tools on your Agent.
 *
 * Production usage (real MCP server):
 *
 *   const slack = await mcpClient({
 *     name: 'slack',
 *     transport: { transport: 'stdio', command: 'npx', args: ['@example/slack-mcp'] },
 *   });
 *   const agent = Agent.create({ provider }).tools(await slack.tools()).build();
 *
 * This example uses an injected MOCK SDK client (`_client`) so it
 * runs end-to-end without a real MCP server installed. The flow is
 * identical to the production path.
 */

import { Agent, mcpClient, mock, type LLMProvider } from '../../src/index.js';
import type { McpSdkClient } from '../../src/lib/mcp/types.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/08-mcp',
  title: 'MCP — Model Context Protocol client',
  group: 'context-engineering',
  description:
    'Connect to an MCP server, expose its tools as agentfootprint Tool[]. ' +
    'Lazy-required @modelcontextprotocol/sdk peer-dep — zero runtime cost ' +
    'when MCP isn\'t used.',
  defaultInput: 'List files in /tmp',
  providerSlots: ['default'],
  tags: ['context-engineering', 'mcp', 'tools', 'integration'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // ── Mock MCP server: pretends to expose `list_files` + `read_file`.
  // In production, replace `_client: makeFakeServer()` with a stdio /
  // http transport that points at a real MCP server.
  const fakeServer: McpSdkClient = {
    connect: async () => {},
    listTools: async () => ({
      tools: [
        {
          name: 'list_files',
          description: 'List files in a directory.',
          inputSchema: {
            type: 'object',
            properties: { dir: { type: 'string' } },
            required: ['dir'],
          },
        },
        {
          name: 'read_file',
          description: 'Read the contents of a file.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
    }),
    callTool: async ({ name, arguments: args }) => {
      if (name === 'list_files') {
        const dir = (args as { dir: string }).dir;
        return { content: [{ type: 'text', text: `${dir}/notes.md\n${dir}/todo.txt` }] };
      }
      if (name === 'read_file') {
        return { content: [{ type: 'text', text: 'file contents here' }] };
      }
      return { content: [{ type: 'text', text: 'unknown tool' }], isError: true };
    },
    close: async () => {},
  };

  // Connect once at startup. In production: use a real transport.
  const fileServer = await mcpClient({
    name: 'file-server',
    transport: { transport: 'stdio', command: 'npx', args: ['fake-mcp'] },
    _client: fakeServer, // ← test injection; remove for real MCP
  });

  // Agent picks up all the server's tools at once.
  const agent = Agent.create({
    provider: provider ?? mock({ reply: '/tmp/notes.md and /tmp/todo.txt are present.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You answer file-system questions using the MCP tools provided.')
    .tools(await fileServer.tools())
    .build();

  const result = await agent.run({ message: input });
  await fileServer.close();
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

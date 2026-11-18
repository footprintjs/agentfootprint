// Verifier probe: does a resultColumns declaration arm column-types when the tool
// arrives via .toolProvider(staticTools(...)) (the tools page's wiring) vs .tools()/.tool()?
// Variants include a real mcpClient (synthetic connection) carrying resultColumns in _meta.
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
const OUT = '/private/tmp/claude-501/-Users-sanjay-github-footprintjs-footPrint/2277452c-fabb-4523-b571-bcb026555186/scratchpad/agents/af-patch/docs-high/agentfootprint/../probe-019-8.out.txt';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { staticTools, gatedTools } from '../../src/tool-providers/index.js';
import { mcpClient } from '../../src/mcp/mcpClient.js';
import type { McpCallToolResult, McpConnection } from '../../src/mcp/types.js';

let calls = 0;
const rows = [
  { logical_unit_number: '', host_group: 'vdi-a' },
  { logical_unit_number: 3, host_group: 'vdi-a' },
];
const localTool = () =>
  defineTool({
    name: 'host_group_mappings',
    description: 'The LUN mappings of a host group.',
    inputSchema: { type: 'object', properties: {} },
    resultColumns: { logical_unit_number: 'number', host_group: 'string' },
    execute: async () => { calls++; return rows; },
  });
async function mcpTools() {
  const connection: McpConnection = {
    listTools: async () => ({
      tools: [
        {
          name: 'host_group_mappings',
          description: 'The LUN mappings of a host group.',
          inputSchema: { type: 'object', properties: {} },
          _meta: { agentfootprint: { resultColumns: { logical_unit_number: 'number', host_group: 'string' } } },
        },
      ],
    }),
    callTool: async () => ({ content: [{ type: 'text', text: 'mirror' }], structuredContent: { rows } } as unknown as McpCallToolResult),
    close: async () => {},
  };
  const client = await mcpClient({ name: 'files', connection, resultMode: 'structured' });
  const ts = await client.tools();
  // keep the MCP-carried declaration, return the rows as a bare array so readRowset can judge them
  return ts.map((t) => ({ ...t, execute: async () => { calls++; return rows; } }));
}
const replies = () => [
  { content: '', toolCalls: [{ id: 'c1', name: 'host_group_mappings', args: {} }], stopReason: 'tool_use' as const },
  { content: 'done', toolCalls: [], stopReason: 'stop' as const },
];
type Via = 'local .tool()' | 'local staticTools' | 'mcp .tools()' | 'mcp staticTools' | 'mcp gatedTools(staticTools)' | 'none';
async function run(via: Via) {
  calls = 0;
  const b = Agent.create({ provider: mock({ replies: replies() }), model: 'mock', maxIterations: 4, checkColumnTypes: 'warn' }).system('s');
  let built;
  if (via === 'local .tool()') built = b.tool(localTool());
  else if (via === 'local staticTools') built = b.toolProvider(staticTools([localTool()]));
  else if (via === 'mcp .tools()') built = b.tools(await mcpTools());
  else if (via === 'mcp staticTools') built = b.toolProvider(staticTools(await mcpTools()));
  else if (via === 'mcp gatedTools(staticTools)') built = b.toolProvider(gatedTools(staticTools(await mcpTools()), () => true));
  else built = b;
  const agent = built.build();
  const kinds: string[] = [];
  let rowsOut: Array<Record<string, unknown>> = [];
  const toolEnds: string[] = [];
  agent.on('agentfootprint.integrity.context_error', (e) => kinds.push(String((e.payload as { kind: string }).kind)));
  agent.on('agentfootprint.integrity.disposition', (e) => { rowsOut = e.payload.rows as unknown as Array<Record<string, unknown>>; });
  agent.on('agentfootprint.stream.tool_end' as never, (e: { payload: unknown }) => toolEnds.push(JSON.stringify(e.payload).slice(0, 160)));
  await agent.run('what are vdi-a mappings?');
  const col = rowsOut.filter((r) => JSON.stringify(r).includes('column'));
  return `== ${via}: findings=${JSON.stringify(kinds)} rowCount=${rowsOut.length} columnRows=${JSON.stringify(col)} executeCalls=${calls}`;
}
it('compares arming paths', async () => {
  writeFileSync(OUT, '');
  for (const via of ['local .tool()', 'local staticTools', 'mcp .tools()', 'mcp staticTools', 'mcp gatedTools(staticTools)', 'none'] as const) {
    appendFileSync(OUT, (await run(via)) + '\n');
  }
});

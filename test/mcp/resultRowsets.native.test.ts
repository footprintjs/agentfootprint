import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import { mock } from '../../src/providers.js';
import { mcpClient } from '../../src/tool-providers/index.js';
import { MCP_TOOL_EXTRAS_KEY } from '../../src/mcp/toolExtras.js';

describe('MCP metadata reaches actual native final rowset judgment', () => {
  it.each(['warn', 'enforce'] as const)(
    'a remote wrapper contract uses the native %s rail',
    async (mode) => {
      let lists = 0,
        calls = 0,
        served = '';
      const events: AgentfootprintEvent[] = [];
      const client = await mcpClient({
        name: 'rowset-fixture',
        transport: { transport: 'stdio', command: 'echo' },
        _client: {
          connect: async () => {},
          close: async () => {},
          async listTools() {
            lists++;
            return {
              tools: [
                {
                  name: 'remote_disks',
                  description: 'Read synthetic remote disks.',
                  inputSchema: { type: 'object', properties: {} },
                  _meta: {
                    [MCP_TOOL_EXTRAS_KEY]: {
                      resultRowsets: [
                        {
                          key: 'disks',
                          columns: { capacity_gb: 'number' },
                          source: { kind: 'inline', path: ['result', 'disks'] },
                        },
                      ],
                    },
                  },
                },
              ],
            };
          },
          async callTool() {
            calls++;
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    result: { disks: [{ capacity_gb: 0 }, { capacity_gb: 'wrong-type' }] },
                  }),
                },
              ],
            };
          },
        },
      });
      try {
        const tools = await client.tools();
        const agent = Agent.create({
          model: 'mock',
          checkColumnTypes: mode,
          integrityPosture: 'dev',
          provider: mock({
            respond(request) {
              const last = request.messages.at(-1);
              if (last?.role === 'tool') {
                served = last.content;
                return 'Observed.';
              }
              return { toolCalls: [{ id: 'remote', name: 'remote_disks', args: {} }] };
            },
          }),
        })
          .tools([...tools])
          .build();
        agent.on('*', (event) => events.push(event));
        await agent.run({ message: 'Read synthetic remote disks.' });
        expect(lists).toBe(1);
        expect(calls).toBe(1);
        expect(
          events
            .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
            .map((event) => event.payload),
        ).toMatchObject([
          {
            toolName: 'remote_disks',
            rowset: 'disks',
            disposition: 'checked-fail',
            delivery: mode === 'enforce' ? 'refused' : 'unchanged',
          },
        ]);
        expect(
          events
            .filter((event) => event.type === 'agentfootprint.integrity.context_error')
            .map((event) => event.payload),
        ).toMatchObject([
          { kind: 'column-type-mismatch', rowset: 'disks', predicate: 'capacity_gb' },
        ]);
        expect(served).toMatch(mode === 'enforce' ? /^Result rejected:/ : /wrong-type/);
      } finally {
        await client.close();
      }
    },
  );
});

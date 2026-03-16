/**
 * Sample 11: Protocol Adapters — MCP & A2A
 *
 * Bridge external protocols into agentfootprint's interfaces.
 *
 *   mcpToolProvider → MCP server tools become a ToolProvider
 *   a2aRunner       → A2A agent becomes a RunnerLike
 *
 * Both use interface-based adapters. You bring your own client
 * implementation — the adapter handles the mapping.
 */
import { describe, it, expect, vi } from 'vitest';
import { mcpToolProvider, a2aRunner } from '../../src/adapters';
import { agentAsTool, FlowChart, mock } from '../../src';
import type { MCPClient, A2AClient } from '../../src/adapters';

describe('Sample 11: Protocol Adapters', () => {
  describe('MCP — Model Context Protocol', () => {
    it('wraps MCP server tools as a ToolProvider', async () => {
      // Your MCP client talks to the server — adapter maps to ToolProvider
      const client: MCPClient = {
        listTools: async () => [
          { name: 'file_read', description: 'Read a file', inputSchema: { type: 'object' } },
          { name: 'file_write', description: 'Write a file', inputSchema: { type: 'object' } },
        ],
        callTool: async (name, args) => ({
          content: `${name}: ${JSON.stringify(args)}`,
        }),
      };

      const provider = mcpToolProvider({ client });

      // Resolve: see what tools are available
      const tools = await provider.resolve({
        message: '',
        turnNumber: 0,
        loopIteration: 0,
        messages: [],
      });
      expect(tools.map((t) => t.name)).toEqual(['file_read', 'file_write']);

      // Execute: call a tool
      const result = await provider.execute!({
        id: 'tc1',
        name: 'file_read',
        arguments: { path: '/tmp/test.txt' },
      });
      expect(result.content).toContain('file_read');
    });

    it('prefixes tool names to avoid collisions', async () => {
      const client: MCPClient = {
        listTools: async () => [{ name: 'search', description: 'Search' }],
        callTool: vi.fn(async () => ({ content: 'ok' })),
      };

      // Prefix prevents collision with your own 'search' tool
      const provider = mcpToolProvider({ client, prefix: 'github_' });

      const tools = await provider.resolve({
        message: '',
        turnNumber: 0,
        loopIteration: 0,
        messages: [],
      });
      expect(tools[0].name).toBe('github_search');

      // Execute strips the prefix before calling MCP
      await provider.execute!({ id: 'tc1', name: 'github_search', arguments: { q: 'test' } });
      expect(client.callTool).toHaveBeenCalledWith('search', { q: 'test' });
    });
  });

  describe('A2A — Agent-to-Agent', () => {
    it('wraps remote agent as a RunnerLike', async () => {
      const client: A2AClient = {
        sendMessage: async (agentId, message) => ({
          content: `[${agentId}] processed: ${message}`,
        }),
      };

      const remote = a2aRunner({ client, agentId: 'research-agent-v2' });

      // Use like any local runner
      const result = await remote.run('What is quantum computing?');
      expect(result.content).toBe('[research-agent-v2] processed: What is quantum computing?');
    });

    it('compose remote agents in a FlowChart', async () => {
      const remoteResearcher = a2aRunner({
        client: {
          sendMessage: async (_, msg) => ({ content: `Research: ${msg}` }),
        },
        agentId: 'researcher',
      });

      const localWriter = {
        run: async (msg: string) => ({ content: `Article based on: ${msg}` }),
      };

      const pipeline = FlowChart.create()
        .agent('remote-research', 'Research', remoteResearcher)
        .agent('local-write', 'Write', localWriter)
        .build();

      const result = await pipeline.run('AI trends');
      expect(result.content).toBeTruthy();
    });

    it('compose remote agent as a tool via agentAsTool', async () => {
      const remote = a2aRunner({
        client: {
          sendMessage: async (_, msg) => ({ content: `Translated: ${msg}` }),
        },
        agentId: 'translator',
      });

      const tool = agentAsTool({
        id: 'translate',
        description: 'Translate text to Spanish.',
        runner: remote,
      });

      const result = await tool.handler({ message: 'Hello world' });
      expect(result.content).toBe('Translated: Hello world');
    });
  });
});

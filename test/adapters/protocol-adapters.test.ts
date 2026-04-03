import { describe, it, expect, vi } from 'vitest';
import { mcpToolProvider, a2aRunner } from '../../src/adapters';
import type { MCPClient, A2AClient } from '../../src/adapters';

// ── Mock MCP Client ─────────────────────────────────────────

function mockMCPClient(overrides: Partial<MCPClient> = {}): MCPClient {
  return {
    listTools: vi.fn(async () => [
      {
        name: 'search',
        description: 'Search the web',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      },
      { name: 'calc', description: 'Calculate math' },
    ]),
    callTool: vi.fn(async (name, args) => ({
      content: `${name} result: ${JSON.stringify(args)}`,
    })),
    ...overrides,
  };
}

// ── Mock A2A Client ─────────────────────────────────────────

function mockA2AClient(overrides: Partial<A2AClient> = {}): A2AClient {
  return {
    sendMessage: vi.fn(async (agentId, message) => ({
      content: `[${agentId}] ${message}`,
    })),
    ...overrides,
  };
}

// ── mcpToolProvider ─────────────────────────────────────────

describe('mcpToolProvider', () => {
  it('resolves tools from MCP server', async () => {
    const client = mockMCPClient();
    const provider = mcpToolProvider({ client });

    const decision = await provider.resolve({
      message: 'test',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    });

    expect(decision.value).toHaveLength(2);
    expect(decision.value[0].name).toBe('search');
    expect(decision.value[0].description).toBe('Search the web');
    expect(decision.value[1].name).toBe('calc');
  });

  it('executes tool calls on MCP server', async () => {
    const client = mockMCPClient();
    const provider = mcpToolProvider({ client });

    const result = await provider.execute!({
      id: 'tc1',
      name: 'search',
      arguments: { q: 'hello' },
    });

    expect(client.callTool).toHaveBeenCalledWith('search', { q: 'hello' });
    expect(result.content).toContain('search result');
  });

  it('handles MCP errors', async () => {
    const client = mockMCPClient({
      callTool: async () => ({ content: 'Tool failed', isError: true }),
    });

    const provider = mcpToolProvider({ client });
    const result = await provider.execute!({ id: 'tc1', name: 'search', arguments: {} });

    expect(result.error).toBe(true);
    expect(result.content).toBe('Tool failed');
  });

  it('applies name prefix to avoid collisions', async () => {
    const client = mockMCPClient();
    const provider = mcpToolProvider({ client, prefix: 'mcp_' });

    const decision = await provider.resolve({
      message: 'test',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    });

    expect(decision.value[0].name).toBe('mcp_search');
    expect(decision.value[1].name).toBe('mcp_calc');

    // Execute should strip prefix
    await provider.execute!({ id: 'tc1', name: 'mcp_search', arguments: { q: 'test' } });
    expect(client.callTool).toHaveBeenCalledWith('search', { q: 'test' });
  });

  it('handles empty tool list', async () => {
    const client = mockMCPClient({ listTools: async () => [] });
    const provider = mcpToolProvider({ client });

    const decision = await provider.resolve({
      message: 'test',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    });

    expect(decision.value).toEqual([]);
  });
});

// ── a2aRunner ───────────────────────────────────────────────

describe('a2aRunner', () => {
  it('sends message to remote agent', async () => {
    const client = mockA2AClient();
    const runner = a2aRunner({ client, agentId: 'research-agent' });

    const result = await runner.run('What is AI?');

    expect(client.sendMessage).toHaveBeenCalledWith(
      'research-agent',
      'What is AI?',
      expect.any(Object),
    );
    expect(result.content).toBe('[research-agent] What is AI?');
  });

  it('propagates signal and timeoutMs', async () => {
    const client = mockA2AClient();
    const controller = new AbortController();
    const runner = a2aRunner({ client, agentId: 'agent-1' });

    await runner.run('test', { signal: controller.signal, timeoutMs: 5000 });

    expect(client.sendMessage).toHaveBeenCalledWith('agent-1', 'test', {
      signal: controller.signal,
      timeoutMs: 5000,
    });
  });

  it('propagates errors from remote agent', async () => {
    const client = mockA2AClient({
      sendMessage: async () => {
        throw new Error('remote timeout');
      },
    });

    const runner = a2aRunner({ client, agentId: 'agent-1' });
    await expect(runner.run('test')).rejects.toThrow('remote timeout');
  });

  it('returns RunnerLike compatible with FlowChart', async () => {
    const client = mockA2AClient();
    const runner = a2aRunner({ client, agentId: 'agent-1' });

    // RunnerLike contract: run returns { content: string }
    const result = await runner.run('hello');
    expect(typeof result.content).toBe('string');
  });

  it('works as agentAsTool input', async () => {
    // Verify it can be used with agentAsTool
    const { agentAsTool } = await import('../../src/providers/tools/agentAsTool');
    const client = mockA2AClient();
    const runner = a2aRunner({ client, agentId: 'remote' });

    const tool = agentAsTool({ id: 'remote-agent', description: 'Remote agent.', runner });
    const result = await tool.handler({ message: 'test query' });
    expect(result.content).toBe('[remote] test query');
  });
});

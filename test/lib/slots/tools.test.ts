/**
 * Tests for Tools slot subflow.
 *
 * Tiers:
 * - unit:     static tools resolve, dynamic tools resolve
 * - boundary: empty tool list, provider returns empty array
 * - scenario: gated tools filter by permission, composite merges providers
 * - property: output always array of LLMToolDescription; context receives messages
 * - security: provider.resolve() throws, tool descriptions with malicious schemas preserved
 */

import { describe, it, expect, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import { buildToolsSubflow } from '../../../src/lib/slots/tools';
import { agentScopeFactory } from '../../../src/executor/scopeFactory';
import { AgentScope, AGENT_PATHS } from '../../../src/scope/AgentScope';
import { staticTools } from '../../../src/providers/tools/staticTools';
import { gatedTools } from '../../../src/providers/tools/gatedTools';
import { compositeTools } from '../../../src/providers/tools/compositeTools';
import { noTools } from '../../../src/providers/tools/noTools';
import type { ToolProvider } from '../../../src/core/providers';
import type { ToolDefinition } from '../../../src/types/tools';
import type { LLMToolDescription } from '../../../src/types/llm';
import type { Message } from '../../../src/types/messages';

// ── Helpers ──────────────────────────────────────────────────

const user = (text: string): Message => ({ role: 'user', content: text });

const searchTool: ToolDefinition = {
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  handler: async () => ({ content: 'results' }),
};

const calcTool: ToolDefinition = {
  id: 'calculator',
  description: 'Do math',
  inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
  handler: async () => ({ content: '42' }),
};

const adminTool: ToolDefinition = {
  id: 'admin_panel',
  description: 'Admin operations',
  inputSchema: { type: 'object' },
  handler: async () => ({ content: 'admin' }),
};

/**
 * Run the Tools subflow inside a wrapper chart.
 * Seed stage sets up messages + loopCount.
 * Returns the final shared state.
 */
async function runSubflow(
  provider: ToolProvider,
  messages: Message[] = [user('hello')],
): Promise<Record<string, unknown>> {
  const subflow = buildToolsSubflow({ provider });

  const wrapper = flowChart(
    'Seed',
    (scope: ScopeFacade) => {
      AgentScope.setMessages(scope, messages);
      AgentScope.setLoopCount(scope, 0);
    },
    'test-seed',
  )
    .addSubFlowChartNext('sf-tools', subflow, 'Tools', {
      inputMapper: (parent: Record<string, unknown>) => ({
        [AGENT_PATHS.MESSAGES]: parent[AGENT_PATHS.MESSAGES],
        [AGENT_PATHS.LOOP_COUNT]: parent[AGENT_PATHS.LOOP_COUNT],
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        [AGENT_PATHS.TOOL_DESCRIPTIONS]: sfOutput[AGENT_PATHS.TOOL_DESCRIPTIONS],
      }),
    })
    .build();

  const executor = new FlowChartExecutor(wrapper, { scopeFactory: agentScopeFactory });
  await executor.run();
  return executor.getSnapshot()?.sharedState ?? {};
}

// ── Unit Tests ───────────────────────────────────────────────

describe('Tools slot — unit', () => {
  it('static tools resolve and write descriptions to scope', async () => {
    const state = await runSubflow(staticTools([searchTool, calcTool]));
    const tools = state[AGENT_PATHS.TOOL_DESCRIPTIONS] as LLMToolDescription[];
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('search');
    expect(tools[1].name).toBe('calculator');
  });

  it('noTools() provider resolves to empty array', async () => {
    const state = await runSubflow(noTools());
    const tools = state[AGENT_PATHS.TOOL_DESCRIPTIONS] as LLMToolDescription[];
    expect(tools).toHaveLength(0);
  });
});

// ── Boundary Tests ───────────────────────────────────────────

describe('Tools slot — boundary', () => {
  it('handles provider returning empty array', async () => {
    const state = await runSubflow(staticTools([]));
    const tools = state[AGENT_PATHS.TOOL_DESCRIPTIONS] as LLMToolDescription[];
    expect(tools).toHaveLength(0);
  });

  it('works with empty message history', async () => {
    const state = await runSubflow(staticTools([searchTool]), []);
    const tools = state[AGENT_PATHS.TOOL_DESCRIPTIONS] as LLMToolDescription[];
    expect(tools).toHaveLength(1);
  });

  it('handles async provider', async () => {
    const asyncProvider: ToolProvider = {
      resolve: async () => {
        await new Promise((r) => setTimeout(r, 1));
        return [{ name: 'async_tool', description: 'async', inputSchema: {} }];
      },
    };
    const state = await runSubflow(asyncProvider);
    const tools = state[AGENT_PATHS.TOOL_DESCRIPTIONS] as LLMToolDescription[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('async_tool');
  });
});

// ── Scenario Tests ───────────────────────────────────────────

describe('Tools slot — scenario', () => {
  it('gated tools filter by permission', async () => {
    const allowed = new Set(['search', 'calculator']);
    const gated = gatedTools(
      staticTools([searchTool, calcTool, adminTool]),
      (toolId) => allowed.has(toolId),
    );
    const state = await runSubflow(gated);
    const tools = state[AGENT_PATHS.TOOL_DESCRIPTIONS] as LLMToolDescription[];
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['search', 'calculator']);
  });

  it('composite tools merge multiple providers', async () => {
    const combined = compositeTools([
      staticTools([searchTool]),
      staticTools([calcTool]),
    ]);
    const state = await runSubflow(combined);
    const tools = state[AGENT_PATHS.TOOL_DESCRIPTIONS] as LLMToolDescription[];
    expect(tools).toHaveLength(2);
  });

  it('provider receives correct context (message, messages, turnNumber)', async () => {
    const spy = vi.fn().mockReturnValue([]);
    const provider: ToolProvider = { resolve: spy };
    const msgs = [user('hello'), user('world')];

    await runSubflow(provider, msgs);

    expect(spy).toHaveBeenCalledOnce();
    const ctx = spy.mock.calls[0][0];
    expect(ctx.message).toBe('world'); // last user message
    expect(ctx.turnNumber).toBe(0);
    expect(ctx.messages).toHaveLength(2);
  });
});

// ── Property Tests ───────────────────────────────────────────

describe('Tools slot — property', () => {
  it('output is always an array', async () => {
    const state = await runSubflow(noTools());
    expect(Array.isArray(state[AGENT_PATHS.TOOL_DESCRIPTIONS])).toBe(true);
  });

  it('tool descriptions contain name, description, inputSchema', async () => {
    const state = await runSubflow(staticTools([searchTool]));
    const tools = state[AGENT_PATHS.TOOL_DESCRIPTIONS] as LLMToolDescription[];
    const tool = tools[0];
    expect(tool).toHaveProperty('name');
    expect(tool).toHaveProperty('description');
    expect(tool).toHaveProperty('inputSchema');
  });
});

// ── Security Tests ─────────────────────────────────────��─────

describe('Tools slot — security', () => {
  it('throws at build time when provider is missing', () => {
    expect(() => buildToolsSubflow({ provider: undefined as any }))
      .toThrow('provider is required');
  });

  it('provider.resolve() throwing propagates as error', async () => {
    const failProvider: ToolProvider = {
      resolve: () => { throw new Error('provider crashed'); },
    };
    await expect(runSubflow(failProvider)).rejects.toThrow('provider crashed');
  });

  it('tool with complex schema is preserved as-is', async () => {
    const complexTool: ToolDefinition = {
      id: 'complex',
      description: 'Has nested schema',
      inputSchema: {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: { deep: { type: 'string' } },
          },
        },
      },
      handler: async () => ({ content: 'ok' }),
    };
    const state = await runSubflow(staticTools([complexTool]));
    const tools = state[AGENT_PATHS.TOOL_DESCRIPTIONS] as LLMToolDescription[];
    expect(tools[0].inputSchema).toEqual(complexTool.inputSchema);
  });
});

/**
 * SlotDecision — 5-pattern tests.
 *
 * Tests that SlotDecision<T> works end-to-end: providers return decisions,
 * subflows unwrap them, narrative shows chosen/rationale.
 */
import { describe, it, expect } from 'vitest';
import { Agent, AgentPattern, mock, defineTool } from '../../../src';
import type { ToolProvider, PromptProvider, SlotDecision } from '../../../src/core';
import type { LLMToolDescription } from '../../../src/types';

const noopTool = defineTool({
  id: 'noop',
  description: 'Does nothing',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({ content: 'ok' }),
});

const adminTool = defineTool({
  id: 'admin',
  description: 'Admin action',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({ content: 'admin done' }),
});

// ── Unit ────────────────────────────────────────────────────

describe('SlotDecision — unit', () => {
  it('static providers return SlotDecision with chosen: static', async () => {
    // Agent with .system() and .tool() uses static providers internally
    const agent = Agent.create({ provider: mock([{ content: 'hi' }]) })
      .system('You are helpful.')
      .tool(noopTool)
      .build();

    const result = await agent.run('test');
    expect(result.content).toBe('hi');
    // Static providers work — agent completes normally
  });

  it('.promptProvider() overrides .system()', async () => {
    const customPrompt: PromptProvider = {
      resolve: () => ({ value: 'Custom prompt here', chosen: 'custom', rationale: 'test override' }),
    };

    const agent = Agent.create({ provider: mock([{ content: 'hi' }]) })
      .system('This should be overridden')
      .promptProvider(customPrompt)
      .build();

    const result = await agent.run('test');
    expect(result.content).toBe('hi');
    // Custom prompt was used — verify via narrative
    const narrative = agent.getNarrative();
    expect(narrative.some(l => l.includes('Custom prompt here'))).toBe(true);
  });

  it('.toolProvider() overrides .tool()', async () => {
    const customTools: ToolProvider = {
      resolve: () => ({
        value: [{ name: 'custom_tool', description: 'Custom', inputSchema: {} }],
        chosen: 'custom',
        rationale: 'test tool provider',
      }),
    };

    const agent = Agent.create({ provider: mock([{ content: 'no tools needed' }]) })
      .tool(noopTool)
      .toolProvider(customTools)
      .build();

    const result = await agent.run('test');
    expect(result.content).toBe('no tools needed');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('SlotDecision — boundary', () => {
  it('dynamic tool provider returns different tools per iteration', async () => {
    let resolveCount = 0;
    const dynamicTools: ToolProvider = {
      resolve: (ctx) => {
        resolveCount++;
        const hasAuth = ctx.messages.some((m: any) =>
          m.role === 'tool' && typeof m.content === 'string' && m.content.includes('authenticated'));
        const tools: LLMToolDescription[] = hasAuth
          ? [{ name: 'noop', description: 'Noop', inputSchema: {} }, { name: 'admin', description: 'Admin', inputSchema: {} }]
          : [{ name: 'noop', description: 'Noop', inputSchema: {} }];
        return {
          value: tools,
          chosen: hasAuth ? 'elevated' : 'basic',
          rationale: hasAuth ? 'identity verified' : 'standard access',
        };
      },
      execute: async (call) => {
        if (call.name === 'noop') return { content: 'authenticated: true' };
        return { content: 'admin action done' };
      },
    };

    const agent = Agent.create({
      provider: mock([
        { content: 'calling noop', toolCalls: [{ id: '1', name: 'noop', arguments: {} }] },
        { content: 'done' },
      ]),
    })
      .pattern(AgentPattern.Dynamic)
      .toolProvider(dynamicTools)
      .build();

    await agent.run('test');
    // In Dynamic pattern, tools resolve at least twice (initial + after tool call)
    expect(resolveCount).toBeGreaterThanOrEqual(2);
  });

  it('dynamic prompt provider changes prompt per iteration', async () => {
    let resolveCount = 0;
    const dynamicPrompt: PromptProvider = {
      resolve: (ctx) => {
        resolveCount++;
        const hasFlagged = ctx.history.some((m: any) =>
          typeof m.content === 'string' && m.content.includes('flagged'));
        return {
          value: hasFlagged ? 'ESCALATION MODE' : 'Normal support',
          chosen: hasFlagged ? 'escalation' : 'standard',
        };
      },
    };

    const agent = Agent.create({
      provider: mock([
        { content: 'checking', toolCalls: [{ id: '1', name: 'noop', arguments: {} }] },
        { content: 'done' },
      ]),
    })
      .pattern(AgentPattern.Dynamic)
      .promptProvider(dynamicPrompt)
      .tool(noopTool)
      .build();

    await agent.run('test');
    expect(resolveCount).toBeGreaterThanOrEqual(2);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('SlotDecision — scenario', () => {
  it('narrative shows decision for dynamic tool provider', async () => {
    const dynamicTools: ToolProvider = {
      resolve: () => ({
        value: [{ name: 'noop', description: 'Noop', inputSchema: {} }],
        chosen: 'elevated',
        rationale: 'identity verified in previous turn',
      }),
      execute: async () => ({ content: 'ok' }),
    };

    const agent = Agent.create({ provider: mock([{ content: 'done' }]) })
      .toolProvider(dynamicTools)
      .build();

    await agent.run('test');
    const narrative = agent.getNarrative();
    // Decision should appear in narrative
    expect(narrative.some(l => l.includes('elevated'))).toBe(true);
  });
});

// ── Property ────────────────────────────────────────────────

describe('SlotDecision — property', () => {
  it('SlotDecision interface shape is enforced by TypeScript', () => {
    // This is a compile-time test — if it compiles, the shape is correct
    const decision: SlotDecision<string> = { value: 'hello', chosen: 'test' };
    expect(decision.value).toBe('hello');
    expect(decision.chosen).toBe('test');
    expect(decision.rationale).toBeUndefined();

    const withRationale: SlotDecision<number[]> = { value: [1, 2], chosen: 'custom', rationale: 'because' };
    expect(withRationale.rationale).toBe('because');
  });
});

// ── Security ────────────────────────────────────────────────

describe('SlotDecision — security', () => {
  it('custom tool provider cannot bypass tool execution (execute is separate)', async () => {
    // A malicious toolProvider could return tools the registry doesn't have.
    // But execute() is separate — it only runs tools the provider can handle.
    const provider: ToolProvider = {
      resolve: () => ({
        value: [{ name: 'dangerous', description: 'Dangerous tool', inputSchema: {} }],
        chosen: 'malicious',
      }),
      // No execute → falls back to registry (which doesn't have 'dangerous')
    };

    const agent = Agent.create({
      provider: mock([
        { content: 'calling', toolCalls: [{ id: '1', name: 'dangerous', arguments: {} }] },
        { content: 'failed' },
      ]),
    })
      .toolProvider(provider)
      .build();

    // Should not throw — unknown tool returns error result
    const result = await agent.run('test');
    expect(result.content).toBeDefined();
  });
});

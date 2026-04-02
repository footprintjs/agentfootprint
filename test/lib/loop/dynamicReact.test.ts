/**
 * Dynamic ReAct Pattern — 5-pattern tests.
 *
 * Tests the AgentPattern.Dynamic loop target: loop back to SystemPrompt
 * so all three API slots (prompt, tools, messages) re-evaluate each iteration.
 */
import { describe, it, expect } from 'vitest';
import { Agent, AgentPattern, mock, defineTool } from '../../../src';
import { buildAgentLoop } from '../../../src/lib/loop';
import { staticPrompt, staticTools, noTools } from '../../../src/providers';
import { slidingWindow } from '../../../src/providers/messages';
import { ToolRegistry } from '../../../src/tools';
import { FlowChartExecutor } from 'footprintjs';
import { userMessage } from '../../../src/types';
import type { ToolProvider } from '../../../src/core';

// ── Helpers ─────────────────────────────────────────────────────

const noopTool = defineTool({
  id: 'noop',
  description: 'Does nothing',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({ content: 'ok' }),
});

function buildLoop(
  responses: any[],
  options: { pattern?: AgentPattern; tools?: boolean; toolProvider?: ToolProvider } = {},
) {
  const registry = new ToolRegistry();
  if (options.tools !== false) registry.register(noopTool);

  return buildAgentLoop(
    {
      provider: mock(responses),
      systemPrompt: { provider: staticPrompt('test') },
      messages: { strategy: slidingWindow({ maxMessages: 100 }) },
      tools: {
        provider: options.toolProvider ?? (options.tools !== false ? staticTools(registry.all()) : noTools()),
      },
      registry,
      maxIterations: 5,
      pattern: options.pattern,
    },
    { messages: [userMessage('go')] },
  );
}

// ── Unit ────────────────────────────────────────────────────────

describe('Dynamic ReAct — unit', () => {
  it('AgentPattern enum has Regular and Dynamic values', () => {
    expect(AgentPattern.Regular).toBe('regular');
    expect(AgentPattern.Dynamic).toBe('dynamic');
  });

  it('default pattern is Regular (loop to call-llm)', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'hello' }]) }).build();
    const result = await agent.run('hi');
    expect(result.content).toBe('hello');
  });

  it('Dynamic pattern completes single-shot correctly', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'hello' }]) })
      .pattern(AgentPattern.Dynamic)
      .build();
    const result = await agent.run('hi');
    expect(result.content).toBe('hello');
  });
});

// ── Boundary ────────────────────────────────────────────────────

describe('Dynamic ReAct — boundary', () => {
  it('Dynamic pattern with tools loops and terminates', async () => {
    const agent = Agent.create({
      provider: mock([
        { content: 'calling', toolCalls: [{ id: '1', name: 'noop', arguments: {} }] },
        { content: 'done' },
      ]),
    })
      .pattern(AgentPattern.Dynamic)
      .tool(noopTool)
      .maxIterations(5)
      .build();

    const result = await agent.run('do something');
    expect(result.content).toBe('done');
    expect(result.iterations).toBe(1); // 1 tool loop, then final
  });

  it('Dynamic pattern respects maxIterations', async () => {
    const responses = Array.from({ length: 6 }, () => ({
      content: 'calling',
      toolCalls: [{ id: '1', name: 'noop', arguments: {} }],
    }));

    const agent = Agent.create({ provider: mock(responses) })
      .pattern(AgentPattern.Dynamic)
      .tool(noopTool)
      .maxIterations(3)
      .build();

    const result = await agent.run('loop');
    expect(result.iterations).toBeLessThanOrEqual(3);
  });
});

// ── Scenario ────────────────────────────────────────────────────

describe('Dynamic ReAct — scenario', () => {
  it('Dynamic pattern re-evaluates tool slot each iteration', async () => {
    let resolveCount = 0;
    const trackingProvider: ToolProvider = {
      resolve: async () => {
        resolveCount++;
        return [noopTool];
      },
      execute: async () => ({ content: 'ok' }),
    };

    const chart = buildLoop(
      [
        { content: 'tool', toolCalls: [{ id: '1', name: 'noop', arguments: {} }] },
        { content: 'done' },
      ],
      { pattern: AgentPattern.Dynamic, toolProvider: trackingProvider },
    );

    const executor = new FlowChartExecutor(chart as any);
    await executor.run();

    // Dynamic: initial resolve + re-resolve on loop = at least 2
    expect(resolveCount).toBeGreaterThanOrEqual(2);
  });

  it('Regular pattern resolves tool slot only once', async () => {
    let resolveCount = 0;
    const trackingProvider: ToolProvider = {
      resolve: async () => {
        resolveCount++;
        return [noopTool];
      },
      execute: async () => ({ content: 'ok' }),
    };

    const chart = buildLoop(
      [
        { content: 'tool', toolCalls: [{ id: '1', name: 'noop', arguments: {} }] },
        { content: 'done' },
      ],
      { pattern: AgentPattern.Regular, toolProvider: trackingProvider },
    );

    const executor = new FlowChartExecutor(chart as any);
    await executor.run();

    // Regular: tools resolve once before the loop
    expect(resolveCount).toBe(1);
  });
});

// ── Property ────────────────────────────────────────────────────

describe('Dynamic ReAct — property', () => {
  it('Dynamic and Regular produce same result for stateless strategies', async () => {
    const responses = [
      { content: 'calling', toolCalls: [{ id: '1', name: 'noop', arguments: {} }] },
      { content: 'final answer' },
    ];

    const regularAgent = Agent.create({ provider: mock([...responses]) })
      .pattern(AgentPattern.Regular)
      .tool(noopTool)
      .build();

    const dynamicAgent = Agent.create({ provider: mock([...responses]) })
      .pattern(AgentPattern.Dynamic)
      .tool(noopTool)
      .build();

    const regularResult = await regularAgent.run('test');
    const dynamicResult = await dynamicAgent.run('test');

    expect(regularResult.content).toBe(dynamicResult.content);
    expect(regularResult.content).toBe('final answer');
  });
});

// ── Security ────────────────────────────────────────────────────

describe('Dynamic ReAct — security', () => {
  it('Dynamic pattern still respects maxIterations (no infinite loop)', async () => {
    const responses = Array.from({ length: 10 }, (_, i) => ({
      content: `iteration ${i}`,
      toolCalls: [{ id: `${i}`, name: 'noop', arguments: {} }],
    }));

    const agent = Agent.create({ provider: mock(responses) })
      .pattern(AgentPattern.Dynamic)
      .tool(noopTool)
      .maxIterations(3)
      .build();

    const result = await agent.run('loop');
    expect(result.iterations).toBeLessThanOrEqual(3);
  });

  it('no message duplication in Dynamic pattern', async () => {
    const agent = Agent.create({
      provider: mock([
        { content: 'calling', toolCalls: [{ id: '1', name: 'noop', arguments: {} }] },
        { content: 'calling again', toolCalls: [{ id: '2', name: 'noop', arguments: {} }] },
        { content: 'done' },
      ]),
    })
      .pattern(AgentPattern.Dynamic)
      .tool(noopTool)
      .maxIterations(5)
      .build();

    const result = await agent.run('test');
    expect(result.content).toBe('done');

    // Exactly 1 user message — no duplication from dynamic loop
    const userCount = result.messages.filter((m: any) => m.role === 'user').length;
    expect(userCount).toBe(1);
    // 2 tool loops + 1 final = 3 assistant messages
    const assistantCount = result.messages.filter((m: any) => m.role === 'assistant').length;
    expect(assistantCount).toBe(3);
    // 2 tool results
    const toolCount = result.messages.filter((m: any) => m.role === 'tool').length;
    expect(toolCount).toBe(2);
  });
});

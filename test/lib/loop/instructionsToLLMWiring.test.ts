/**
 * InstructionsToLLM wiring into buildAgentLoop — 5-pattern tests.
 *
 * Tests the full integration: agent instructions → InstructionsToLLM subflow
 * → prompt/tool/responseRule injections into the 3 API slots → narrative visibility.
 *
 * Tiers:
 * - unit:     no instructions = no subflow mounted, instructions merge into prompt/tools
 * - boundary: empty instructions array, instruction with no outputs
 * - scenario: full multi-turn with Dynamic pattern, tool injection makes tool callable
 * - property: narrative includes InstructionsToLLM entries, instruction tools registered
 * - security: instruction tool registration doesn't overwrite existing tools
 */

import { describe, it, expect, vi } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';
import { buildAgentLoop } from '../../../src/lib/loop/buildAgentLoop';
import type { AgentLoopConfig } from '../../../src/lib/loop/types';
import { AgentPattern } from '../../../src/lib/loop/types';
import { ToolRegistry, defineTool } from '../../../src/tools/ToolRegistry';
import { Agent } from '../../../src/lib/concepts/AgentBuilder';
import { staticPrompt } from '../../../src/providers/prompt/static';
import { slidingWindow } from '../../../src/providers/messages/slidingWindow';
import { noTools } from '../../../src/providers/tools/noTools';
import { staticTools } from '../../../src/providers/tools/staticTools';
import type { AgentInstruction } from '../../../src/lib/instructions/agentInstruction';
import type { LLMProvider, LLMResponse, Message, ToolCall } from '../../../src/types';
import { userMessage } from '../../../src/types';

// ── Helpers ──────────────────────────────────────────────────

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
  };
}

function minimalConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    provider: mockProvider([{ content: 'Hello!' }]),
    systemPrompt: { provider: staticPrompt('You are helpful.') },
    messages: { strategy: slidingWindow({ maxMessages: 100 }) },
    tools: { provider: noTools() },
    registry: new ToolRegistry(),
    ...overrides,
  };
}

async function runLoop(
  config: AgentLoopConfig,
  userMsg = 'hello',
): Promise<{ state: Record<string, unknown>; executor: FlowChartExecutor }> {
  const { chart } = buildAgentLoop(config, { messages: [userMessage(userMsg)] });
  const executor = new FlowChartExecutor(chart);
  executor.enableNarrative();
  await executor.run();
  return { state: executor.getSnapshot()?.sharedState ?? {}, executor };
}

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async () => ({ content: 'search results' }),
});

// ── Unit ───────────────────────────────────────────────────────

describe('InstructionsToLLM wiring — unit', () => {
  it('no instructions — loop works unchanged', async () => {
    const config = minimalConfig();
    const { state } = await runLoop(config);
    expect(state.result).toBe('Hello!');
    // No decision field initialized
    expect(state.decision).toBeUndefined();
  });

  it('instructions inject prompt into system prompt', async () => {
    const provider = mockProvider([{ content: 'response' }]);
    const instructions: AgentInstruction[] = [
      { id: 'always', prompt: 'Extra guidance here.' },
    ];
    const config = minimalConfig({
      provider,
      agentInstructions: instructions,
    });
    const { state } = await runLoop(config);

    // System prompt should contain both base + injection
    const calledMsgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    const systemMsg = calledMsgs.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('You are helpful.');
    expect(systemMsg?.content).toContain('Extra guidance here.');
  });

  it('conditional instruction does NOT inject when decision does not match', async () => {
    const provider = mockProvider([{ content: 'ok' }]);
    const instructions: AgentInstruction[] = [
      {
        id: 'refund',
        activeWhen: (d: any) => d.orderStatus === 'denied',
        prompt: 'Be empathetic.',
      },
    ];
    const config = minimalConfig({
      provider,
      agentInstructions: instructions,
      initialDecision: { orderStatus: 'pending' },
    });
    const { state } = await runLoop(config);

    const calledMsgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    const systemMsg = calledMsgs.find((m) => m.role === 'system');
    // Should NOT contain the injection
    expect(systemMsg?.content).not.toContain('Be empathetic.');
    expect(state.matchedInstructions).toBe('none matched');
  });

  it('instructions inject tools into tool descriptions', async () => {
    const refundTool = defineTool({
      id: 'process_refund',
      description: 'Process a refund',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: 'refunded' }),
    });
    const provider = mockProvider([{ content: 'ok' }]);
    const instructions: AgentInstruction[] = [
      { id: 'refund', tools: [refundTool] },
    ];
    const config = minimalConfig({
      provider,
      agentInstructions: instructions,
    });
    const { state } = await runLoop(config);

    // Tool descriptions sent to LLM — provider.chat(messages, options) where options.tools has them
    const calledArgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = calledArgs[1] as { tools?: any[] };
    expect(options?.tools).toBeDefined();
    expect(options.tools!.some((t: any) => t.name === 'process_refund')).toBe(true);
  });
});

// ── Boundary ──────────────────────────────────────────────────

describe('InstructionsToLLM wiring — boundary', () => {
  it('empty agentInstructions array — no subflow mounted', async () => {
    const config = minimalConfig({ agentInstructions: [] });
    const { state } = await runLoop(config);
    expect(state.result).toBe('Hello!');
    expect(state.decision).toBeUndefined();
  });

  it('decision scope initialized from initialDecision', async () => {
    const instructions: AgentInstruction[] = [
      { id: 'always', prompt: 'P' },
    ];
    const config = minimalConfig({
      agentInstructions: instructions,
      initialDecision: { orderStatus: 'denied', riskLevel: 'high' },
    });
    const { state } = await runLoop(config);
    expect(state.decision).toEqual({ orderStatus: 'denied', riskLevel: 'high' });
  });
});

// ── Tool Registration ─────────────────────────────────────────

describe('InstructionsToLLM wiring — tool registration', () => {
  it('instruction tools are registered in registry via Agent.build() (callable)', async () => {
    const refundTool = defineTool({
      id: 'process_refund',
      description: 'Process a refund',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: 'refunded' }),
    });
    // Agent.build() registers instruction tools in the AgentRunner constructor
    const agent = Agent.create({ provider: mockProvider([{ content: 'ok' }]) })
      .system('Help.')
      .instruction({ id: 'refund', tools: [refundTool] })
      .build();

    // Tool should be callable — run the agent with a tool call
    const tc = { id: 'tc-1', name: 'process_refund', arguments: {} };
    const provider2 = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Done.' },
    ]);
    const agent2 = Agent.create({ provider: provider2 })
      .system('Help.')
      .instruction({ id: 'refund', tools: [refundTool] })
      .build();
    const result = await agent2.run('refund');
    expect(result.content).toBe('Done.');
  });

  it('instruction tools do NOT overwrite existing registry tools', async () => {
    const existingHandler = vi.fn(async () => ({ content: 'existing' }));
    const existingTool = defineTool({
      id: 'shared_tool',
      description: 'Existing tool',
      inputSchema: { type: 'object' },
      handler: existingHandler,
    });
    const instrHandler = vi.fn(async () => ({ content: 'instruction' }));
    const instrTool = defineTool({
      id: 'shared_tool',
      description: 'Instruction version',
      inputSchema: { type: 'object' },
      handler: instrHandler,
    });

    // Register existing tool first, then build agent with instruction tool of same ID
    const tc = { id: 'tc-1', name: 'shared_tool', arguments: {} };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Done.' },
    ]);
    const agent = Agent.create({ provider })
      .system('Help.')
      .tool(existingTool)
      .instruction({ id: 'instr', tools: [instrTool] })
      .build();

    await agent.run('test');
    // Original handler should have been called (not overwritten by instruction tool)
    expect(existingHandler).toHaveBeenCalled();
    expect(instrHandler).not.toHaveBeenCalled();
  });
});

// ── Multi-run stability ───────────────────────────────────────

describe('InstructionsToLLM wiring — multi-run stability', () => {
  it('agent.run() works correctly on second call (cached decideFunctions, no re-registration)', async () => {
    const refundTool = defineTool({
      id: 'process_refund',
      description: 'Process a refund',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: 'refunded' }),
    });

    let callCount = 0;
    const provider = {
      chat: vi.fn(async () => {
        callCount++;
        // Odd calls: tool call, even calls: final
        if (callCount % 2 === 1) {
          return { content: '', toolCalls: [{ id: `tc-${callCount}`, name: 'process_refund', arguments: {} }] };
        }
        return { content: `Done ${callCount / 2}` };
      }),
    };

    const agent = Agent.create({ provider })
      .system('Help.')
      .instruction({ id: 'refund', tools: [refundTool] })
      .build();

    // First run
    const r1 = await agent.run('first');
    expect(r1.content).toBe('Done 1');

    // Second run — must work identically (no re-registration issues)
    const r2 = await agent.run('second');
    expect(r2.content).toBe('Done 2');
  });
});

// ── Conditional Match (positive) ──────────────────────────────

describe('InstructionsToLLM wiring — conditional match', () => {
  it('conditional instruction DOES inject when decision matches', async () => {
    const provider = mockProvider([{ content: 'ok' }]);
    const instructions: AgentInstruction[] = [
      {
        id: 'refund',
        activeWhen: (d: any) => d.orderStatus === 'denied',
        prompt: 'Be empathetic.',
      },
    ];
    const config = minimalConfig({
      provider,
      agentInstructions: instructions,
      initialDecision: { orderStatus: 'denied' },
    });
    const { state } = await runLoop(config);

    const calledMsgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    const systemMsg = calledMsgs.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Be empathetic.');
    expect(state.matchedInstructions).toBe('1 matched: refund');
  });
});

// ── Tool Deduplication ────────────────────────────────────────

describe('InstructionsToLLM wiring — tool deduplication', () => {
  it('instruction tool with same name as base tool → base wins, appears once', async () => {
    const provider = mockProvider([{ content: 'ok' }]);
    const baseTool = defineTool({
      id: 'search',
      description: 'Base search',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: 'base results' }),
    });
    const instrTool = defineTool({
      id: 'search',
      description: 'Instruction version of search',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: 'instr search' }),
    });
    const instructions: AgentInstruction[] = [
      { id: 'extra-search', tools: [instrTool] },
    ];
    const config = minimalConfig({
      provider,
      tools: { provider: staticTools([baseTool]) },
      agentInstructions: instructions,
    });
    const { state } = await runLoop(config);

    // Tool descriptions sent to LLM should contain 'search' exactly once
    const calledArgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = calledArgs[1] as { tools?: any[] };
    const searchTools = options?.tools?.filter((t: any) => t.name === 'search') ?? [];
    expect(searchTools).toHaveLength(1);
    // Base version should win (description from base)
    expect(searchTools[0].description).toBe('Base search');
  });
});

// ── Narrative ─────────────────────────────────────────────────

describe('InstructionsToLLM wiring — narrative', () => {
  it('InstructionsToLLM subflow appears in narrative', async () => {
    const instructions: AgentInstruction[] = [
      { id: 'always', prompt: 'P' },
    ];
    const config = minimalConfig({ agentInstructions: instructions });
    const { executor } = await runLoop(config);

    const narrative = executor.getNarrative();
    expect(narrative.some((s: string) =>
      s.includes('InstructionsToLLM') || s.includes('EvaluateInstructions'),
    )).toBe(true);
  });

  it('narrative shows matched instruction IDs', async () => {
    const instructions: AgentInstruction[] = [
      { id: 'refund-handling', prompt: 'Refund.' },
      { id: 'compliance', prompt: 'Comply.' },
    ];
    const config = minimalConfig({ agentInstructions: instructions });
    const { state } = await runLoop(config);

    expect(state.matchedInstructions).toBe('2 matched: refund-handling, compliance');
  });
});

// ── ResponseRules Integration ─────────────────────────────────

describe('InstructionsToLLM wiring — responseRules', () => {
  it('agent-level responseRules are passed to tool execution', async () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);

    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: { q: 'test' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Final answer.' },
    ]);

    const instructions: AgentInstruction[] = [
      {
        id: 'always-guide',
        onToolResult: [
          { id: 'be-concise', text: 'Be concise in your response.' },
        ],
      },
    ];

    const config = minimalConfig({
      provider,
      registry,
      tools: { provider: staticTools([{ name: 'search', description: 'Search', inputSchema: {} }]) },
      agentInstructions: instructions,
    });

    const { state } = await runLoop(config);
    expect(state.result).toBe('Final answer.');

    // Check that the tool result message contains the injected instruction
    const messages = state.messages as Message[];
    const toolResultMsg = messages.find((m) => m.role === 'tool');
    expect(toolResultMsg?.content).toContain('Be concise in your response.');
  });
});

// ── Dynamic Pattern ───────────────────────────────────────────

describe('InstructionsToLLM wiring — Dynamic pattern', () => {
  it('Dynamic pattern loops back to InstructionsToLLM (re-evaluates)', async () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);

    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: {} };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Done.' },
    ]);

    const instructions: AgentInstruction[] = [
      { id: 'always', prompt: 'Always active.' },
    ];

    const config = minimalConfig({
      provider,
      registry,
      tools: { provider: staticTools([{ name: 'search', description: 'Search', inputSchema: {} }]) },
      agentInstructions: instructions,
      pattern: AgentPattern.Dynamic,
    });

    const { state, executor } = await runLoop(config);
    expect(state.result).toBe('Done.');

    // Narrative should show InstructionsToLLM appearing (re-evaluated on 2nd iteration)
    const narrative = executor.getNarrative();
    const instrEntries = narrative.filter((s: string) =>
      s.includes('InstructionsToLLM') || s.includes('EvaluateInstructions'),
    );
    // Should appear at least twice (once per iteration in Dynamic mode)
    expect(instrEntries.length).toBeGreaterThanOrEqual(2);
  });
});

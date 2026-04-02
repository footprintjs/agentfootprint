/**
 * Tests for HandleResponse stage + ToolExecution subflow.
 *
 * HandleResponse finalizes the turn (extract result, break).
 * Tool execution is now handled by the upstream sf-execute-tools subflow.
 *
 * Tiers:
 * - unit:     HandleResponse sets result + breaks, ToolExecution executes + increments loopCount
 * - boundary: no parsedResponse, max iterations, empty toolCalls, no assistant messages
 * - scenario: useCommitFlag, multi-tool execution, ToolProvider
 * - property: loopCount always incremented by 1, result always set on finalize
 * - security: tool errors don't crash, loopCount bounded, unknown tools handled
 */

import { describe, it, expect, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { createHandleResponseStage } from '../../../src/lib/call/handleResponseStage';
import { buildToolExecutionSubflow } from '../../../src/lib/call/toolExecutionSubflow';
import type { AgentLoopState, ParsedResponse } from '../../../src/scope/types';
import { ToolRegistry } from '../../../src/tools/ToolRegistry';
import type { Message, ToolCall } from '../../../src/types';
import type { ToolProvider } from '../../../src/core/providers';

// ── Helpers ──────────────────────────────────────────────────

const user = (text: string): Message => ({ role: 'user', content: text });
const assistant = (text: string): Message => ({
  role: 'assistant',
  content: text,
});

function makeToolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `tc-${name}`, name, arguments: args };
}

function makeRegistry(...tools: Array<{ id: string; result: string }>): ToolRegistry {
  const registry = new ToolRegistry();
  for (const t of tools) {
    registry.register({
      id: t.id,
      description: `Tool ${t.id}`,
      inputSchema: { type: 'object' },
      handler: async () => ({ content: t.result }),
    });
  }
  return registry;
}

/**
 * Run HandleResponse stage inside a wrapper chart.
 * Seed → HandleResponse.
 */
async function runHandleResponse(opts: {
  parsedResponse?: ParsedResponse;
  messages?: Message[];
  loopCount?: number;
  maxIterations?: number;
  useCommitFlag?: boolean;
}): Promise<Record<string, unknown>> {
  const {
    parsedResponse,
    messages = [user('hello'), assistant('I will help')],
    loopCount = 0,
    maxIterations = 10,
    useCommitFlag = false,
  } = opts;

  const handleResponse = createHandleResponseStage({ useCommitFlag });

  const chart = flowChart<AgentLoopState>(
    'Seed',
    (scope) => {
      scope.messages = messages;
      scope.loopCount = loopCount;
      scope.maxIterations = maxIterations;
      if (parsedResponse) {
        scope.parsedResponse = parsedResponse;
      }
    },
    'seed',
  )
    .addFunction('HandleResponse', handleResponse, 'handle-response')
    .build();

  const executor = new FlowChartExecutor(chart);
  await executor.run();
  return executor.getSnapshot()?.sharedState ?? {};
}

/**
 * Run ToolExecution subflow inside a wrapper chart.
 * Seed → [sf-execute-tools] subflow.
 */
async function runToolExecution(opts: {
  parsedResponse: ParsedResponse;
  messages?: Message[];
  loopCount?: number;
  maxIterations?: number;
  registry?: ToolRegistry;
  toolProvider?: ToolProvider;
}): Promise<Record<string, unknown>> {
  const {
    parsedResponse,
    messages = [user('hello'), assistant('Using tools')],
    loopCount = 0,
    maxIterations = 10,
    registry = new ToolRegistry(),
    toolProvider,
  } = opts;

  const subflow = buildToolExecutionSubflow({ registry, toolProvider });

  const chart = flowChart<AgentLoopState>(
    'Seed',
    (scope) => {
      scope.parsedResponse = parsedResponse;
      scope.messages = messages;
      scope.loopCount = loopCount;
      scope.maxIterations = maxIterations;
    },
    'seed',
  )
    .addSubFlowChartNext('sf-execute-tools', subflow, 'ExecuteTools', {
      inputMapper: (parent: Record<string, unknown>) => ({
        parsedResponse: parent.parsedResponse,
        currentMessages: parent.messages,
        currentLoopCount: parent.loopCount,
        maxIterations: parent.maxIterations,
      }),
      outputMapper: (sf: Record<string, unknown>) => ({
        messages: sf.toolResultMessages,
        loopCount: sf.updatedLoopCount,
      }),
    })
    .build();

  const executor = new FlowChartExecutor(chart);
  await executor.run();
  return executor.getSnapshot()?.sharedState ?? {};
}

// ── HandleResponse Unit Tests ───────────────────────────────

describe('HandleResponse — unit', () => {
  it('finalizes when no tool calls: sets result and breaks', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: 'Final answer' },
      messages: [user('hi'), assistant('Final answer')],
    });
    expect(state.result).toBe('Final answer');
  });

  it('continues loop when tool calls present and under maxIterations', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [makeToolCall('x')], content: '' },
      loopCount: 1,
      maxIterations: 10,
    });
    // No result set — loop continues
    expect(state.result).toBeUndefined();
  });
});

// ── ToolExecution Unit Tests ────────────────────────────────

describe('ToolExecution — unit', () => {
  it('executes tool calls and increments loopCount', async () => {
    const registry = makeRegistry({ id: 'search', result: 'found it' });
    const tc = makeToolCall('search');
    const state = await runToolExecution({
      parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: 'Let me search' },
      messages: [user('find X'), assistant('Let me search')],
      registry,
      loopCount: 0,
    });

    expect(state.loopCount).toBe(1);
    const messages = state.messages as Message[];
    const toolMsgs = messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
  });
});

// ── Boundary Tests ──────────────────────────────────────────

describe('HandleResponse — boundary', () => {
  it('finalizes when parsedResponse is undefined', async () => {
    const state = await runHandleResponse({
      parsedResponse: undefined,
      messages: [user('hi'), assistant('I responded')],
    });
    expect(state.result).toBeDefined();
  });

  it('finalizes when max iterations reached even with tool calls', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [makeToolCall('x')], content: '' },
      loopCount: 10,
      maxIterations: 10,
    });
    expect(state.result).toBeDefined();
    expect(state.loopCount).toBe(10);
  });

  it('extracts result from last assistant message', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: '' },
      messages: [user('hi'), assistant('first'), user('again'), assistant('final answer')],
    });
    expect(state.result).toBe('final answer');
  });

  it('sets empty result when no assistant messages', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: '' },
      messages: [user('hi')],
    });
    expect(state.result).toBe('');
  });
});

describe('ToolExecution — boundary', () => {
  it('no-ops when toolCalls is empty', async () => {
    const state = await runToolExecution({
      parsedResponse: { hasToolCalls: true, toolCalls: [], content: '' },
      messages: [user('hi')],
      loopCount: 0,
    });
    expect(state.loopCount).toBe(0);
  });

  it('no-ops when maxIterations reached', async () => {
    const registry = makeRegistry({ id: 'x', result: 'done' });
    const state = await runToolExecution({
      parsedResponse: { hasToolCalls: true, toolCalls: [makeToolCall('x')], content: '' },
      registry,
      loopCount: 10,
      maxIterations: 10,
    });
    // Tools NOT executed, loopCount not incremented
    expect(state.loopCount).toBe(10);
  });
});

// ── Scenario Tests ──────────────────────────────────────────

describe('HandleResponse — scenario', () => {
  it('useCommitFlag sets shouldCommit instead of breaking', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: 'done' },
      messages: [user('hi'), assistant('done')],
      useCommitFlag: true,
    });
    expect(state.result).toBe('done');
    expect(state.memory_shouldCommit).toBe(true);
  });
});

describe('ToolExecution — scenario', () => {
  it('multi-tool execution appends all results in order', async () => {
    const registry = makeRegistry(
      { id: 'search', result: 'search-result' },
      { id: 'calc', result: 'calc-result' },
    );
    const calls = [makeToolCall('search'), makeToolCall('calc')];
    const state = await runToolExecution({
      parsedResponse: { hasToolCalls: true, toolCalls: calls, content: 'Using tools' },
      messages: [user('do both'), assistant('Using tools')],
      registry,
    });

    const messages = state.messages as Message[];
    const toolMsgs = messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0].content).toBe('search-result');
    expect(toolMsgs[1].content).toBe('calc-result');
  });

  it('uses ToolProvider.execute() when provided', async () => {
    const registry = new ToolRegistry();
    const toolProvider: ToolProvider = {
      resolve: vi.fn().mockReturnValue([]),
      execute: vi.fn().mockResolvedValue({ content: 'provider-executed' }),
    };
    const tc = makeToolCall('remote-tool');

    const state = await runToolExecution({
      parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: '' },
      registry,
      toolProvider,
    });

    expect(toolProvider.execute).toHaveBeenCalledOnce();
    const messages = state.messages as Message[];
    const toolMsgs = messages.filter((m) => m.role === 'tool');
    expect(toolMsgs[0].content).toBe('provider-executed');
  });
});

// ── Property Tests ──────────────────────────────────────────

describe('ToolExecution — property', () => {
  it('loopCount is always incremented by exactly 1', async () => {
    const registry = makeRegistry({ id: 'x', result: 'done' });
    const tc = makeToolCall('x');

    for (const startCount of [0, 1, 5, 9]) {
      const state = await runToolExecution({
        parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: '' },
        registry,
        loopCount: startCount,
        maxIterations: 100,
      });
      expect(state.loopCount).toBe(startCount + 1);
    }
  });
});

describe('HandleResponse — property', () => {
  it('result is always a string on finalize', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: '' },
      messages: [user('hi'), assistant('bye')],
    });
    expect('result' in state).toBe(true);
    expect(typeof state.result).toBe('string');
  });
});

// ── Security Tests ──────────────────────────────────────────

describe('ToolExecution — security', () => {
  it('tool handler error does not crash the stage', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'fail',
      description: 'fails',
      inputSchema: { type: 'object' },
      handler: async () => { throw new Error('tool crashed'); },
    });
    const tc = makeToolCall('fail');

    const state = await runToolExecution({
      parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: '' },
      registry,
    });

    const messages = state.messages as Message[];
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg!.content as string);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toBe('tool crashed');
  });

  it('unknown tool in registry produces error, not crash', async () => {
    const registry = new ToolRegistry();
    const tc = makeToolCall('nonexistent');

    const state = await runToolExecution({
      parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: '' },
      registry,
    });

    const messages = state.messages as Message[];
    const toolMsg = messages.find((m) => m.role === 'tool');
    const parsed = JSON.parse(toolMsg!.content as string);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toContain("'nonexistent' not found");
  });
});

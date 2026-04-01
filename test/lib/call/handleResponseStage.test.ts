/**
 * Tests for handleResponseStage — execute tool calls or finalize the turn.
 *
 * Tiers:
 * - unit:     no tool calls → sets result + breaks, tool calls → executes + increments loopCount
 * - boundary: no parsedResponse, max iterations reached, empty tool calls array
 * - scenario: useCommitFlag sets shouldCommit instead of breaking, multi-tool execution
 * - property: loopCount always incremented on tool calls, result always set on finalize
 * - security: tool execution errors don't crash the stage, loopCount can't exceed maxIterations
 */

import { describe, it, expect, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import { createHandleResponseStage } from '../../../src/lib/call/handleResponseStage';
import { agentScopeFactory } from '../../../src/executor/scopeFactory';
import { AgentScope, AGENT_PATHS, MEMORY_PATHS } from '../../../src/scope/AgentScope';
import { ToolRegistry } from '../../../src/tools/ToolRegistry';
import type { Message, ToolCall } from '../../../src/types';
import type { ParsedResponse } from '../../../src/scope/AgentScope';
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
 * Run HandleResponse stage inside a wrapper chart with a pipeline structure.
 *
 * Uses the real FlowChartBuilder loopTo mechanism to test breakPipeline behavior.
 * The chart is: Seed → HandleResponse (with loopTo back to HandleResponse).
 *
 * For simplicity, we use addFunction for HandleResponse — the loopTo behavior
 * (breakPipeline) is what matters, not the loop itself.
 */
async function runHandleResponse(opts: {
  parsedResponse?: ParsedResponse;
  messages?: Message[];
  loopCount?: number;
  maxIterations?: number;
  registry?: ToolRegistry;
  toolProvider?: ToolProvider;
  useCommitFlag?: boolean;
}): Promise<Record<string, unknown>> {
  const {
    parsedResponse,
    messages = [user('hello'), assistant('I will help')],
    loopCount = 0,
    maxIterations = 10,
    registry = new ToolRegistry(),
    toolProvider,
    useCommitFlag = false,
  } = opts;

  const handleResponse = createHandleResponseStage({
    registry,
    toolProvider,
    useCommitFlag,
  });

  const chart = flowChart(
    'Seed',
    (scope: ScopeFacade) => {
      AgentScope.setMessages(scope, messages);
      AgentScope.setLoopCount(scope, loopCount);
      AgentScope.setMaxIterations(scope, maxIterations);
      if (parsedResponse) {
        AgentScope.setParsedResponse(scope, parsedResponse);
      }
    },
    'seed',
  )
    .addFunction('HandleResponse', handleResponse, 'handle-response')
    .build();

  const executor = new FlowChartExecutor(chart, { scopeFactory: agentScopeFactory });
  await executor.run();
  return executor.getSnapshot()?.sharedState ?? {};
}

// ── Unit Tests ──────────────────────────────────────────────

describe('handleResponseStage — unit', () => {
  it('finalizes when no tool calls: sets result and breaks', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: 'Final answer' },
      messages: [user('hi'), assistant('Final answer')],
    });

    expect(state[AGENT_PATHS.RESULT]).toBe('Final answer');
  });

  it('executes tool calls and increments loopCount', async () => {
    const registry = makeRegistry({ id: 'search', result: 'found it' });
    const tc = makeToolCall('search');
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: 'Let me search' },
      messages: [user('find X'), assistant('Let me search')],
      registry,
      loopCount: 0,
    });

    // loopCount incremented
    expect(state[AGENT_PATHS.LOOP_COUNT]).toBe(1);
    // Messages now include tool result
    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    const toolMsgs = messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
  });
});

// ── Boundary Tests ──────────────────────────────────────────

describe('handleResponseStage — boundary', () => {
  it('finalizes when parsedResponse is undefined', async () => {
    const state = await runHandleResponse({
      parsedResponse: undefined,
      messages: [user('hi'), assistant('I responded')],
    });

    // Should finalize (set result, break) since !parsed
    expect(state[AGENT_PATHS.RESULT]).toBeDefined();
  });

  it('finalizes when max iterations reached even with tool calls', async () => {
    const registry = makeRegistry({ id: 'search', result: 'found' });
    const tc = makeToolCall('search');
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: 'Searching' },
      messages: [user('search'), assistant('Searching')],
      registry,
      loopCount: 10,
      maxIterations: 10,
    });

    // Should finalize, NOT execute tools
    expect(state[AGENT_PATHS.RESULT]).toBeDefined();
    // loopCount not incremented
    expect(state[AGENT_PATHS.LOOP_COUNT]).toBe(10);
  });

  it('finalizes when loopCount exceeds maxIterations', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [makeToolCall('x')], content: '' },
      loopCount: 15,
      maxIterations: 10,
    });

    expect(state[AGENT_PATHS.RESULT]).toBeDefined();
    expect(state[AGENT_PATHS.LOOP_COUNT]).toBe(15); // not incremented
  });

  it('extracts result from last assistant message content', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: '' },
      messages: [user('hi'), assistant('first'), user('again'), assistant('final answer')],
    });

    expect(state[AGENT_PATHS.RESULT]).toBe('final answer');
  });

  it('sets empty result when no assistant messages', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: '' },
      messages: [user('hi')],
    });

    expect(state[AGENT_PATHS.RESULT]).toBe('');
  });
});

// ── Scenario Tests ──────────────────────────────────────────

describe('handleResponseStage — scenario', () => {
  it('useCommitFlag sets shouldCommit instead of breaking', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: 'done' },
      messages: [user('hi'), assistant('done')],
      useCommitFlag: true,
    });

    expect(state[AGENT_PATHS.RESULT]).toBe('done');
    expect(state[MEMORY_PATHS.SHOULD_COMMIT]).toBe(true);
  });

  it('multi-tool execution appends all results in order', async () => {
    const registry = makeRegistry(
      { id: 'search', result: 'search-result' },
      { id: 'calc', result: 'calc-result' },
    );
    const calls = [makeToolCall('search'), makeToolCall('calc')];
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: calls, content: 'Using tools' },
      messages: [user('do both'), assistant('Using tools')],
      registry,
    });

    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    const toolMsgs = messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0].content).toBe('search-result');
    expect(toolMsgs[1].content).toBe('calc-result');
  });

  it('uses ToolProvider.execute() when provided', async () => {
    const registry = new ToolRegistry(); // empty — provider handles execution
    const toolProvider: ToolProvider = {
      resolve: vi.fn().mockReturnValue([]),
      execute: vi.fn().mockResolvedValue({ content: 'provider-executed' }),
    };
    const tc = makeToolCall('remote-tool');

    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: '' },
      registry,
      toolProvider,
    });

    expect(toolProvider.execute).toHaveBeenCalledOnce();
    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    const toolMsgs = messages.filter((m) => m.role === 'tool');
    expect(toolMsgs[0].content).toBe('provider-executed');
  });
});

// ── Property Tests ──────────────────────────────────────────

describe('handleResponseStage — property', () => {
  it('loopCount is always incremented by exactly 1 on tool calls', async () => {
    const registry = makeRegistry({ id: 'x', result: 'done' });
    const tc = makeToolCall('x');

    for (const startCount of [0, 1, 5, 9]) {
      const state = await runHandleResponse({
        parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: '' },
        registry,
        loopCount: startCount,
        maxIterations: 100,
      });
      expect(state[AGENT_PATHS.LOOP_COUNT]).toBe(startCount + 1);
    }
  });

  it('result is always set on finalize', async () => {
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: '' },
      messages: [user('hi'), assistant('bye')],
    });

    expect(AGENT_PATHS.RESULT in state).toBe(true);
    expect(typeof state[AGENT_PATHS.RESULT]).toBe('string');
  });

  it('result is NOT set when tool calls are executed (loop continues)', async () => {
    const registry = makeRegistry({ id: 'x', result: 'done' });
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [makeToolCall('x')], content: '' },
      registry,
    });

    // Result is NOT set when we continue the loop
    expect(state[AGENT_PATHS.RESULT]).toBeUndefined();
  });
});

// ── Security Tests ──────────────────────────────────────────

describe('handleResponseStage — security', () => {
  it('tool handler error does not crash the stage', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'fail',
      description: 'fails',
      inputSchema: { type: 'object' },
      handler: async () => { throw new Error('tool crashed'); },
    });
    const tc = makeToolCall('fail');

    // Should NOT throw — errors are serialized into tool result messages
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: '' },
      registry,
    });

    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg!.content as string);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toBe('tool crashed');
  });

  it('loopCount cannot exceed maxIterations (safety guard)', async () => {
    const registry = makeRegistry({ id: 'x', result: 'ok' });

    // loopCount at maxIterations → finalize, not execute
    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [makeToolCall('x')], content: '' },
      registry,
      loopCount: 5,
      maxIterations: 5,
    });

    // Finalized — result set, loopCount not incremented
    expect(state[AGENT_PATHS.RESULT]).toBeDefined();
    expect(state[AGENT_PATHS.LOOP_COUNT]).toBe(5);
  });

  it('unknown tool in registry produces error, not crash', async () => {
    const registry = new ToolRegistry(); // empty
    const tc = makeToolCall('nonexistent');

    const state = await runHandleResponse({
      parsedResponse: { hasToolCalls: true, toolCalls: [tc], content: '' },
      registry,
    });

    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    const toolMsg = messages.find((m) => m.role === 'tool');
    const parsed = JSON.parse(toolMsg!.content as string);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toContain("'nonexistent' not found");
  });
});

/**
 * buildSwarmRouting — 5-pattern tests.
 *
 * Tests the RoutingConfig produced by buildSwarmRouting:
 * - Specialist routing (decider returns specialist ID)
 * - Extra tool routing (decider returns 'swarm-tools')
 * - Final routing (no tool calls)
 * - Lazy subflow factories for specialists
 * - Integration with buildAgentLoop
 */
import { describe, it, expect, vi } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';
import { buildSwarmRouting } from '../../../src/lib/swarm/buildSwarmRouting';
import type { SwarmSpecialist } from '../../../src/lib/swarm/buildSwarmRouting';
import { buildAgentLoop } from '../../../src/lib/loop/buildAgentLoop';
import type { AgentLoopConfig } from '../../../src/lib/loop/types';
import { ToolRegistry, defineTool } from '../../../src/tools/ToolRegistry';
import { staticPrompt } from '../../../src/providers/prompt/static';
import { slidingWindow } from '../../../src/providers/messages/slidingWindow';
import { staticTools } from '../../../src/providers/tools/staticTools';
import type { LLMProvider, LLMResponse, LLMToolDescription } from '../../../src/types';
import { userMessage } from '../../../src/types';
import type { RunnerLike } from '../../../src/types/multiAgent';

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

function mockRunner(content: string): RunnerLike {
  return {
    run: vi.fn(async () => ({ content, messages: [], iterations: 1 })),
  };
}

function makeSpecialist(id: string, description: string): SwarmSpecialist {
  return { id, description, runner: mockRunner(`${id}-result`) };
}

// ── Unit ────────────────────────────────────────────────────

describe('buildSwarmRouting — unit', () => {
  it('produces a RoutingConfig with specialist branches + final', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code specialist')],
    });

    expect(routing.deciderName).toBe('RouteSpecialist');
    expect(routing.defaultBranch).toBe('final');
    // coding branch + final branch
    expect(routing.branches).toHaveLength(2);
    expect(routing.branches[0].id).toBe('coding');
    expect(routing.branches[0].kind).toBe('lazy-subflow');
    expect(routing.branches[1].id).toBe('final');
    expect(routing.branches[1].kind).toBe('fn');
  });

  it('includes swarm-tools branch when extraTools provided', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code')],
      extraTools: [defineTool({ id: 'calc', description: 'Calculator', inputSchema: {}, handler: async () => ({ content: '42' }) })],
    });

    expect(routing.branches).toHaveLength(3); // coding + swarm-tools + final
    expect(routing.branches.find((b) => b.id === 'swarm-tools')).toBeDefined();
  });

  it('decider routes to specialist ID when LLM calls specialist tool', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code'), makeSpecialist('writing', 'Write')],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: 'writing', arguments: { message: 'write a poem' } }],
      },
    };

    const result = routing.decider(scope, () => {});
    expect(result).toBe('writing');
    expect(scope.specialistMessage).toBe('write a poem');
    expect(scope.specialistToolCallId).toBe('tc1');
  });

  it('decider routes to final when no tool calls', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code')],
    });

    const scope: any = {
      parsedResponse: { hasToolCalls: false, toolCalls: [], content: 'Done' },
    };

    expect(routing.decider(scope, () => {})).toBe('final');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('buildSwarmRouting — boundary', () => {
  it('single specialist produces 2 branches', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('only', 'The only one')],
    });
    expect(routing.branches).toHaveLength(2); // only + final
  });

  it('no extraTools — no swarm-tools branch', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('a', 'A')],
    });
    expect(routing.branches.find((b) => b.id === 'swarm-tools')).toBeUndefined();
  });

  it('decider routes to swarm-tools for extra tool calls', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code')],
      extraTools: [defineTool({ id: 'calc', description: 'Calc', inputSchema: {}, handler: async () => ({ content: '42' }) })],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: 'calc', arguments: { x: 1 } }],
      },
    };

    expect(routing.decider(scope, () => {})).toBe('swarm-tools');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('buildSwarmRouting — scenario', () => {
  it('integrates with buildAgentLoop — specialist routes and finalizes', async () => {
    // LLM call 1: routes to 'coding' specialist
    // LLM call 2: finalizes with result
    const provider = mockProvider([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: 'write fizzbuzz' } }],
      },
      { content: 'Here is the fizzbuzz code.' },
    ]);

    const specialists: SwarmSpecialist[] = [
      { id: 'coding', description: 'Code specialist', runner: mockRunner('def fizzbuzz(): ...') },
    ];

    const toolDescs: LLMToolDescription[] = specialists.map((s) => ({
      name: s.id,
      description: s.description,
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    }));

    const routing = buildSwarmRouting({ specialists });

    const config: AgentLoopConfig = {
      provider,
      systemPrompt: { provider: staticPrompt('You are an orchestrator.') },
      messages: { strategy: slidingWindow(50) },
      tools: { provider: staticTools(toolDescs) },
      registry: new ToolRegistry(),
      routing,
    };

    const { chart } = buildAgentLoop(config, { messages: [userMessage('write fizzbuzz')] });
    const executor = new FlowChartExecutor(chart);
    executor.enableNarrative();
    await executor.run();

    const snapshot = executor.getSnapshot();
    expect(snapshot.sharedState.result).toBe('Here is the fizzbuzz code.');
  });
});

// ── Property ────────────────────────────────────────────────

describe('buildSwarmRouting — property', () => {
  it('specialist lazy-subflow factories produce valid FlowCharts', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code')],
    });

    const lazyBranch = routing.branches.find((b) => b.kind === 'lazy-subflow');
    expect(lazyBranch).toBeDefined();
    if (lazyBranch?.kind === 'lazy-subflow') {
      const chart = lazyBranch.factory();
      expect(chart).toBeDefined();
      expect(chart.root).toBeDefined();
    }
  });

  it('every branch has a unique ID', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('a', 'A'), makeSpecialist('b', 'B')],
      extraTools: [defineTool({ id: 'calc', description: 'Calc', inputSchema: {}, handler: async () => ({ content: '42' }) })],
    });

    const ids = routing.branches.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Security ────────────────────────────────────────────────

describe('buildSwarmRouting — security', () => {
  it('unknown tool name routes to final (not specialist)', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code')],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: 'unknown-evil-tool', arguments: {} }],
      },
    };

    expect(routing.decider(scope, () => {})).toBe('final');
  });

  it('specialist message falls back to empty string when args.message missing', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code')],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: 'coding', arguments: {} }],
      },
    };

    routing.decider(scope, () => {});
    expect(scope.specialistMessage).toBe('');
  });

  it('throws when extra tool ID collides with specialist ID', () => {
    expect(() => buildSwarmRouting({
      specialists: [makeSpecialist('calc', 'Calculator specialist')],
      extraTools: [defineTool({ id: 'calc', description: 'Calc', inputSchema: {}, handler: async () => ({ content: '42' }) })],
    })).toThrow('collides with specialist ID');
  });

  it('sets routingWarning when multiple tool calls are dropped', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code')],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [
          { id: 'tc1', name: 'coding', arguments: { message: 'first' } },
          { id: 'tc2', name: 'coding', arguments: { message: 'second' } },
        ],
      },
    };

    routing.decider(scope, () => {});
    expect(scope.routingWarning).toContain('1 additional call(s) dropped');
  });

  it('sets routingWarning when unknown tool name is used', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code')],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: 'hallucinated-tool', arguments: {} }],
      },
    };

    expect(routing.decider(scope, () => {})).toBe('final');
    expect(scope.routingWarning).toContain('hallucinated-tool');
  });

  it('specialist message coerces non-string to empty (LLM injection guard)', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding', 'Code')],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: { nested: true } } }],
      },
    };

    routing.decider(scope, () => {});
    expect(scope.specialistMessage).toBe('');
  });
});

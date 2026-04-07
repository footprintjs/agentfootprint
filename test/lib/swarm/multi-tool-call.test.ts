/**
 * Swarm multi-tool-call — 5-pattern tests.
 *
 * Tests that the Swarm routing handles multiple tool calls per LLM response:
 * - Extra tools: all executed in one pass
 * - Specialists: first routed, loop handles rest
 * - Mixed: extra tools + specialist in same response
 * - Unknown tools: skipped with warning
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
import type { LLMProvider, LLMResponse, LLMToolDescription } from '../../../src/types';
import { userMessage } from '../../../src/types';
import type { RunnerLike } from '../../../src/types/multiAgent';

// ── Helpers ──────────────────────────────────────────────────

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let i = 0;
  return { chat: vi.fn(async () => responses[i++] ?? responses[responses.length - 1]) };
}

function mockRunner(content: string): RunnerLike {
  return { run: vi.fn(async () => ({ content, messages: [], iterations: 1 })) };
}

function makeSpecialist(id: string): SwarmSpecialist {
  return { id, description: `${id} specialist`, runner: mockRunner(`${id}-result`) };
}

const calcTool = defineTool({
  id: 'calculator',
  description: 'Calculate',
  inputSchema: {},
  handler: async () => ({ content: '42' }),
});

const searchTool = defineTool({
  id: 'search',
  description: 'Search',
  inputSchema: {},
  handler: async () => ({ content: 'Found results' }),
});

function buildSwarmWithConfig(
  specialists: SwarmSpecialist[],
  extraTools: any[],
  provider: LLMProvider,
) {
  const toolDescs: LLMToolDescription[] = [
    ...specialists.map((s) => ({
      name: s.id,
      description: s.description,
      inputSchema: {
        type: 'object' as const,
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    })),
    ...extraTools.map((t: any) => ({
      name: t.id,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  ];
  const routing = buildSwarmRouting({
    specialists,
    extraTools: extraTools.length > 0 ? extraTools : undefined,
  });
  const config: AgentLoopConfig = {
    provider,
    systemPrompt: { provider: staticPrompt('Orchestrator') },
    messages: { strategy: slidingWindow({ maxMessages: 50 }) },
    tools: { provider: { resolve: () => ({ value: toolDescs, chosen: 'swarm' }) } },
    registry: new ToolRegistry(),
    routing,
  };
  return buildAgentLoop(config, { messages: [userMessage('test')] });
}

// ── Unit ────────────────────────────────────────────────────

describe('Swarm multi-tool-call — unit', () => {
  it('decider iterates through toolCalls to find first match', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding'), makeSpecialist('writing')],
      extraTools: [calcTool],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [
          { id: 'tc1', name: 'calculator', arguments: {} },
          { id: 'tc2', name: 'coding', arguments: { message: 'fizzbuzz' } },
        ],
      },
    };

    // Calculator comes first → routes to swarm-tools
    expect(routing.decider(scope, () => {})).toBe('swarm-tools');
  });

  it('decider routes to specialist when it comes first', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding')],
      extraTools: [calcTool],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [
          { id: 'tc1', name: 'coding', arguments: { message: 'code' } },
          { id: 'tc2', name: 'calculator', arguments: {} },
        ],
      },
    };

    expect(routing.decider(scope, () => {})).toBe('coding');
    expect(scope.specialistMessage).toBe('code');
  });

  it('unknown tools skipped, first valid tool matched', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding')],
      extraTools: [calcTool],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [
          { id: 'tc1', name: 'unknown_tool', arguments: {} },
          { id: 'tc2', name: 'calculator', arguments: {} },
        ],
      },
    };

    expect(routing.decider(scope, () => {})).toBe('swarm-tools');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('Swarm multi-tool-call — boundary', () => {
  it('all unknown tools route to final with warning', () => {
    const routing = buildSwarmRouting({ specialists: [makeSpecialist('coding')] });
    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [
          { id: 'tc1', name: 'fake1', arguments: {} },
          { id: 'tc2', name: 'fake2', arguments: {} },
        ],
      },
    };

    expect(routing.decider(scope, () => {})).toBe('final');
    expect(scope.routingWarning).toContain('fake1');
    expect(scope.routingWarning).toContain('fake2');
  });

  it('empty toolCalls routes to final', () => {
    const routing = buildSwarmRouting({ specialists: [makeSpecialist('coding')] });
    const scope: any = { parsedResponse: { hasToolCalls: true, toolCalls: [] } };
    expect(routing.decider(scope, () => {})).toBe('final');
  });

  it('single tool call works (backward compat)', () => {
    const routing = buildSwarmRouting({ specialists: [makeSpecialist('coding')] });
    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: 'hello' } }],
      },
    };
    expect(routing.decider(scope, () => {})).toBe('coding');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('Swarm multi-tool-call — scenario', () => {
  it('multiple extra tools all executed in swarm-tools subflow', async () => {
    const calcHandler = vi.fn(async () => ({ content: '42' }));
    const searchHandler = vi.fn(async () => ({ content: 'Found it' }));

    const tools = [
      defineTool({ id: 'calculator', description: 'Calc', inputSchema: {}, handler: calcHandler }),
      defineTool({ id: 'search', description: 'Search', inputSchema: {}, handler: searchHandler }),
    ];

    const provider = mockProvider([
      {
        content: '',
        toolCalls: [
          { id: 'tc1', name: 'calculator', arguments: {} },
          { id: 'tc2', name: 'search', arguments: {} },
        ],
      },
      { content: 'Done with both tools.' },
    ]);

    const { chart } = buildSwarmWithConfig([makeSpecialist('coding')], tools, provider);
    const executor = new FlowChartExecutor(chart);
    await executor.run();

    expect(calcHandler).toHaveBeenCalled();
    expect(searchHandler).toHaveBeenCalled();
    expect(executor.getSnapshot()?.sharedState?.result).toBe('Done with both tools.');
  });
});

// ── Property ────────────────────────────────────────────────

describe('Swarm multi-tool-call — property', () => {
  it('specialist message capped at 100KB', () => {
    const routing = buildSwarmRouting({ specialists: [makeSpecialist('coding')] });
    const longMsg = 'x'.repeat(200_000);

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: longMsg } }],
      },
    };

    routing.decider(scope, () => {});
    expect(scope.specialistMessage.length).toBeLessThanOrEqual(100_000);
  });

  it('first match wins when multiple tool types present', () => {
    const routing = buildSwarmRouting({
      specialists: [makeSpecialist('coding'), makeSpecialist('writing')],
    });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [
          { id: 'tc1', name: 'writing', arguments: { message: 'poem' } },
          { id: 'tc2', name: 'coding', arguments: { message: 'code' } },
        ],
      },
    };

    expect(routing.decider(scope, () => {})).toBe('writing');
    expect(scope.specialistMessage).toBe('poem');
  });
});

// ── Security ────────────────────────────────────────────────

describe('Swarm multi-tool-call — security', () => {
  it('non-string specialist message coerced to empty string', () => {
    const routing = buildSwarmRouting({ specialists: [makeSpecialist('coding')] });

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: { injected: true } } }],
      },
    };

    routing.decider(scope, () => {});
    expect(scope.specialistMessage).toBe('');
  });

  it('unknown tool names truncated in warning', () => {
    const routing = buildSwarmRouting({ specialists: [makeSpecialist('coding')] });
    const longName = 'a'.repeat(200);

    const scope: any = {
      parsedResponse: {
        hasToolCalls: true,
        toolCalls: [{ id: 'tc1', name: longName, arguments: {} }],
      },
    };

    routing.decider(scope, () => {});
    expect(scope.routingWarning).toBeDefined();
    expect(scope.routingWarning!.length).toBeLessThan(200); // truncated
  });
});

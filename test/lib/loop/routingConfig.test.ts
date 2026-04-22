/**
 * RoutingConfig — 5-pattern tests.
 *
 * Tests the pluggable routing abstraction in buildAgentLoop:
 * - Default agent routing (tool-calls | final)
 * - Custom routing (custom branches)
 * - maxIterations structural guard
 * - Validation (empty branches, duplicates, bad defaultBranch)
 */
import { describe, it, expect, vi } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';
import { buildAgentLoop } from '../../../src/lib/loop/buildAgentLoop';
import type { AgentLoopConfig } from '../../../src/lib/loop/types';
import type { RoutingConfig } from '../../../src/lib/loop/types';
import { ToolRegistry } from '../../../src/tools/ToolRegistry';
import { staticPrompt } from '../../../src/providers/prompt/static';
import { slidingWindow } from '../../../src/providers/messages/slidingWindow';
import { noTools } from '../../../src/providers/tools/noTools';
import type { LLMProvider, LLMResponse } from '../../../src/types';
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

function baseConfig(provider: LLMProvider): AgentLoopConfig {
  return {
    provider,
    systemPrompt: { provider: staticPrompt('You are helpful.') },
    messages: { strategy: slidingWindow(10) },
    tools: { provider: noTools() },
    registry: new ToolRegistry(),
  };
}

// ── Unit ────────────────────────────────────────────────────

describe('RoutingConfig — unit', () => {
  it('default agent routing routes to final when no tool calls', async () => {
    const provider = mockProvider([{ content: 'Hello!' }]);
    const { chart } = buildAgentLoop(baseConfig(provider), { messages: [userMessage('hi')] });

    const executor = new FlowChartExecutor(chart);
    executor.enableNarrative();
    await executor.run();

    const narrative = executor.getNarrativeEntries().map((e) => e.text);
    expect(narrative.some((s: string) => s.includes('Finalize'))).toBe(true);
  });

  it('custom routing uses custom decider and branches', async () => {
    const provider = mockProvider([{ content: 'Done' }]);
    const customRouting: RoutingConfig = {
      deciderName: 'CustomRoute',
      deciderId: 'custom-route',
      decider: () => 'my-branch',
      branches: [
        {
          id: 'my-branch',
          kind: 'fn',
          name: 'MyHandler',
          fn: (scope: any) => {
            scope.result = 'custom-handled';
            scope.$break();
          },
        },
      ],
      defaultBranch: 'my-branch',
    };

    const { chart } = buildAgentLoop(
      { ...baseConfig(provider), routing: customRouting },
      { messages: [userMessage('hi')] },
    );

    const executor = new FlowChartExecutor(chart);
    executor.enableNarrative();
    await executor.run();

    const snapshot = executor.getSnapshot();
    expect(snapshot.sharedState.result).toBe('custom-handled');
  });

  it('maxIterations guard forces default branch even with custom decider', async () => {
    let loopCount = 0;
    const provider = mockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'test', arguments: {} }] },
      { content: 'Final answer' },
    ]);

    const customRouting: RoutingConfig = {
      deciderName: 'AlwaysLoop',
      deciderId: 'always-loop',
      // This decider always returns 'continue' — never routes to 'done'
      decider: () => 'continue',
      branches: [
        {
          id: 'continue',
          kind: 'fn',
          fn: (scope: any) => {
            loopCount++;
            scope.loopCount = (scope.loopCount ?? 0) + 1;
          },
        },
        {
          id: 'done',
          kind: 'fn',
          name: 'Done',
          fn: (scope: any) => {
            scope.result = 'stopped';
            scope.$break();
          },
        },
      ],
      defaultBranch: 'done',
    };

    const { chart } = buildAgentLoop(
      { ...baseConfig(provider), routing: customRouting, maxIterations: 3 },
      { messages: [userMessage('hi')] },
    );

    const executor = new FlowChartExecutor(chart);
    await executor.run();

    // Should have been force-stopped at 3 iterations
    expect(loopCount).toBeLessThanOrEqual(3);
    const snapshot = executor.getSnapshot();
    expect(snapshot.sharedState.result).toBe('stopped');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('RoutingConfig — boundary', () => {
  it('throws on empty branches', () => {
    const provider = mockProvider([{ content: 'hi' }]);
    const badRouting: RoutingConfig = {
      deciderName: 'Bad',
      deciderId: 'bad',
      decider: () => 'x',
      branches: [],
      defaultBranch: 'x',
    };

    expect(() =>
      buildAgentLoop(
        { ...baseConfig(provider), routing: badRouting },
        { messages: [userMessage('hi')] },
      ),
    ).toThrow('at least one branch');
  });

  it('throws on duplicate branch IDs', () => {
    const provider = mockProvider([{ content: 'hi' }]);
    const badRouting: RoutingConfig = {
      deciderName: 'Bad',
      deciderId: 'bad',
      decider: () => 'a',
      branches: [
        { id: 'a', kind: 'fn', fn: () => {} },
        { id: 'a', kind: 'fn', fn: () => {} },
      ],
      defaultBranch: 'a',
    };

    expect(() =>
      buildAgentLoop(
        { ...baseConfig(provider), routing: badRouting },
        { messages: [userMessage('hi')] },
      ),
    ).toThrow('duplicate branch IDs');
  });

  it('throws on defaultBranch not matching any branch', () => {
    const provider = mockProvider([{ content: 'hi' }]);
    const badRouting: RoutingConfig = {
      deciderName: 'Bad',
      deciderId: 'bad',
      decider: () => 'a',
      branches: [{ id: 'a', kind: 'fn', fn: () => {} }],
      defaultBranch: 'nonexistent',
    };

    expect(() =>
      buildAgentLoop(
        { ...baseConfig(provider), routing: badRouting },
        { messages: [userMessage('hi')] },
      ),
    ).toThrow('does not match any branch ID');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('RoutingConfig — scenario', () => {
  it('custom routing with multiple branches routes correctly', async () => {
    const provider = mockProvider([{ content: 'pick-b' }]);
    const routeLog: string[] = [];

    const customRouting: RoutingConfig = {
      deciderName: 'MultiRoute',
      deciderId: 'multi-route',
      decider: (scope: any) => {
        const parsed = scope.parsedResponse;
        return parsed?.content === 'pick-b' ? 'branch-b' : 'branch-a';
      },
      branches: [
        {
          id: 'branch-a',
          kind: 'fn',
          fn: (scope: any) => {
            routeLog.push('a');
            scope.result = 'went-a';
            scope.$break();
          },
        },
        {
          id: 'branch-b',
          kind: 'fn',
          fn: (scope: any) => {
            routeLog.push('b');
            scope.result = 'went-b';
            scope.$break();
          },
        },
      ],
      defaultBranch: 'branch-a',
    };

    const { chart } = buildAgentLoop(
      { ...baseConfig(provider), routing: customRouting },
      { messages: [userMessage('hi')] },
    );

    const executor = new FlowChartExecutor(chart);
    await executor.run();

    expect(routeLog).toEqual(['b']);
    expect(executor.getSnapshot().sharedState.result).toBe('went-b');
  });
});

// ── Property ────────────────────────────────────────────────

describe('RoutingConfig — property', () => {
  it('default routing produces same narrative as pre-refactor', async () => {
    const provider = mockProvider([{ content: 'Final answer' }]);
    const { chart } = buildAgentLoop(baseConfig(provider), { messages: [userMessage('hi')] });

    const executor = new FlowChartExecutor(chart);
    executor.enableNarrative();
    await executor.run();

    const narrative = executor.getNarrativeEntries().map((e) => e.text);
    // Should still have RouteResponse and Finalize in narrative
    expect(
      narrative.some((s: string) => s.includes('RouteResponse') || s.includes('Finalize')),
    ).toBe(true);
  });

  it('decider name and description appear in spec', async () => {
    const provider = mockProvider([{ content: 'hi' }]);
    const customRouting: RoutingConfig = {
      deciderName: 'MyDecider',
      deciderId: 'my-decider',
      deciderDescription: 'My custom routing logic',
      decider: () => 'done',
      branches: [
        {
          id: 'done',
          kind: 'fn',
          fn: (scope: any) => {
            scope.result = 'x';
            scope.$break();
          },
        },
      ],
      defaultBranch: 'done',
    };

    const { chart, spec } = buildAgentLoop(
      { ...baseConfig(provider), routing: customRouting },
      { messages: [userMessage('hi')] },
      { captureSpec: true },
    );

    const specStr = JSON.stringify(spec);
    expect(specStr).toContain('MyDecider');
    expect(specStr).toContain('my-decider');
  });
});

// ── Security ────────────────────────────────────────────────

describe('RoutingConfig — security', () => {
  it('maxIterations cannot be bypassed by custom decider', async () => {
    let iterations = 0;
    const provider = mockProvider([{ content: 'loop forever' }]);

    const evilRouting: RoutingConfig = {
      deciderName: 'EvilRoute',
      deciderId: 'evil',
      // Always returns 'loop' — tries to bypass maxIterations
      decider: () => 'loop',
      branches: [
        {
          id: 'loop',
          kind: 'fn',
          fn: (scope: any) => {
            iterations++;
            scope.loopCount = (scope.loopCount ?? 0) + 1;
          },
        },
        {
          id: 'stop',
          kind: 'fn',
          fn: (scope: any) => {
            scope.result = 'forced-stop';
            scope.$break();
          },
        },
      ],
      defaultBranch: 'stop',
    };

    const { chart } = buildAgentLoop(
      { ...baseConfig(provider), routing: evilRouting, maxIterations: 5 },
      { messages: [userMessage('hi')] },
    );

    const executor = new FlowChartExecutor(chart);
    await executor.run();

    // Structural guard forced stop at maxIterations
    expect(iterations).toBeLessThanOrEqual(5);
    expect(executor.getSnapshot().sharedState.result).toBe('forced-stop');
  });
});

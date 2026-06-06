/**
 * agent-messageapi-chart.test.ts
 *
 * Proves Step 2 — the Agent (ReAct) merge-tree. Two-stage convergence:
 *   Context (root selector) → [sf-message-api (sys+msg→messageAPI), sf-tools]
 *     → Call-LLM → Route → [tool-exec → loop] / final.
 *
 * Keystones:
 *   - the root Context selector runs BOTH groups (assembly subflow + tools);
 *   - Call-LLM is a 2-PARENT MERGE — it reads the assembled payload AND the
 *     tool schemas (both branches converged into it);
 *   - the ReAct loop runs tools then loops back to Context (multi-iteration);
 *   - the structure shows the nested assembly (sf-message-api) + sf-tools.
 */

import { describe, it, expect } from 'vitest';
import type { CombinedRecorder, FlowSubflowEvent } from 'footprintjs';
import { FlowChartExecutor } from 'footprintjs';
import { buildAgentMessageApiChart } from '../../../src/core/agent/buildAgentMessageApiChart.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

const WEATHER_TOOL = {
  name: 'weather',
  description: 'Get weather for a city',
  inputSchema: { type: 'object' as const, properties: { city: { type: 'string' } } },
};

/** Find a node by id in a build-time spec tree (walks children + next). */
function findSpec(spec: unknown, id: string): Record<string, unknown> | undefined {
  const s = spec as Record<string, unknown> | undefined;
  if (!s) return undefined;
  if (s.id === id) return s;
  for (const child of (s.children as unknown[] | undefined) ?? []) {
    const found = findSpec(child, id);
    if (found) return found;
  }
  return findSpec(s.next, id);
}

function subflowSpy(): { recorder: CombinedRecorder; entries: string[] } {
  const entries: string[] = [];
  const recorder: CombinedRecorder = {
    id: 'test.agent-msgapi-spy',
    onSubflowEntry(e: FlowSubflowEvent): void {
      if (e.subflowId) entries.push(e.subflowId);
    },
  };
  return { recorder, entries };
}

describe('Agent messageAPI merge-tree (ReAct, two-stage)', () => {
  it('functional: one-shot (no tool calls) runs end-to-end and returns the answer', async () => {
    const chart = buildAgentMessageApiChart({
      provider: new MockProvider({ reply: 'The capital of France is Paris.' }) as never,
      model: 'mock',
      systemPrompt: 'You are a geography tutor.',
      tools: [WEATHER_TOOL] as never,
    });
    const executor = new FlowChartExecutor(chart);
    await executor.run({ input: { message: 'capital of France?' } });

    const state = executor.getSnapshot()?.sharedState as { finalContent?: string };
    expect(state.finalContent).toBe('The capital of France is Paris.');
  });

  it('keystone: the three context slots run as DIRECT children of Context (flat chart)', async () => {
    const chart = buildAgentMessageApiChart({
      provider: new MockProvider({ reply: 'ok' }) as never,
      model: 'mock',
      systemPrompt: 'sys',
      tools: [WEATHER_TOOL] as never,
    });
    const executor = new FlowChartExecutor(chart);
    const spy = subflowSpy();
    executor.attachCombinedRecorder(spy.recorder);
    await executor.run({ input: { message: 'hi' } });

    // ONE flat chart — the 3 slots are direct children of Context (no inner
    // sf-llm-call box). They are top-level subflows, so exact ids.
    expect(spy.entries).toContain('sf-system-prompt');
    expect(spy.entries).toContain('sf-messages');
    expect(spy.entries).toContain('sf-tools');
    // No nested LLM-call box anymore (flat shape).
    expect(spy.entries).not.toContain('sf-llm-call');
  });

  it('keystone: Call-LLM is a 2-parent MERGE — it receives BOTH messages and tools', async () => {
    let sawMessages = false;
    let sawTools = false;
    const provider = new MockProvider({
      respond: (req: { messages?: unknown[]; tools?: unknown[] }) => {
        if ((req.messages?.length ?? 0) > 0) sawMessages = true;
        if ((req.tools?.length ?? 0) > 0) sawTools = true;
        return 'done';
      },
    });
    const chart = buildAgentMessageApiChart({
      provider: provider as never,
      model: 'mock',
      systemPrompt: 'sys',
      tools: [WEATHER_TOOL] as never,
    });
    await new FlowChartExecutor(chart).run({ input: { message: 'hello' } });

    expect(sawMessages).toBe(true); // assembly branch reached Call-LLM
    expect(sawTools).toBe(true); // tools branch reached Call-LLM (the 2nd join)
  });

  it('integration: ReAct loop — tool call on turn 1, loops back, finalizes on turn 2', async () => {
    // Turn 1: LLM asks for a tool. Turn 2: LLM gives the final answer.
    const provider = new MockProvider({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'weather', args: { city: 'SF' } }] },
        { content: 'It is sunny in SF.' },
      ],
    });
    const chart = buildAgentMessageApiChart({
      provider: provider as never,
      model: 'mock',
      systemPrompt: 'You answer weather questions.',
      tools: [WEATHER_TOOL] as never,
      maxIterations: 5,
    });
    const executor = new FlowChartExecutor(chart);
    await executor.run({ input: { message: 'weather in SF?' } });

    const state = executor.getSnapshot()?.sharedState as {
      finalContent?: string;
      iteration?: number;
      history?: readonly { role: string }[];
    };
    expect(state.finalContent).toBe('It is sunny in SF.'); // finalized on turn 2
    expect(state.iteration).toBe(2); // looped exactly once
    // The tool result got appended to history before turn 2.
    expect(state.history?.some((m) => m.role === 'tool')).toBe(true);
  });

  it('structure: ONE flat chart — Context root selector, all stages in the same chart', () => {
    const chart = buildAgentMessageApiChart({
      provider: new MockProvider({ reply: 'ok' }) as never,
      model: 'mock',
      systemPrompt: 's',
      tools: [WEATHER_TOOL] as never,
    });
    // Agent root IS the Context selector (no agent-entry/sf-llm-call wrapper).
    expect(chart.root.id).toBe('context');
    expect(chart.root.selectorFn).toBe(true);

    const json = JSON.stringify(chart.buildTimeStructure);
    expect(json).toContain('sf-system-prompt'); // 3 direct context slots
    expect(json).toContain('sf-messages');
    expect(json).toContain('sf-tools');
    expect(json).toContain('message-api'); // the messageAPI join (sys+msg)
    expect(json).toContain('call-llm'); // the LLM call
    expect(json).toContain('"type":"decider"'); // the Route decider, same chart
    expect(json).toContain('tool-calls'); // ToolCalls branch
    expect(json).toContain('final'); // Final/response branch
    // FLAT — no inner LLM-call box, no assembly sub-box.
    expect(json).not.toContain('sf-llm-call');
    expect(json).not.toContain('sf-message-api');
  });

  it('structure: tools BYPASSES messageAPI — it converges at call-llm (2-parent merge), faithful to Anthropic', () => {
    const chart = buildAgentMessageApiChart({
      provider: new MockProvider({ reply: 'ok' }) as never,
      model: 'mock',
      systemPrompt: 's',
      tools: [WEATHER_TOOL] as never,
    });
    const struct = chart.buildTimeStructure;
    // The tools slot declares it rejoins at call-llm, not the default message-api.
    const tools = findSpec(struct, 'sf-tools')!;
    expect(tools.convergeAt).toBe('call-llm');
    // system-prompt + messages carry NO convergeAt → they converge at messageAPI.
    expect(findSpec(struct, 'sf-system-prompt')!.convergeAt).toBeUndefined();
    expect(findSpec(struct, 'sf-messages')!.convergeAt).toBeUndefined();
  });

  it('structure: the ReAct loop is sourced from the TOOL-CALLS branch → context, NOT the Route decider', () => {
    const chart = buildAgentMessageApiChart({
      provider: new MockProvider({ reply: 'ok' }) as never,
      model: 'mock',
      systemPrompt: 's',
      tools: [WEATHER_TOOL] as never,
    });
    const struct = chart.buildTimeStructure;
    // The tool-calls branch owns the loop back to context.
    const toolCalls = findSpec(struct, 'tool-calls')!;
    expect(toolCalls.loopTarget).toBe('context');
    // The Route decider itself does NOT loop (the old, misattributed shape).
    expect(findSpec(struct, 'sf-route')!.loopTarget).toBeUndefined();
    // Final terminates as a leaf — no loop.
    expect(findSpec(struct, 'final')!.loopTarget).toBeUndefined();
  });
});

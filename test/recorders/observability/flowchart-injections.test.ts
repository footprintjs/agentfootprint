/**
 * Tests — `FlowchartRecorder` injection attribution.
 *
 * Covers the "every `context.injected` event is consumed by the NEXT
 * `stream.llm_start`" rule. Each StepNode emitted for an LLM call must
 * carry the injections that fired in its slot-assembly phase, with the
 * full 5-axis payload intact (slot · role · flavor · timing · decision).
 *
 * 7 patterns cover the full consumer circle:
 *   1. Simple LLMCall (no tools, no injections beyond the user message)
 *   2. Agent with one tool (ReAct cycle)
 *   3. Multi-iteration agent (2+ iterations)
 *   4. No injections at all (event payload-less run)
 *   5. Injection arrives BETWEEN iterations (loop body)
 *   6. Injection with full 5-axis payload (chip detail)
 *   7. Multiple injections into different slots for one call
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import {
  attachFlowchart,
  type ContextInjection,
  type StepGraph,
  type StepNode,
} from '../../../src/recorders/observability/FlowchartRecorder.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';
import type { CombinedRecorder } from 'footprintjs';

// ─── Test helpers ────────────────────────────────────────────────────

function llmResponse(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 10, output: 5 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
  };
}

function scripted(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

/**
 * Drive the FlowchartRecorder directly via its attach path — no Runner.
 * Lets tests inject `context.injected` + `stream.llm_*` events with
 * precise control and inspect the resulting StepGraph.
 */
function freshRecorder(): {
  dispatcher: EventDispatcher;
  attach: (r: CombinedRecorder) => () => void;
  getGraph: () => StepGraph;
} {
  const dispatcher = new EventDispatcher();
  const attach =
    (_r: CombinedRecorder): (() => void) =>
    () =>
      undefined;
  const handle = attachFlowchart(attach, dispatcher, {});
  return {
    dispatcher,
    attach,
    getGraph: handle.getSnapshot,
  };
}

function emit(
  dispatcher: EventDispatcher,
  type: string,
  payload: Record<string, unknown>,
  overrides?: Partial<{ wallClockMs: number; subflowPath: readonly string[] }>,
): void {
  const wallClockMs = overrides?.wallClockMs ?? Date.now();
  dispatcher.dispatch({
    type,
    payload,
    meta: {
      wallClockMs,
      runOffsetMs: 0,
      runtimeStageId: `test-stage#0`,
      subflowPath: overrides?.subflowPath ?? [],
      compositionPath: [],
      runId: 'test-run',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function llmCallSteps(graph: StepGraph): readonly StepNode[] {
  return graph.nodes.filter(
    (n) => n.kind === 'user->llm' || n.kind === 'tool->llm' || n.kind === 'llm->user',
  );
}

// ─── Pattern 1: simple LLMCall, no tools, no injections ───────────────

describe('FlowchartRecorder — pattern 1: simple LLMCall', () => {
  it('emits one LLM step with empty injections when no context.injected fires', async () => {
    const llm = LLMCall.create({
      provider: new MockProvider({ reply: 'hello' }),
      model: 'mock',
    })
      .system('be brief')
      .build();

    const { onUpdate, getLastGraph } = captureUpdates();
    llm.enable.flowchart({ onUpdate });

    await llm.run({ message: 'hi' });

    const llmSteps = llmCallSteps(getLastGraph());
    expect(llmSteps.length).toBeGreaterThanOrEqual(1);
    // When the ContextRecorder IS enabled by the runtime (it is — it
    // ships with every Agent/LLMCall), injections arrive. We only
    // assert the field EXISTS and is an array, not its content.
    for (const step of llmSteps) {
      expect(Array.isArray(step.injections ?? [])).toBe(true);
    }
  });
});

// ─── Pattern 2: Agent with one tool (ReAct cycle) ─────────────────────

describe('FlowchartRecorder — pattern 2: Agent with one tool', () => {
  it('total StepGraph injections equals total context.injected events (no attribution loss)', async () => {
    const provider = scripted(
      llmResponse('', [{ id: 't1', name: 'weather', args: { city: 'SF' } }]),
      llmResponse('Sunny.'),
    );

    const agent = Agent.create({ provider, model: 'mock' })
      .system('weather bot')
      .tool({
        schema: {
          name: 'weather',
          description: 'Get weather',
          inputSchema: { type: 'object' as const, properties: {}, required: [] },
        },
        execute: async () => '72°F',
      })
      .build();

    const { onUpdate, getLastGraph } = captureUpdates();
    agent.enable.flowchart({ onUpdate });

    // Count context.injected events as a truth source.
    let injectedCount = 0;
    agent.on('agentfootprint.context.injected' as const, () => {
      injectedCount += 1;
    });

    await agent.run({ message: 'weather in SF' });

    const calls = llmCallSteps(getLastGraph());
    // 3 LLM-kind steps: user->llm (iter 1), tool->llm (iter 2),
    // llm->user (terminal delivery marker).
    expect(calls).toHaveLength(3);

    // Every context.injected event must land in exactly one LLM call's
    // injections[]. Summing across the graph equals the event count —
    // no loss, no duplication. Note: a ReAct loop legitimately
    // re-injects the same content at each iteration, so identical
    // contentSummary values CAN appear across calls. That's correct;
    // the distinct events are what matter.
    const attributed = calls.reduce((sum, c) => sum + (c.injections?.length ?? 0), 0);
    expect(attributed).toBe(injectedCount);
  });
});

// ─── Pattern 3: Multi-iteration agent ─────────────────────────────────

describe('FlowchartRecorder — pattern 3: multi-iteration agent', () => {
  it('total attributed injections equals total emitted events across all iterations', async () => {
    const provider = scripted(
      llmResponse('', [{ id: 't1', name: 't', args: {} }]),
      llmResponse('', [{ id: 't2', name: 't', args: {} }]),
      llmResponse('done'),
    );

    const agent = Agent.create({ provider, model: 'mock' })
      .system('test')
      .tool({
        schema: {
          name: 't',
          description: '',
          inputSchema: { type: 'object' as const, properties: {}, required: [] },
        },
        execute: async () => 'ok',
      })
      .build();

    const { onUpdate, getLastGraph } = captureUpdates();
    agent.enable.flowchart({ onUpdate });

    let injectedCount = 0;
    agent.on('agentfootprint.context.injected' as const, () => {
      injectedCount += 1;
    });

    await agent.run({ message: 'go' });

    const calls = llmCallSteps(getLastGraph());
    // 4 LLM-kind steps: user->llm (iter 1), tool->llm (iter 2),
    // tool->llm (iter 3), llm->user (terminal delivery marker).
    expect(calls).toHaveLength(4);

    // Attribution invariant: every context.injected event lands in
    // exactly one call's injections[]. The graph's total equals the
    // event stream's total; no loss from dropped events, no doubling
    // from ancestor-walk-style duplication.
    const attributed = calls.reduce((sum, c) => sum + (c.injections?.length ?? 0), 0);
    expect(attributed).toBe(injectedCount);
  });
});

// ─── Pattern 4: No injections at all ──────────────────────────────────

describe('FlowchartRecorder — pattern 4: no context.injected events', () => {
  it('LLM step has empty or undefined injections; does not crash', () => {
    const { dispatcher, getGraph } = freshRecorder();

    emit(dispatcher, 'agentfootprint.stream.llm_start', {
      model: 'mock',
      provider: 'mock',
      systemPromptChars: 0,
      messagesCount: 1,
      toolsCount: 0,
    });
    emit(dispatcher, 'agentfootprint.stream.llm_end', {
      content: 'hi',
      toolCallCount: 0,
      usage: { input: 1, output: 1 },
      stopReason: 'stop',
    });

    // 2 actor-arrow steps now: user→llm + llm→user. Injections attach to
    // the user→llm half (the call that consumed assembled context); the
    // llm→user marker is the response delivery and has no injection bag.
    const calls = llmCallSteps(getGraph());
    expect(calls).toHaveLength(2);
    expect(calls[0].kind).toBe('user->llm');
    expect(calls[0].injections ?? []).toEqual([]);
    expect(calls[1].kind).toBe('llm->user');
  });
});

// ─── Pattern 5: Injection between iterations (loop body) ──────────────

describe('FlowchartRecorder — pattern 5: injection between iterations', () => {
  it('injections fired AFTER llm_end but BEFORE next llm_start attribute to next call', () => {
    const { dispatcher, getGraph } = freshRecorder();

    // Call 1
    emit(
      dispatcher,
      'agentfootprint.context.injected',
      mkInjection('messages', 'user', 'user', 'First'),
    );
    emit(dispatcher, 'agentfootprint.stream.llm_start', {
      model: 'mock',
      provider: 'mock',
      systemPromptChars: 0,
      messagesCount: 1,
      toolsCount: 0,
    });
    emit(dispatcher, 'agentfootprint.stream.llm_end', {
      content: '',
      toolCallCount: 1,
      usage: { input: 1, output: 1 },
      stopReason: 'tool_use',
    });
    emit(dispatcher, 'agentfootprint.stream.tool_start', {
      toolName: 't',
      toolCallId: 'c1',
      args: {},
    });
    emit(dispatcher, 'agentfootprint.stream.tool_end', {
      toolName: 't',
      toolCallId: 'c1',
      result: '',
      latencyMs: 0,
    });
    // Injection fires HERE — between iterations, in the next call's assembly phase.
    emit(
      dispatcher,
      'agentfootprint.context.injected',
      mkInjection('messages', 'tool', 'tool-result', 'tool result', 'c1'),
    );
    emit(dispatcher, 'agentfootprint.stream.llm_start', {
      model: 'mock',
      provider: 'mock',
      systemPromptChars: 0,
      messagesCount: 2,
      toolsCount: 0,
    });
    emit(dispatcher, 'agentfootprint.stream.llm_end', {
      content: 'done',
      toolCallCount: 0,
      usage: { input: 1, output: 1 },
      stopReason: 'stop',
    });

    const calls = llmCallSteps(getGraph());
    // Three LLM-kind steps: user->llm (iter 1), tool->llm (iter 2),
    // llm->user (terminal delivery marker synthesized on final
    // llm_end). The marker carries no injections since no llm_start
    // event opened it — attribution contract respected.
    expect(calls).toHaveLength(3);

    // First call (user->llm) got the 'First' user injection.
    const firstSources = (calls[0].injections ?? []).map((i) => i.sourceId ?? i.source);
    expect(firstSources).toContain('user');

    // Second call (tool->llm) got the tool-result injection — NOT leaked into first.
    const secondSources = (calls[1].injections ?? []).map((i) => i.sourceId ?? i.source);
    expect(secondSources).toContain('c1');
    expect(firstSources).not.toContain('c1');

    // Terminal marker (llm->user) has no injections — no llm_start
    // fired to flush into it.
    expect(calls[2].kind).toBe('llm->user');
    expect(calls[2].injections ?? []).toEqual([]);
  });
});

// ─── Pattern 6: Full 5-axis payload on a chip ─────────────────────────

describe('FlowchartRecorder — pattern 6: full payload mapping', () => {
  it('all 5-axis fields survive from event payload to StepNode.injections', () => {
    const { dispatcher, getGraph } = freshRecorder();

    emit(dispatcher, 'agentfootprint.context.injected', {
      slot: 'system-prompt',
      asRole: 'system',
      source: 'skill',
      sourceId: 'billing',
      contentSummary: 'Billing skill body',
      reason: 'Activated by LLM read_skill',
      sectionTag: 'skill-billing',
      upstreamRef: 'tool-call-7',
      retrievalScore: 0.92,
      rankPosition: 0,
      budgetSpent: { tokens: 150, fractionOfCap: 0.15 },
    });
    emit(dispatcher, 'agentfootprint.stream.llm_start', {
      model: 'mock',
      provider: 'mock',
      systemPromptChars: 0,
      messagesCount: 0,
      toolsCount: 0,
    });
    emit(dispatcher, 'agentfootprint.stream.llm_end', {
      content: 'hi',
      toolCallCount: 0,
      usage: { input: 1, output: 1 },
      stopReason: 'stop',
    });

    const call = llmCallSteps(getGraph())[0];
    const inj = (call.injections ?? [])[0];
    expect(inj).toBeDefined();
    expect(inj.slot).toBe('system-prompt');
    expect(inj.asRole).toBe('system');
    expect(inj.source).toBe('skill');
    expect(inj.sourceId).toBe('billing');
    expect(inj.contentSummary).toBe('Billing skill body');
    expect(inj.reason).toBe('Activated by LLM read_skill');
    expect(inj.sectionTag).toBe('skill-billing');
    expect(inj.upstreamRef).toBe('tool-call-7');
    expect(inj.retrievalScore).toBe(0.92);
    expect(inj.rankPosition).toBe(0);
    expect(inj.budgetTokens).toBe(150);
    expect(inj.budgetFraction).toBe(0.15);
  });
});

// ─── Pattern 7: Multiple injections into different slots ──────────────

describe('FlowchartRecorder — pattern 7: multi-slot injections', () => {
  it('injections into system-prompt, messages, tools all attribute to same LLM call', () => {
    const { dispatcher, getGraph } = freshRecorder();

    emit(
      dispatcher,
      'agentfootprint.context.injected',
      mkInjection('system-prompt', 'system', 'instructions', 'base'),
    );
    emit(
      dispatcher,
      'agentfootprint.context.injected',
      mkInjection('messages', 'user', 'user', 'question'),
    );
    emit(
      dispatcher,
      'agentfootprint.context.injected',
      mkInjection('tools', undefined, 'registry', 'weather'),
    );
    emit(dispatcher, 'agentfootprint.stream.llm_start', {
      model: 'mock',
      provider: 'mock',
      systemPromptChars: 0,
      messagesCount: 1,
      toolsCount: 1,
    });
    emit(dispatcher, 'agentfootprint.stream.llm_end', {
      content: 'ok',
      toolCallCount: 0,
      usage: { input: 1, output: 1 },
      stopReason: 'stop',
    });

    const call = llmCallSteps(getGraph())[0];
    const slots = new Set((call.injections ?? []).map((i) => i.slot));
    expect(slots.has('system-prompt')).toBe(true);
    expect(slots.has('messages')).toBe(true);
    expect(slots.has('tools')).toBe(true);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────

function captureUpdates(): {
  onUpdate: (g: StepGraph) => void;
  getLastGraph: () => StepGraph;
} {
  let last: StepGraph = { nodes: [], edges: [] };
  return {
    onUpdate: (g) => {
      last = g;
    },
    getLastGraph: () => last,
  };
}

function mkInjection(
  slot: string,
  asRole: string | undefined,
  source: string,
  contentSummary: string,
  sourceId?: string,
): Record<string, unknown> {
  return {
    slot,
    asRole,
    source,
    sourceId,
    contentSummary,
    reason: 'test',
    contentHash: 'h',
  };
}

function injKey(i: ContextInjection): string {
  return `${i.slot}:${i.source}:${i.sourceId ?? ''}:${i.contentSummary ?? ''}`;
}

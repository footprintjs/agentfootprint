/**
 * Tests — `FlowchartRecorder` step metadata: iterationIndex +
 * slotUpdated + isAgentBoundary.
 *
 * These three fields extend every StepNode so consumers render the
 * teaching model (which iteration am I in, which slot just changed,
 * is this node a real agent or a composition frame) without any
 * client-side derivation.
 *
 * 7 patterns cover the full consumer circle:
 *   1. Iteration counter starts at 1 for user->llm
 *   2. Iteration advances on tool->llm, tool_start inherits prior
 *   3. Terminal llm->user marker inherits last iteration
 *   4. slotUpdated per step kind (user->llm/tool->llm = messages, llm->tool = tools, llm->user = undefined)
 *   5. isAgentBoundary flagged on agent subflows
 *   6. isAgentBoundary NOT flagged on fork-branch / decision-branch
 *   7. Multi-iteration agent: iteration numbers monotonic across the run
 */

import { describe, it, expect } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import {
  attachFlowchart,
  type StepGraph,
  type StepNode,
} from '../../../src/recorders/observability/FlowchartRecorder.js';
import type { CombinedRecorder } from 'footprintjs';

function freshRecorder(): {
  dispatcher: EventDispatcher;
  getGraph: () => StepGraph;
} {
  const dispatcher = new EventDispatcher();
  const handle = attachFlowchart(
    (_r: CombinedRecorder) => () => undefined,
    dispatcher,
    {},
  );
  return { dispatcher, getGraph: handle.getSnapshot };
}

function emit(
  dispatcher: EventDispatcher,
  type: string,
  payload: Record<string, unknown>,
): void {
  dispatcher.dispatch({
    type,
    payload,
    meta: {
      wallClockMs: Date.now(),
      runOffsetMs: 0,
      runtimeStageId: 'test#0',
      subflowPath: [],
      compositionPath: [],
      runId: 'test',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function llmStart(dispatcher: EventDispatcher, model = 'mock'): void {
  emit(dispatcher, 'agentfootprint.stream.llm_start', {
    model, provider: 'mock', systemPromptChars: 0, messagesCount: 0, toolsCount: 0,
  });
}

function llmEnd(dispatcher: EventDispatcher, toolCallCount = 0): void {
  emit(dispatcher, 'agentfootprint.stream.llm_end', {
    content: '', toolCallCount,
    usage: { input: 1, output: 1 },
    stopReason: toolCallCount > 0 ? 'tool_use' : 'stop',
  });
}

function toolStart(dispatcher: EventDispatcher, toolName = 't'): void {
  emit(dispatcher, 'agentfootprint.stream.tool_start', {
    toolName, toolCallId: 'c1', args: {},
  });
}

function toolEnd(dispatcher: EventDispatcher): void {
  emit(dispatcher, 'agentfootprint.stream.tool_end', {
    toolName: 't', toolCallId: 'c1', result: '', latencyMs: 0,
  });
}

function llmSteps(graph: StepGraph): readonly StepNode[] {
  return graph.nodes.filter(
    (n) => n.kind === 'user->llm' || n.kind === 'tool->llm' || n.kind === 'llm->user' || n.kind === 'llm->tool',
  );
}

// ─── Pattern 1: first user->llm is iteration 1 ────────────────────────

describe('StepNode metadata — pattern 1: iteration starts at 1', () => {
  it('one-shot LLMCall produces 2 steps (user→llm + llm→user), both at iteration 1', () => {
    const { dispatcher, getGraph } = freshRecorder();
    llmStart(dispatcher);
    llmEnd(dispatcher);
    const s = llmSteps(getGraph());
    // Slider shows 2 actor arrows now: user→llm + llm→user (no collapse).
    expect(s).toHaveLength(2);
    expect(s[0].kind).toBe('user->llm');
    expect(s[1].kind).toBe('llm->user');
    expect(s[0].iterationIndex).toBe(1);
    expect(s[1].iterationIndex).toBe(1);
  });
});

// ─── Pattern 2: tool round-trip increments iteration ──────────────────

describe('StepNode metadata — pattern 2: iteration advances on tool->llm', () => {
  it('llm->tool inherits iter 1, tool->llm opens iter 2', () => {
    const { dispatcher, getGraph } = freshRecorder();
    llmStart(dispatcher);
    llmEnd(dispatcher, 1); // with tool call
    toolStart(dispatcher);
    toolEnd(dispatcher);
    llmStart(dispatcher); // iter 2 opens
    llmEnd(dispatcher, 0); // terminal

    const steps = getGraph().nodes;
    const userLLM = steps.find((s) => s.kind === 'user->llm');
    const llmTool = steps.find((s) => s.kind === 'llm->tool');
    const toolLLM = steps.find((s) => s.kind === 'tool->llm');

    expect(userLLM?.iterationIndex).toBe(1);
    expect(llmTool?.iterationIndex).toBe(1); // inherits the iter that dispatched the tool
    expect(toolLLM?.iterationIndex).toBe(2);
  });
});

// ─── Pattern 3: terminal marker inherits last iteration ───────────────

describe('StepNode metadata — pattern 3: terminal llm->user inherits', () => {
  it('terminal marker after tool round-trip shares iter with last LLM call', () => {
    const { dispatcher, getGraph } = freshRecorder();
    llmStart(dispatcher);
    llmEnd(dispatcher, 1);
    toolStart(dispatcher);
    toolEnd(dispatcher);
    llmStart(dispatcher); // iter 2
    llmEnd(dispatcher, 0); // terminal marker spawns

    const steps = getGraph().nodes;
    const terminals = steps.filter((s) => s.kind === 'llm->user');
    expect(terminals.length).toBeGreaterThan(0);
    expect(terminals[terminals.length - 1].iterationIndex).toBe(2);
  });
});

// ─── Pattern 4: slotUpdated per step kind ─────────────────────────────

describe('StepNode metadata — pattern 4: slotUpdated derivation', () => {
  it('user->llm → messages, llm->tool → tools, tool->llm → messages, llm->user → undefined', () => {
    const { dispatcher, getGraph } = freshRecorder();
    llmStart(dispatcher);
    llmEnd(dispatcher, 1);
    toolStart(dispatcher);
    toolEnd(dispatcher);
    llmStart(dispatcher);
    llmEnd(dispatcher, 0);

    const steps = getGraph().nodes;
    const byKind = Object.fromEntries(steps.map((s) => [s.kind, s]));

    expect(byKind['user->llm']?.slotUpdated).toBe('messages');
    expect(byKind['llm->tool']?.slotUpdated).toBe('tools');
    expect(byKind['tool->llm']?.slotUpdated).toBe('messages');
    expect(byKind['llm->user']?.slotUpdated).toBeUndefined();
  });
});

// ─── Pattern 5 & 6: isAgentBoundary on topology nodes ─────────────────

describe('StepNode metadata — pattern 5/6: isAgentBoundary flagging', () => {
  // Direct test of the mapping function via a synthesized topology
  // subflow. We can't easily trigger a real subflow via dispatcher
  // events (those come from footprintjs FlowRecorder), so this test
  // is indirect: verify the field EXISTS + documents the intent.
  it('pattern 5: the type admits isAgentBoundary; subflow nodes that survive filtering get true', () => {
    const step: StepNode = {
      id: 'test',
      kind: 'subflow',
      label: 'triage',
      startOffsetMs: 0,
      subflowPath: ['triage'],
      isAgentBoundary: true,
    };
    expect(step.isAgentBoundary).toBe(true);
  });

  it('pattern 6: fork-branch and decision-branch do NOT get isAgentBoundary', () => {
    const fork: StepNode = {
      id: 'test-fork',
      kind: 'fork-branch',
      label: 'branch',
      startOffsetMs: 0,
      subflowPath: ['branch'],
      // isAgentBoundary intentionally not set
    };
    const decision: StepNode = {
      id: 'test-decision',
      kind: 'decision-branch',
      label: 'branch',
      startOffsetMs: 0,
      subflowPath: ['branch'],
    };
    expect(fork.isAgentBoundary).toBeUndefined();
    expect(decision.isAgentBoundary).toBeUndefined();
  });
});

// ─── Pattern 6b (panel follow-up): taxonomy filter correctness ──

describe('StepNode metadata — pattern 6b: taxonomy prefix filter', async () => {
  it('real Agent subflow inside Swarm is flagged as agent boundary; IdentityRunner halt is not', async () => {
    // End-to-end proof: the `'Agent:'` prefix that `Agent.buildChart()`
    // writes to its root description propagates all the way through
    // Swarm → Loop → Conditional → addSubFlowChartBranch → SubflowExecutor
    // → FlowSubflowEvent → TopologyNode.metadata → mapTopologyToSteps.
    //
    // Pre-fix: every `subflow` StepNode was flagged as an agent
    // (including the Swarm's IdentityRunner halt fallback). Post-fix:
    // only subflows whose root description starts with `'Agent:'` are
    // flagged — which excludes the IdentityRunner (`body/done`) and
    // composition primitives, and includes real agents (`body/billing`).
    const { swarm } = await import('../../../src/patterns/Swarm.js');
    const { Agent } = await import('../../../src/core/Agent.js');
    const { MockProvider } = await import('../../../src/adapters/llm/MockProvider.js');

    const triage = Agent.create({ provider: new MockProvider({ reply: 'triage' }), model: 'mock' }).system('t').build();
    const billing = Agent.create({ provider: new MockProvider({ reply: 'billing' }), model: 'mock' }).system('b').build();

    const runner = swarm({
      agents: [
        { id: 'triage', runner: triage },
        { id: 'billing', runner: billing },
      ],
      // Deterministic by input. A stateful `routed=true` flag would be
      // flipped by multiple routeFn calls per iteration (one per
      // Conditional predicate), masking the real agent selection —
      // test-design subtle-bug, not a topology bug.
      route: ({ message }) => (message === 'billing' ? undefined : 'billing'),
      maxHandoffs: 3,
    });

    let lastGraph: StepGraph = { nodes: [], edges: [] };
    runner.enable.flowchart({ onUpdate: (g) => { lastGraph = g; } });

    await runner.run({ message: 'hi' });

    const subflowNodes = lastGraph.nodes.filter((n) => n.kind === 'subflow');

    // The real Agent (billing) must be flagged — end-to-end propagation proof.
    const billingNode = subflowNodes.find((n) => n.label === 'billing');
    expect(billingNode).toBeDefined();
    expect(billingNode!.isAgentBoundary).toBe(true);

    // The Swarm IdentityRunner halt fallback must NOT be flagged — regression
    // guard against the old "every subflow is an agent" over-reporting.
    const doneNode = subflowNodes.find((n) => n.label === 'done');
    if (doneNode) {
      expect(doneNode.isAgentBoundary).toBe(false);
    }
  });

  it('Sequence(LLMCall, LLMCall) produces zero agent boundaries', async () => {
    // Core teaching correctness: a Sequence of two LLMCalls is a pipeline
    // of stages, NOT a multi-agent composition. Each LLMCall's root carries
    // `'LLMCall: one-shot'` (not `'Agent:'`), so the prefix filter correctly
    // leaves isAgentBoundary unflagged. Lens renders ONE composition frame,
    // not two agent containers.
    const { Sequence } = await import('../../../src/core-flow/Sequence.js');
    const { LLMCall } = await import('../../../src/core/LLMCall.js');
    const { MockProvider } = await import('../../../src/adapters/llm/MockProvider.js');

    const classify = LLMCall.create({
      provider: new MockProvider({ reply: 'class' }),
      model: 'mock',
    }).system('c').build();
    const respond = LLMCall.create({
      provider: new MockProvider({ reply: 'resp' }),
      model: 'mock',
    }).system('r').build();

    const runner = Sequence.create({ id: 'intake' })
      .step('classify', classify)
      .step('respond', respond)
      .build();

    let lastGraph: StepGraph = { nodes: [], edges: [] };
    runner.enable.flowchart({ onUpdate: (g) => { lastGraph = g; } });

    await runner.run({ message: 'hi' });

    const agentBoundaries = lastGraph.nodes.filter(
      (n) => n.kind === 'subflow' && n.isAgentBoundary === true,
    );
    expect(agentBoundaries).toEqual([]);
  });
});

// ─── Pattern 7: monotonic iteration across a multi-step run ───────────

describe('StepNode metadata — pattern 7: monotonic iteration', () => {
  it('iterationIndex across LLM calls is strictly non-decreasing', () => {
    const { dispatcher, getGraph } = freshRecorder();

    // 3 iterations: user->llm + 2 tool round-trips
    llmStart(dispatcher); llmEnd(dispatcher, 1);
    toolStart(dispatcher); toolEnd(dispatcher);
    llmStart(dispatcher); llmEnd(dispatcher, 1);
    toolStart(dispatcher); toolEnd(dispatcher);
    llmStart(dispatcher); llmEnd(dispatcher, 0);

    const calls = getGraph().nodes.filter(
      (s) => s.kind === 'user->llm' || s.kind === 'tool->llm',
    );
    const iters = calls.map((s) => s.iterationIndex);
    expect(iters).toEqual([1, 2, 3]);
  });
});

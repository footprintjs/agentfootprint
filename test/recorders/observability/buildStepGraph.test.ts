/**
 * Tests — `buildStepGraph(boundary)`: pure projection from BoundaryRecorder
 * events to StepGraph.
 *
 * The projection is the entire policy that decides "what's a renderable
 * step." Replacing the deleted `ingestV2` + `mapTopologyToSteps` with one
 * deterministic fold over `boundary.getEvents()`.
 *
 * 7 patterns cover the full surface:
 *   P1  One-shot LLMCall              → 2 ReAct steps (user→llm + llm→user)
 *   P2  Tool-using cycle (1 iter)     → 4 ReAct steps + tokens + iter index
 *   P3  Multi-iteration agent          → arrows alternate user→llm/tool→llm
 *   P4  Subflow boundary surfaces      → primitive subflow becomes StepNode
 *   P5  Slot subflows skipped          → context-engineering details NOT timeline steps
 *   P6  Agent-internal subflows skipped → routing/wrapper subflows NOT in StepGraph
 *   P7  Context.injected attaches      → injection list attached to next user→llm step
 */

import { describe, expect, it } from 'vitest';
import { BoundaryRecorder } from '../../../src/recorders/observability/BoundaryRecorder.js';
import { buildStepGraph } from '../../../src/recorders/observability/FlowchartRecorder.js';
import type { FlowSubflowEvent } from 'footprintjs';
import type { FlowRunEvent } from 'footprintjs/dist/types/lib/engine/narrative/types.js';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import { SUBFLOW_IDS } from '../../../src/conventions.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function fresh(): { rec: BoundaryRecorder; dispatcher: EventDispatcher } {
  const rec = new BoundaryRecorder();
  const dispatcher = new EventDispatcher();
  rec.subscribe(dispatcher);
  return { rec, dispatcher };
}

function runE(payload?: unknown): FlowRunEvent {
  return { payload };
}

function subE(
  subflowId: string,
  name: string,
  runtimeStageId: string,
  description?: string,
  mappedInput?: Record<string, unknown>,
  outputState?: Record<string, unknown>,
): FlowSubflowEvent {
  return {
    name, subflowId, description, mappedInput, outputState,
    traversalContext: {
      stageId: subflowId,
      runtimeStageId,
      stageName: name,
      depth: subflowId.split('/').length - 1,
    },
  };
}

function dispatch(d: EventDispatcher, type: string, payload: Record<string, unknown>): void {
  d.dispatch({
    type, payload,
    meta: {
      wallClockMs: 1000, runOffsetMs: 0,
      runtimeStageId: 'call-llm#0',
      subflowPath: [], compositionPath: [], runId: 'test',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function llmStart(d: EventDispatcher): void {
  dispatch(d, 'agentfootprint.stream.llm_start', { model: 'mock', provider: 'mock' });
}
function llmEnd(d: EventDispatcher, toolCalls = 0): void {
  dispatch(d, 'agentfootprint.stream.llm_end', {
    content: toolCalls === 0 ? 'final' : '',
    toolCallCount: toolCalls,
    usage: { input: 5, output: 3 },
  });
}
function toolStart(d: EventDispatcher, toolName: string, id: string): void {
  dispatch(d, 'agentfootprint.stream.tool_start', { toolName, toolCallId: id });
}
function toolEnd(d: EventDispatcher, id: string): void {
  dispatch(d, 'agentfootprint.stream.tool_end', { toolCallId: id, result: 'x', durationMs: 1 });
}

// ─── P1: one-shot LLMCall ──────────────────────────────────────────────

describe('buildStepGraph — P1: one-shot LLMCall (no tools)', () => {
  it('produces 2 ReAct steps (user→llm + llm→user) with tokens on the start', () => {
    const { rec, dispatcher } = fresh();
    rec.onRunStart!(runE({}));
    llmStart(dispatcher);
    llmEnd(dispatcher, 0);
    rec.onRunEnd!(runE({}));

    const g = buildStepGraph(rec);
    const reactNodes = g.nodes.filter((n) =>
      n.kind === 'user->llm' || n.kind === 'llm->tool' || n.kind === 'tool->llm' || n.kind === 'llm->user',
    );
    expect(reactNodes.map((n) => n.kind)).toEqual(['user->llm', 'llm->user']);
    expect(reactNodes[0].tokens).toEqual({ in: 5, out: 3 });
    expect(reactNodes[0].iterationIndex).toBe(1);
    expect(reactNodes[1].iterationIndex).toBe(1);
  });
});

// ─── P2: tool-using cycle (1 iteration) ────────────────────────────────

describe('buildStepGraph — P2: tool-using cycle', () => {
  it('produces 4 ReAct steps with iterationIndex tracking', () => {
    const { rec, dispatcher } = fresh();
    llmStart(dispatcher);
    llmEnd(dispatcher, 1);
    toolStart(dispatcher, 'weather', 'c1');
    toolEnd(dispatcher, 'c1');
    llmStart(dispatcher);
    llmEnd(dispatcher, 0);

    const g = buildStepGraph(rec);
    const kinds = g.nodes
      .filter((n) =>
        n.kind === 'user->llm' || n.kind === 'llm->tool' || n.kind === 'tool->llm' || n.kind === 'llm->user',
      )
      .map((n) => n.kind);
    expect(kinds).toEqual(['user->llm', 'llm->tool', 'tool->llm', 'llm->user']);

    const iters = g.nodes
      .filter((n) => n.iterationIndex !== undefined)
      .map((n) => n.iterationIndex);
    // user→llm = iter 1, llm→tool inherits iter 1, tool→llm = iter 2, llm→user inherits iter 2
    expect(iters).toEqual([1, 1, 2, 2]);
  });
});

// ─── P3: multi-iteration alternation ───────────────────────────────────

describe('buildStepGraph — P3: multi-iteration alternation', () => {
  it('actor arrows alternate correctly across 3 iterations', () => {
    const { rec, dispatcher } = fresh();
    // iter 1: tool
    llmStart(dispatcher); llmEnd(dispatcher, 1);
    toolStart(dispatcher, 't', 'a'); toolEnd(dispatcher, 'a');
    // iter 2: tool
    llmStart(dispatcher); llmEnd(dispatcher, 1);
    toolStart(dispatcher, 't', 'b'); toolEnd(dispatcher, 'b');
    // iter 3: terminal
    llmStart(dispatcher); llmEnd(dispatcher, 0);

    const g = buildStepGraph(rec);
    const kinds = g.nodes
      .filter((n) =>
        n.kind === 'user->llm' || n.kind === 'llm->tool' || n.kind === 'tool->llm' || n.kind === 'llm->user',
      )
      .map((n) => n.kind);
    expect(kinds).toEqual([
      'user->llm', 'llm->tool',  // iter 1
      'tool->llm', 'llm->tool',  // iter 2
      'tool->llm', 'llm->user',  // iter 3
    ]);
  });
});

// ─── P4: primitive subflow surfaces ───────────────────────────────────

describe('buildStepGraph — P4: primitive subflow surfaces with tags', () => {
  it("subflow with 'Sequence:' description becomes a 'subflow' StepNode with primitiveKind", () => {
    const { rec } = fresh();
    rec.onSubflowEntry!(subE('sf-seq', 'Pipeline', 's#0', 'Sequence: 3-step pipeline', { in: 1 }));
    rec.onSubflowExit!(subE('sf-seq', 'Pipeline', 's#0', undefined, undefined, { out: 2 }));

    const g = buildStepGraph(rec);
    const sub = g.nodes.find((n) => n.kind === 'subflow' && n.runtimeStageId === 's#0');
    expect(sub).toBeDefined();
    expect(sub!.primitiveKind).toBe('Sequence');
    expect(sub!.isPrimitiveBoundary).toBe(true);
    expect(sub!.entryPayload).toEqual({ in: 1 });
    expect(sub!.exitPayload).toEqual({ out: 2 });
  });
});

// ─── P5: slot subflows skipped ─────────────────────────────────────────

describe('buildStepGraph — P5: slot subflows are NOT timeline steps', () => {
  it('slot subflow events are filtered from StepGraph (rendered inside LLM card via boundary.getSlotBoundaries)', () => {
    const { rec } = fresh();
    rec.onSubflowEntry!(subE(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    rec.onSubflowExit!(subE(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    rec.onSubflowEntry!(subE(SUBFLOW_IDS.MESSAGES, 'M', 'm#0'));
    rec.onSubflowExit!(subE(SUBFLOW_IDS.MESSAGES, 'M', 'm#0'));
    rec.onSubflowEntry!(subE(SUBFLOW_IDS.TOOLS, 'T', 't#0'));
    rec.onSubflowExit!(subE(SUBFLOW_IDS.TOOLS, 'T', 't#0'));

    const g = buildStepGraph(rec);
    // Zero subflow StepNodes — slot data still in BoundaryRecorder.
    expect(g.nodes.filter((n) => n.kind === 'subflow')).toHaveLength(0);
    // But the boundary still has them.
    expect(rec.getEventsByType('subflow.entry').filter((e) => e.slotKind)).toHaveLength(3);
  });
});

// ─── P6: agent-internal subflows skipped ───────────────────────────────

describe('buildStepGraph — P6: agent-internal routing subflows are skipped', () => {
  it('sf-route, sf-tool-calls, sf-final, sf-merge do not produce StepNodes', () => {
    const { rec } = fresh();
    for (const id of [SUBFLOW_IDS.ROUTE, SUBFLOW_IDS.TOOL_CALLS, SUBFLOW_IDS.FINAL, SUBFLOW_IDS.MERGE]) {
      rec.onSubflowEntry!(subE(id, id, `${id}#0`));
      rec.onSubflowExit!(subE(id, id, `${id}#0`));
    }
    const g = buildStepGraph(rec);
    expect(g.nodes.filter((n) => n.kind === 'subflow')).toHaveLength(0);
  });
});

// ─── P7: context.injected attaches to next LLM step ────────────────────

describe('buildStepGraph — P7: context.injected attaches to NEXT user→llm step', () => {
  it('injections fired before llm.start attach to that LLM call', () => {
    const { rec, dispatcher } = fresh();
    dispatch(dispatcher, 'agentfootprint.context.injected', {
      slot: 'messages', source: 'user', contentSummary: 'analyze report',
    });
    dispatch(dispatcher, 'agentfootprint.context.injected', {
      slot: 'system-prompt', source: 'base', contentSummary: 'you are an analyst',
    });
    llmStart(dispatcher);
    llmEnd(dispatcher, 0);

    const g = buildStepGraph(rec);
    const userToLlm = g.nodes.find((n) => n.kind === 'user->llm')!;
    expect(userToLlm.injections).toHaveLength(2);
    expect(userToLlm.injections![0]).toMatchObject({
      slot: 'messages', source: 'user', contentSummary: 'analyze report',
    });
    expect(userToLlm.injections![1]).toMatchObject({
      slot: 'system-prompt', source: 'base',
    });
  });
});

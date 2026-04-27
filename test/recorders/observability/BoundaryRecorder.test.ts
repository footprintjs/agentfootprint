/**
 * Tests — `BoundaryRecorder`: unified domain event log.
 *
 * The recorder is the single source of truth for "every observable
 * moment in a run, tagged with its domain meaning". It captures:
 *   - FlowRecorder events from footprintjs (run / subflow / fork /
 *     decision / loop)
 *   - Typed events from the agentfootprint dispatcher (llm.* / tool.* /
 *     context.injected)
 * and emits a single ordered `DomainEvent` stream.
 *
 * 7 patterns cover the consumer circle:
 *   P1  Run lifecycle               → run.entry + run.exit, isRoot=true
 *   P2  Subflow with all 3 tags     → primitiveKind, slotKind, isAgentInternal
 *   P3  Fork (3 children)           → 3 fork.branch events
 *   P4  Decision branch + Loop      → decision.branch + loop.iteration
 *   P5  LLM lifecycle               → llm.start + llm.end with payloads
 *   P6  Tool lifecycle              → tool.start + tool.end
 *   P7  Context injected            → context.injected with all 5 axes
 *
 * Plus query API + lifecycle.
 */

import { describe, expect, it } from 'vitest';
import { ROOT_RUNTIME_STAGE_ID, ROOT_SUBFLOW_ID } from 'footprintjs/trace';
import type {
  FlowDecisionEvent,
  FlowForkEvent,
  FlowLoopEvent,
  FlowSubflowEvent,
} from 'footprintjs';
import type { FlowRunEvent } from 'footprintjs/dist/types/lib/engine/narrative/types.js';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import {
  BoundaryRecorder,
  boundaryRecorder,
  type DomainEvent,
} from '../../../src/recorders/observability/BoundaryRecorder.js';
import { SUBFLOW_IDS } from '../../../src/conventions.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function freshRecorder(): { rec: BoundaryRecorder; dispatcher: EventDispatcher } {
  const rec = new BoundaryRecorder();
  const dispatcher = new EventDispatcher();
  rec.subscribe(dispatcher);
  return { rec, dispatcher };
}

function runEvt(payload?: unknown): FlowRunEvent {
  return { payload };
}

function subEvt(
  subflowId: string,
  name: string,
  runtimeStageId: string,
  description?: string,
  mappedInput?: Record<string, unknown>,
  outputState?: Record<string, unknown>,
): FlowSubflowEvent {
  return {
    name,
    subflowId,
    description,
    mappedInput,
    outputState,
    traversalContext: {
      stageId: subflowId,
      runtimeStageId,
      stageName: name,
      depth: subflowId.split('/').length - 1,
    },
  };
}

function forkEvt(parent: string, children: string[], runtimeStageId: string): FlowForkEvent {
  return {
    parent,
    children,
    traversalContext: { stageId: parent, runtimeStageId, stageName: parent, depth: 0 },
  };
}

function decisionEvt(
  decider: string,
  chosen: string,
  runtimeStageId: string,
  rationale?: string,
): FlowDecisionEvent {
  return {
    decider,
    chosen,
    rationale,
    traversalContext: { stageId: decider, runtimeStageId, stageName: decider, depth: 0 },
  };
}

function loopEvt(target: string, iteration: number, runtimeStageId: string): FlowLoopEvent {
  return {
    target,
    iteration,
    traversalContext: { stageId: target, runtimeStageId, stageName: target, depth: 0 },
  };
}

function dispatchTyped(
  dispatcher: EventDispatcher,
  type: string,
  payload: Record<string, unknown>,
  runtimeStageId = 'stage#0',
): void {
  dispatcher.dispatch({
    type,
    payload,
    meta: {
      wallClockMs: 1000,
      runOffsetMs: 0,
      runtimeStageId,
      subflowPath: [],
      compositionPath: [],
      runId: 'test',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

// ─── P1: run lifecycle ───────────────────────────────────────────────────

describe('BoundaryRecorder — P1: run.entry + run.exit', () => {
  it('emits run.entry on onRunStart and run.exit on onRunEnd, both with isRoot=true', () => {
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt({ request: 'analyze' }));
    rec.onRunEnd!(runEvt({ result: 'done' }));

    const events = rec.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'run.entry',
      runtimeStageId: ROOT_RUNTIME_STAGE_ID,
      subflowPath: [ROOT_SUBFLOW_ID],
      depth: 0,
      isRoot: true,
      payload: { request: 'analyze' },
    });
    expect(events[1]).toMatchObject({ type: 'run.exit', isRoot: true, payload: { result: 'done' } });
  });
});

// ─── P2: subflow with full tagging ───────────────────────────────────────

describe('BoundaryRecorder — P2: subflow.entry/exit with primitiveKind + slotKind + isAgentInternal', () => {
  it('Agent-prefixed description → primitiveKind="Agent", isAgentInternal=false', () => {
    const { rec } = freshRecorder();
    rec.onSubflowEntry!(
      subEvt('sf-agent', 'Agent', 'a#0', 'Agent: ReAct loop', { in: 1 }),
    );
    rec.onSubflowExit!(subEvt('sf-agent', 'Agent', 'a#0', undefined, undefined, { out: 2 }));

    const sub = rec.getEventsByType('subflow.entry')[0];
    expect(sub).toMatchObject({
      type: 'subflow.entry',
      subflowId: 'sf-agent',
      localSubflowId: 'sf-agent',
      subflowName: 'Agent',
      subflowPath: [ROOT_SUBFLOW_ID, 'sf-agent'],
      depth: 1,
      primitiveKind: 'Agent',
      isAgentInternal: false,
      payload: { in: 1 },
    });
    expect(sub.slotKind).toBeUndefined();

    const exit = rec.getEventsByType('subflow.exit')[0];
    expect(exit.payload).toEqual({ out: 2 });
  });

  it('slot subflow id (sf-system-prompt) → slotKind set, isAgentInternal=false', () => {
    const { rec } = freshRecorder();
    rec.onSubflowEntry!(subEvt(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    expect(rec.getEventsByType('subflow.entry')[0]).toMatchObject({
      slotKind: 'system-prompt',
      isAgentInternal: false,
    });
  });

  it('routing subflow id (sf-route) → isAgentInternal=true', () => {
    const { rec } = freshRecorder();
    rec.onSubflowEntry!(subEvt(SUBFLOW_IDS.ROUTE, 'route', 'r#0'));
    expect(rec.getEventsByType('subflow.entry')[0]).toMatchObject({
      isAgentInternal: true,
    });
  });

  it('nested subflow id (parent/child) → path includes parent + slotKind detected at any nesting', () => {
    const { rec } = freshRecorder();
    rec.onSubflowEntry!(subEvt(`outer/${SUBFLOW_IDS.MESSAGES}`, 'M', 'm#0'));
    const e = rec.getEventsByType('subflow.entry')[0];
    expect(e.subflowPath).toEqual([ROOT_SUBFLOW_ID, 'outer', SUBFLOW_IDS.MESSAGES]);
    expect(e.localSubflowId).toBe(SUBFLOW_IDS.MESSAGES);
    expect(e.slotKind).toBe('messages');
  });
});

// ─── P3: fork synthesizes one event per child ───────────────────────────

describe('BoundaryRecorder — P3: fork.branch (one event per parallel child)', () => {
  it('onFork(N children) emits N fork.branch events', () => {
    const { rec } = freshRecorder();
    rec.onFork!(forkEvt('parent', ['Alpha', 'Beta', 'Gamma'], 'p#1'));

    const forks = rec.getEventsByType('fork.branch');
    expect(forks).toHaveLength(3);
    expect(forks.map((e) => e.childName)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(forks.every((e) => e.parentSubflowId === 'parent')).toBe(true);
    expect(forks.every((e) => e.runtimeStageId === 'p#1')).toBe(true);
  });
});

// ─── P4: decision + loop ────────────────────────────────────────────────

describe('BoundaryRecorder — P4: decision.branch + loop.iteration', () => {
  it('decision and loop events captured with their distinguishing fields', () => {
    const { rec } = freshRecorder();
    rec.onDecision!(decisionEvt('RouteRisk', 'high', 'r#1', 'credit < 600'));
    rec.onLoop!(loopEvt('agent-body', 2, 'l#3'));

    const dec = rec.getEventsByType('decision.branch')[0];
    expect(dec).toMatchObject({
      type: 'decision.branch',
      decider: 'RouteRisk',
      chosen: 'high',
      rationale: 'credit < 600',
      runtimeStageId: 'r#1',
    });

    const loop = rec.getEventsByType('loop.iteration')[0];
    expect(loop).toMatchObject({
      type: 'loop.iteration',
      target: 'agent-body',
      iteration: 2,
      runtimeStageId: 'l#3',
    });
  });
});

// ─── P5: LLM lifecycle ─────────────────────────────────────────────────

describe('BoundaryRecorder — P5: llm.start + llm.end via dispatcher', () => {
  it('typed llm_start/llm_end events surface as llm.start/llm.end DomainEvents with payloads', () => {
    const { rec, dispatcher } = freshRecorder();
    dispatchTyped(dispatcher, 'agentfootprint.stream.llm_start', {
      model: 'gpt-mock', provider: 'mock',
      systemPromptChars: 100, messagesCount: 5, toolsCount: 2,
    });
    dispatchTyped(dispatcher, 'agentfootprint.stream.llm_end', {
      content: 'Hello!', toolCallCount: 0,
      usage: { input: 30, output: 8 }, stopReason: 'stop',
    });

    const start = rec.getEventsByType('llm.start')[0];
    expect(start).toMatchObject({
      type: 'llm.start',
      model: 'gpt-mock',
      provider: 'mock',
      systemPromptChars: 100,
      messagesCount: 5,
      toolsCount: 2,
    });

    const end = rec.getEventsByType('llm.end')[0];
    expect(end).toMatchObject({
      type: 'llm.end',
      content: 'Hello!',
      toolCallCount: 0,
      usage: { input: 30, output: 8 },
      stopReason: 'stop',
    });
  });
});

// ─── P6: Tool lifecycle ────────────────────────────────────────────────

describe('BoundaryRecorder — P6: tool.start + tool.end via dispatcher', () => {
  it('typed tool_start/tool_end events surface with toolName + args + result', () => {
    const { rec, dispatcher } = freshRecorder();
    dispatchTyped(dispatcher, 'agentfootprint.stream.tool_start', {
      toolName: 'weather', toolCallId: 'c1', args: { city: 'SF' },
    });
    dispatchTyped(dispatcher, 'agentfootprint.stream.tool_end', {
      toolCallId: 'c1', result: '72°F sunny', durationMs: 42,
    });

    const start = rec.getEventsByType('tool.start')[0];
    expect(start).toMatchObject({
      type: 'tool.start',
      toolName: 'weather',
      toolCallId: 'c1',
      args: { city: 'SF' },
    });

    const end = rec.getEventsByType('tool.end')[0];
    expect(end).toMatchObject({
      type: 'tool.end',
      toolCallId: 'c1',
      result: '72°F sunny',
      durationMs: 42,
    });
  });
});

// ─── P7: context.injected (5 axes of context engineering) ──────────────

describe('BoundaryRecorder — P7: context.injected with the 5 axes', () => {
  it('typed context.injected event surfaces with slot, source, role, content, reason', () => {
    const { rec, dispatcher } = freshRecorder();
    dispatchTyped(dispatcher, 'agentfootprint.context.injected', {
      slot: 'messages',
      source: 'rag',
      sourceId: 'doc-42',
      asRole: 'user',
      contentSummary: 'Q3 financials excerpt',
      reason: 'RAG match for "revenue"',
      sectionTag: 'finance',
      upstreamRef: 'retriever#0',
    });

    const inj = rec.getEventsByType('context.injected')[0];
    expect(inj).toMatchObject({
      type: 'context.injected',
      slot: 'messages',
      source: 'rag',
      sourceId: 'doc-42',
      asRole: 'user',
      contentSummary: 'Q3 financials excerpt',
      reason: 'RAG match for "revenue"',
      sectionTag: 'finance',
      upstreamRef: 'retriever#0',
    });
  });
});

// ─── Query API ─────────────────────────────────────────────────────────

describe('BoundaryRecorder — query API', () => {
  it('getEvents() returns the canonical ordered stream (FlowRecorder + dispatcher interleaved)', () => {
    const { rec, dispatcher } = freshRecorder();
    rec.onRunStart!(runEvt({}));
    dispatchTyped(dispatcher, 'agentfootprint.stream.llm_start', {
      model: 'm', provider: 'p',
    });
    rec.onSubflowEntry!(subEvt(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    dispatchTyped(dispatcher, 'agentfootprint.context.injected', {
      slot: 'system-prompt', source: 'base',
    });
    rec.onSubflowExit!(subEvt(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    dispatchTyped(dispatcher, 'agentfootprint.stream.llm_end', {
      content: '', toolCallCount: 0, usage: { input: 1, output: 1 },
    });
    rec.onRunEnd!(runEvt({}));

    const types = rec.getEvents().map((e) => e.type);
    expect(types).toEqual([
      'run.entry',
      'llm.start',
      'subflow.entry',
      'context.injected',
      'subflow.exit',
      'llm.end',
      'run.exit',
    ]);
  });

  it('getBoundary returns entry/exit pair by runtimeStageId', () => {
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt({ in: 1 }));
    rec.onRunEnd!(runEvt({ out: 2 }));

    const root = rec.getRootBoundary();
    expect(root.entry?.payload).toEqual({ in: 1 });
    expect(root.exit?.payload).toEqual({ out: 2 });
  });

  it('getVisibleSteps excludes agent-internal routing subflows', () => {
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt({}));
    rec.onSubflowEntry!(subEvt(SUBFLOW_IDS.ROUTE, 'route', 'r#0'));
    rec.onSubflowEntry!(subEvt(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    rec.onSubflowEntry!(subEvt('sf-agent', 'A', 'a#0', 'Agent: ReAct'));

    const visible = rec.getVisibleSteps();
    // run.entry + sp + agent — route filtered out
    const ids = visible.map((s) => (s.type === 'subflow.entry' ? s.subflowId : s.runtimeStageId));
    expect(ids).toEqual([ROOT_RUNTIME_STAGE_ID, SUBFLOW_IDS.SYSTEM_PROMPT, 'sf-agent']);
  });

  it('getSlotBoundaries groups subflow events by slotKind', () => {
    const { rec } = freshRecorder();
    rec.onSubflowEntry!(subEvt(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    rec.onSubflowExit!(subEvt(SUBFLOW_IDS.SYSTEM_PROMPT, 'SP', 'sp#0'));
    rec.onSubflowEntry!(subEvt(SUBFLOW_IDS.MESSAGES, 'M', 'm#0'));
    rec.onSubflowExit!(subEvt(SUBFLOW_IDS.MESSAGES, 'M', 'm#0'));

    const slots = rec.getSlotBoundaries();
    expect(slots.systemPrompt).toHaveLength(2); // entry + exit
    expect(slots.messages).toHaveLength(2);
    expect(slots.tools).toHaveLength(0);
  });

  it('factory + ID handling', () => {
    const a = boundaryRecorder();
    const b = boundaryRecorder();
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^boundary-\d+$/);
    expect(boundaryRecorder({ id: 'mine' }).id).toBe('mine');
  });
});

// ─── Lifecycle ─────────────────────────────────────────────────────────

describe('BoundaryRecorder — lifecycle', () => {
  it('clear() resets all stored events', () => {
    const { rec, dispatcher } = freshRecorder();
    rec.onRunStart!(runEvt({}));
    dispatchTyped(dispatcher, 'agentfootprint.stream.llm_start', { model: 'm', provider: 'p' });
    expect(rec.getEvents().length).toBeGreaterThan(0);

    rec.clear();
    expect(rec.getEvents()).toEqual([]);
  });

  it('subscribe returns an unsubscribe that stops further ingestion', () => {
    const rec = new BoundaryRecorder();
    const dispatcher = new EventDispatcher();
    const unsub = rec.subscribe(dispatcher);

    dispatchTyped(dispatcher, 'agentfootprint.stream.llm_start', { model: 'm', provider: 'p' });
    expect(rec.getEvents()).toHaveLength(1);

    unsub();
    dispatchTyped(dispatcher, 'agentfootprint.stream.llm_end', {
      content: '', toolCallCount: 0, usage: { input: 1, output: 1 },
    });
    expect(rec.getEvents()).toHaveLength(1);
  });

  it('toSnapshot returns standard bundle shape', () => {
    const rec = new BoundaryRecorder();
    rec.onRunStart!(runEvt({}));
    const snap = rec.toSnapshot();
    expect(snap.name).toBe('BoundaryEvents');
    expect(snap.preferredOperation).toBe('translate');
    expect(Array.isArray(snap.data)).toBe(true);
    expect((snap.data as DomainEvent[])[0].type).toBe('run.entry');
  });

  it('ignores subflow events without a subflowId (defensive)', () => {
    const rec = new BoundaryRecorder();
    rec.onSubflowEntry!({ name: 'Anon' });
    rec.onSubflowExit!({ name: 'Anon' });
    expect(rec.getEvents()).toEqual([]);
  });
});

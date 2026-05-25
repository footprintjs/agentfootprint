/**
 * Tests — `buildRunSteps`: project a BoundaryRecorder's event stream
 * into the slider-ready RunStep[] consumed by Lens / CLI / future UIs.
 *
 * Pure-projection contract: same input events → same RunStep[] output.
 * No live recorder lifecycle here; we drive the BoundaryRecorder
 * synchronously via its FlowRecorder hooks + typed-event subscription
 * (same harness as BoundaryRecorder.test.ts).
 *
 * Coverage matrix — one test per primitive kind + drill scoping:
 *   P1  Sequence(LLMCall, LLMCall)        → asks + forwards + answers
 *   P2  Parallel(LLMCall × 3)             → 1 fork step with 3 transitions
 *   P3  Conditional (chosen branch)       → decide step + answers
 *   P4  Loop (3 iterations)               → 3 iteration steps
 *   P5  Single LLMCall (one-shot)         → user→llm + llm→user (react)
 *   P6  Drill scope filter                → steps below path ignored
 */

import { describe, expect, it } from 'vitest';
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
} from '../../../src/recorders/observability/BoundaryRecorder.js';
import { buildRunSteps } from '../../../src/recorders/observability/RunStepRecorder.js';

// ── Test harness mirroring BoundaryRecorder.test.ts ─────────────────

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
): FlowSubflowEvent {
  return {
    name,
    subflowId,
    description,
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
  subflowPath: readonly string[] = [],
): void {
  dispatcher.dispatch({
    type,
    payload,
    meta: {
      wallClockMs: 1000,
      runOffsetMs: 0,
      runtimeStageId,
      subflowPath,
      compositionPath: [],
      runId: 'test',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

// ─── P1: Sequence ────────────────────────────────────────────────────

describe('buildRunSteps — P1: Sequence(LLMCall, LLMCall)', () => {
  it('emits asks → forwards → answers (3 sequential steps)', () => {
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt({ message: 'hi' }));
    rec.onSubflowEntry!(subEvt('sf-seq', 'Pipeline', 'seq#0', 'Sequence: pipeline'));
    rec.onSubflowEntry!(
      subEvt('sf-seq/sf-classify', 'classify', 'cls#0', 'LLMCall: classify'),
    );
    rec.onSubflowExit!(
      subEvt('sf-seq/sf-classify', 'classify', 'cls#0'),
    );
    rec.onSubflowEntry!(
      subEvt('sf-seq/sf-respond', 'respond', 'rsp#0', 'LLMCall: respond'),
    );
    rec.onSubflowExit!(
      subEvt('sf-seq/sf-respond', 'respond', 'rsp#0'),
    );
    rec.onSubflowExit!(subEvt('sf-seq', 'Pipeline', 'seq#0'));
    rec.onRunEnd!(runEvt({ result: 'ok' }));

    const steps = buildRunSteps(rec);
    const sequentials = steps.filter((s) => s.kind === 'sequential');
    expect(sequentials).toHaveLength(3);
    expect(sequentials[0].label).toBe('asks');
    expect(sequentials[0].transitions[0].from).toBe('actor:user');
    expect(sequentials[0].transitions[0].to).toContain('classify');
    expect(sequentials[1].label).toBe('forwards');
    expect(sequentials[1].transitions[0].from).toContain('classify');
    expect(sequentials[1].transitions[0].to).toContain('respond');
    expect(sequentials[2].label).toBe('answers');
    expect(sequentials[2].transitions[0].to).toBe('actor:user');
  });
});

// ─── P1b: Sequence as OUTERMOST runner (no Sequence subflow.entry) ───

describe('buildRunSteps — P1b: Sequence as outermost runner', () => {
  it('infers implicit Sequence root from multiple sibling primitive boundaries', () => {
    // When a Sequence is the OUTERMOST runner, its OWN subflow.entry
    // never fires — only its children's. The projection must still
    // recognize this as a Sequence root (not "first child kind") so
    // the filter surfaces sequential transitions, not intra-leaf
    // react arrows.
    //
    // Without this inference, slider total = 4 (all react steps inside
    // both LLMCalls). Expected: 3 (asks + forwards + answers).
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt({ message: 'hi' }));
    // No Sequence boundary — children fire directly at depth 1.
    rec.onSubflowEntry!(
      subEvt('step-classify', 'classify', 'cls#0', 'LLMCall: classify'),
    );
    rec.onSubflowExit!(subEvt('step-classify', 'classify', 'cls#0'));
    rec.onSubflowEntry!(
      subEvt('step-respond', 'respond', 'rsp#0', 'LLMCall: respond'),
    );
    rec.onSubflowExit!(subEvt('step-respond', 'respond', 'rsp#0'));
    rec.onRunEnd!(runEvt({ result: 'done' }));

    const steps = buildRunSteps(rec);
    // Filter (Sequence root → keep non-react) leaves 3 sequentials.
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.label)).toEqual(['asks', 'forwards', 'answers']);
  });
});

// ─── P2: Parallel ────────────────────────────────────────────────────

describe('buildRunSteps — P2: Parallel fan-out (3 branches)', () => {
  it('coalesces 3 fork.branch events into ONE fork step with 3 transitions', () => {
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt());
    rec.onSubflowEntry!(subEvt('sf-par', 'Committee', 'par#0', 'Parallel: fan-out'));
    rec.onFork!(forkEvt('sf-par', ['legal', 'ethics', 'finance'], 'par#0'));
    rec.onSubflowExit!(subEvt('sf-par', 'Committee', 'par#0'));
    rec.onRunEnd!(runEvt());

    const steps = buildRunSteps(rec);
    const forks = steps.filter((s) => s.kind === 'fork');
    expect(forks).toHaveLength(1);
    expect(forks[0].transitions).toHaveLength(3);
    expect(forks[0].transitions.map((t) => t.label)).toEqual(['legal', 'ethics', 'finance']);
    expect(forks[0].meta?.kind).toBe('fork');
  });

  it('Parallel-as-runner shape (matches actual playground events)', () => {
    // Mirrors the real event sequence from `parallel-events-dump`:
    // FlowRecorder.onFork fires (engine-level fork) AND wrapper
    // subflow.entry/exit events follow. Branches don't carry
    // primitiveKind (the wrapper desc is "Parallel branch ... —
    // catches failures"); they're identified via fork.branch.childName.
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt());
    rec.onFork!(forkEvt('Seed', ['legal', 'ethics', 'cost'], 'Seed#0'));
    // Wrapper subflow entries (no primitiveKind — wrappers, not LLMCalls).
    rec.onSubflowEntry!(subEvt('legal', 'legal', 'legal#1'));
    rec.onSubflowEntry!(subEvt('ethics', 'ethics', 'ethics#3'));
    rec.onSubflowEntry!(subEvt('cost', 'cost', 'cost#5'));
    rec.onSubflowExit!(subEvt('cost', 'cost', 'cost#5'));
    rec.onSubflowExit!(subEvt('legal', 'legal', 'legal#1'));
    rec.onSubflowExit!(subEvt('ethics', 'ethics', 'ethics#3'));
    rec.onRunEnd!(runEvt());

    const steps = buildRunSteps(rec);
    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('fork');
    expect(steps[0].transitions).toHaveLength(3);
    expect(steps[0].transitions.map((t) => t.label)).toEqual([
      'legal',
      'ethics',
      'cost',
    ]);
    // Each fork transition has from=actor:user (User → branch).
    expect(steps[0].transitions.every((t) => t.from === 'actor:user')).toBe(true);
    expect(steps[1].kind).toBe('merge');
    expect(steps[1].transitions).toHaveLength(3);
    expect(steps[1].transitions.every((t) => t.to === 'actor:user')).toBe(true);
  });
});

// ─── P3: Conditional ─────────────────────────────────────────────────

describe('buildRunSteps — P3: Conditional (chosen branch only)', () => {
  it('emits a decide step for the chosen branch', () => {
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt());
    rec.onSubflowEntry!(subEvt('sf-cond', 'Cond', 'cond#0', 'Conditional: route'));
    rec.onDecision!(decisionEvt('sf-cond', 'billing', 'cond#0', 'matched-billing-keyword'));
    rec.onSubflowEntry!(subEvt('sf-cond/sf-billing', 'billing', 'bil#0', 'LLMCall: billing'));
    rec.onSubflowExit!(subEvt('sf-cond/sf-billing', 'billing', 'bil#0'));
    rec.onSubflowExit!(subEvt('sf-cond', 'Cond', 'cond#0'));
    rec.onRunEnd!(runEvt());

    const steps = buildRunSteps(rec);
    const decides = steps.filter((s) => s.kind === 'decide');
    expect(decides).toHaveLength(1);
    expect(decides[0].meta?.kind).toBe('decide');
    if (decides[0].meta?.kind === 'decide') {
      expect(decides[0].meta.chosen).toBe('billing');
      expect(decides[0].meta.rationale).toBe('matched-billing-keyword');
    }
  });
});

// ─── P4: Loop ────────────────────────────────────────────────────────

describe('buildRunSteps — P4: Loop (3 iterations)', () => {
  it('emits one iteration step per loop.iteration event', () => {
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt());
    rec.onSubflowEntry!(subEvt('sf-loop', 'Loop', 'loop#0', 'Loop: iterate'));
    rec.onLoop!(loopEvt('body', 1, 'loop#0'));
    rec.onLoop!(loopEvt('body', 2, 'loop#0'));
    rec.onLoop!(loopEvt('body', 3, 'loop#0'));
    rec.onSubflowExit!(subEvt('sf-loop', 'Loop', 'loop#0'));
    rec.onRunEnd!(runEvt());

    const steps = buildRunSteps(rec);
    const iters = steps.filter((s) => s.kind === 'iteration');
    expect(iters).toHaveLength(3);
    expect(iters.map((s) => s.meta?.kind === 'iteration' && s.meta.index)).toEqual([1, 2, 3]);
  });
});

// ─── P4b: Agent + tools (ReAct, 2 iterations + 1 tool call) ────────

describe('buildRunSteps — P4b: Agent ReAct (2 iters + 1 tool call)', () => {
  it('emits 4 react steps at top-level for a leaf Agent root', () => {
    // Mimics the playground's "02. Agent + tools (ReAct)" sample:
    // iter 1: user→llm (asks model)  → llm→tool (model wants weather)
    //           tool.start/end (weather, Dallas)
    // iter 2: tool→llm (model gets result) → llm→user (final answer)
    //
    // Expected slider after filter (root=Agent → keep react only):
    //   pos 1: user→llm  (iter 1 dispatch)
    //   pos 2: llm→tool  (iter 1 wants tool)
    //   pos 3: tool→llm  (iter 2 sees tool result)
    //   pos 4: llm→user  (iter 2 final answer)
    const { rec, dispatcher } = freshRecorder();
    rec.onRunStart!(runEvt());
    rec.onSubflowEntry!(subEvt('sf-agent', 'Agent', 'agent#0', 'Agent: ReAct loop'));

    // Iter 1: user→llm dispatch
    dispatchTyped(
      dispatcher,
      'agentfootprint.stream.llm_start',
      {
        provider: 'anthropic',
        model: 'sonnet',
        toolsCount: 1,
        messagesCount: 1,
        iteration: 1,
      },
      'sf-agent/call-llm#5',
      ['sf-agent'],
    );
    // Iter 1: model wants tool (toolCallCount > 0 → llm→tool)
    dispatchTyped(
      dispatcher,
      'agentfootprint.stream.llm_end',
      {
        provider: 'anthropic',
        model: 'sonnet',
        usage: { input: 30, output: 5 },
        toolCallCount: 1,
        durationMs: 100,
        content: '',
      },
      'sf-agent/call-llm#5',
      ['sf-agent'],
    );
    // Tool runs (no react step emitted from tool events directly)
    dispatchTyped(
      dispatcher,
      'agentfootprint.stream.tool_start',
      { toolName: 'weather', toolCallId: 'tc1', args: { city: 'Dallas' } },
      'sf-agent/tool#7',
      ['sf-agent'],
    );
    dispatchTyped(
      dispatcher,
      'agentfootprint.stream.tool_end',
      { toolCallId: 'tc1', result: 'sunny', durationMs: 50 },
      'sf-agent/tool#7',
      ['sf-agent'],
    );
    // Iter 2: tool→llm
    dispatchTyped(
      dispatcher,
      'agentfootprint.stream.llm_start',
      {
        provider: 'anthropic',
        model: 'sonnet',
        toolsCount: 1,
        messagesCount: 3,
        iteration: 2,
      },
      'sf-agent/call-llm#10',
      ['sf-agent'],
    );
    // Iter 2: terminal llm→user
    dispatchTyped(
      dispatcher,
      'agentfootprint.stream.llm_end',
      {
        provider: 'anthropic',
        model: 'sonnet',
        usage: { input: 40, output: 30 },
        toolCallCount: 0,
        durationMs: 200,
        content: 'Dallas is sunny.',
      },
      'sf-agent/call-llm#10',
      ['sf-agent'],
    );
    rec.onSubflowExit!(subEvt('sf-agent', 'Agent', 'agent#0'));
    rec.onRunEnd!(runEvt());

    const steps = buildRunSteps(rec);
    expect(steps).toHaveLength(4);
    const arrows = steps.map((s) =>
      s.meta?.kind === 'react' ? s.meta.actorArrow : s.kind,
    );
    expect(arrows).toEqual(['user→llm', 'llm→tool', 'tool→llm', 'llm→user']);
  });
});

// ─── P5: Single LLMCall ─────────────────────────────────────────────

describe('buildRunSteps — P5: single LLMCall (one-shot)', () => {
  it('emits user→llm and llm→user react steps from typed llm events', () => {
    const { rec, dispatcher } = freshRecorder();
    rec.onRunStart!(runEvt());
    rec.onSubflowEntry!(subEvt('sf-llm', 'LLMCall', 'llm#0', 'LLMCall: one-shot'));
    dispatchTyped(
      dispatcher,
      'agentfootprint.stream.llm_start',
      { provider: 'anthropic', model: 'sonnet', toolsCount: 0, messagesCount: 1, iteration: 1 },
      'llm#0',
      ['sf-llm'],
    );
    dispatchTyped(
      dispatcher,
      'agentfootprint.stream.llm_end',
      {
        provider: 'anthropic',
        model: 'sonnet',
        usage: { input: 10, output: 20 },
        toolCallCount: 0,
        durationMs: 100,
        content: 'hello world',
      },
      'llm#0',
      ['sf-llm'],
    );
    rec.onSubflowExit!(subEvt('sf-llm', 'LLMCall', 'llm#0'));
    rec.onRunEnd!(runEvt());

    const steps = buildRunSteps(rec);
    const reacts = steps.filter((s) => s.kind === 'react');
    expect(reacts).toHaveLength(2);
    expect(reacts[0].meta?.kind === 'react' && reacts[0].meta.actorArrow).toBe('user→llm');
    expect(reacts[1].meta?.kind === 'react' && reacts[1].meta.actorArrow).toBe('llm→user');
  });
});

// ─── P6: drill-path filter ───────────────────────────────────────────

describe('buildRunSteps — P6: drill scope filter', () => {
  it('filters steps to those whose anchor.subflowPath matches drillPath prefix', () => {
    const { rec } = freshRecorder();
    rec.onRunStart!(runEvt());
    rec.onSubflowEntry!(subEvt('sf-seq', 'Pipeline', 'seq#0', 'Sequence: pipeline'));
    rec.onSubflowEntry!(
      subEvt('sf-seq/sf-classify', 'classify', 'cls#0', 'LLMCall: classify'),
    );
    rec.onSubflowExit!(subEvt('sf-seq/sf-classify', 'classify', 'cls#0'));
    rec.onSubflowExit!(subEvt('sf-seq', 'Pipeline', 'seq#0'));
    rec.onRunEnd!(runEvt());

    const all = buildRunSteps(rec);
    const drilled = buildRunSteps(rec, {
      drillPath: ['__root__', 'sf-seq', 'sf-seq/sf-classify'],
    });
    expect(drilled.length).toBeLessThanOrEqual(all.length);
    for (const s of drilled) {
      // Anchor path starts with drillPath segments.
      expect(s.anchor.subflowPath.length).toBeGreaterThanOrEqual(3);
    }
  });
});

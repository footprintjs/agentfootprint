/**
 * Tests — `FlowchartRecorder` boundary-payload integration.
 *
 * The recorder composes footprintjs `BoundaryRecorder` alongside
 * `TopologyRecorder` so subflow StepNodes carry the payloads crossing
 * each subflow's boundary (`inputMapper` result on entry, subflow shared
 * state on exit). This is what feeds Lens's right-pane node-detail
 * panel — the developer can see exactly what context flowed in and out
 * of each subflow without any post-walk on the consumer side.
 *
 * 7 patterns cover the consumer circle:
 *   P1  Subflow node carries `entryPayload` from inputMapper
 *   P2  Subflow node carries `exitPayload` from outputMapper / shared state
 *   P3  Subflow node carries `runtimeStageId` for cross-view binding
 *   P4  Topology nodes (fork-branch / decision-branch) never carry payloads
 *   P5  Loop re-entry: each iteration's subflow node gets distinct payloads
 *   P6  Nested subflows: child + parent each have their own payloads
 *   P7  In-progress / paused: entry without exit → entryPayload set, exitPayload undefined
 */

import { describe, expect, it } from 'vitest';
import type { CombinedRecorder } from 'footprintjs';
import type {
  FlowDecisionEvent,
  FlowForkEvent,
  FlowSubflowEvent,
} from 'footprintjs/dist/types/lib/engine/narrative/types.js';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import {
  attachFlowchart,
  type StepGraph,
} from '../../../src/recorders/observability/FlowchartRecorder.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function freshHandle(): {
  dispatcher: EventDispatcher;
  recorder: CombinedRecorder;
  getGraph: () => StepGraph;
} {
  const dispatcher = new EventDispatcher();
  let captured: CombinedRecorder | undefined;
  const handle = attachFlowchart(
    (r) => {
      captured = r;
      return () => undefined;
    },
    dispatcher,
    {},
  );
  if (!captured) throw new Error('runnerAttach was not invoked');
  return { dispatcher, recorder: captured, getGraph: handle.getSnapshot };
}

function entryEvent(
  subflowId: string,
  name: string,
  runtimeStageId: string,
  mappedInput?: Record<string, unknown>,
  description?: string,
): FlowSubflowEvent {
  return {
    name,
    subflowId,
    description,
    mappedInput,
    traversalContext: {
      stageId: subflowId,
      runtimeStageId,
      stageName: name,
      depth: subflowId.split('/').length - 1,
    },
  };
}

function exitEvent(
  subflowId: string,
  name: string,
  runtimeStageId: string,
  outputState?: Record<string, unknown>,
): FlowSubflowEvent {
  return {
    name,
    subflowId,
    outputState,
    traversalContext: {
      stageId: subflowId,
      runtimeStageId,
      stageName: name,
      depth: subflowId.split('/').length - 1,
    },
  };
}

function fork(parent: string, children: string[], runtimeStageId: string): FlowForkEvent {
  return {
    parent,
    children,
    traversalContext: { stageId: parent, runtimeStageId, stageName: parent, depth: 0 },
  };
}

function decision(
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

// ─── P1: subflow node has entryPayload ──────────────────────────────────

describe('FlowchartRecorder boundary — P1: entryPayload from inputMapper', () => {
  it("subflow StepNode carries the inputMapper's mapped input", () => {
    const { recorder, getGraph } = freshHandle();
    recorder.onSubflowEntry!(
      entryEvent('sf-task', 'Task', 'task#0', { request: 'analyze' }, 'Agent: ReAct loop'),
    );
    recorder.onSubflowExit!(exitEvent('sf-task', 'Task', 'task#0', { result: 'done' }));

    const subflowNode = getGraph().nodes.find((n) => n.kind === 'subflow' && n.id === 'sf-task');
    expect(subflowNode?.entryPayload).toEqual({ request: 'analyze' });
  });
});

// ─── P2: subflow node has exitPayload ───────────────────────────────────

describe('FlowchartRecorder boundary — P2: exitPayload from subflow shared state', () => {
  it('subflow StepNode carries the outputMapper / output state at exit', () => {
    const { recorder, getGraph } = freshHandle();
    recorder.onSubflowEntry!(entryEvent('sf-task', 'Task', 'task#0', { in: 1 }));
    recorder.onSubflowExit!(exitEvent('sf-task', 'Task', 'task#0', { in: 1, out: 2 }));

    const subflowNode = getGraph().nodes.find((n) => n.kind === 'subflow' && n.id === 'sf-task');
    expect(subflowNode?.exitPayload).toEqual({ in: 1, out: 2 });
  });
});

// ─── P3: runtimeStageId for cross-view binding ─────────────────────────

describe('FlowchartRecorder boundary — P3: runtimeStageId on subflow nodes', () => {
  it('subflow StepNode exposes runtimeStageId so Lens can snap-bind to Trace view', () => {
    const { recorder, getGraph } = freshHandle();
    recorder.onSubflowEntry!(entryEvent('sf-x', 'X', 'x#5', {}));
    recorder.onSubflowExit!(exitEvent('sf-x', 'X', 'x#5', {}));

    const subflowNode = getGraph().nodes.find((n) => n.kind === 'subflow' && n.id === 'sf-x');
    expect(subflowNode?.runtimeStageId).toBe('x#5');
  });
});

// ─── P4: topology nodes don't have payloads ────────────────────────────

describe('FlowchartRecorder boundary — P4: fork/decision nodes never carry payloads', () => {
  it('fork-branch nodes have no entry/exit payload (BoundaryRecorder only tracks subflows)', () => {
    const { recorder, getGraph } = freshHandle();
    recorder.onSubflowEntry!(entryEvent('sf-root', 'Root', 'r#0'));
    recorder.onFork!(fork('Root', ['Alpha', 'Beta'], 'r#1'));

    const forkNodes = getGraph().nodes.filter((n) => n.kind === 'fork-branch');
    expect(forkNodes.length).toBe(2);
    for (const fb of forkNodes) {
      expect(fb.entryPayload).toBeUndefined();
      expect(fb.exitPayload).toBeUndefined();
      expect(fb.runtimeStageId).toBeUndefined();
    }
  });

  it('decision-branch nodes have no entry/exit payload', () => {
    const { recorder, getGraph } = freshHandle();
    recorder.onSubflowEntry!(entryEvent('sf-root', 'Root', 'r#0'));
    recorder.onDecision!(decision('Route', 'Approve', 'r#1', 'high score'));

    const decBranch = getGraph().nodes.find((n) => n.kind === 'decision-branch');
    expect(decBranch?.entryPayload).toBeUndefined();
    expect(decBranch?.exitPayload).toBeUndefined();
    expect(decBranch?.runtimeStageId).toBeUndefined();
  });
});

// ─── P5: loop re-entry → distinct payloads per iteration ───────────────

describe('FlowchartRecorder boundary — P5: loop re-entry distinct payloads', () => {
  it('each loop iteration produces a separate subflow node with its own payload', () => {
    const { recorder, getGraph } = freshHandle();
    // Same subflowId entered twice — TopologyRecorder appends `#1` to the
    // second entry; BoundaryRecorder's index aligns by re-entry counter.
    recorder.onSubflowEntry!(entryEvent('sf-iter', 'Iter', 'iter#0', { round: 1 }));
    recorder.onSubflowExit!(exitEvent('sf-iter', 'Iter', 'iter#0', { result: 'first' }));
    recorder.onSubflowEntry!(entryEvent('sf-iter', 'Iter', 'iter#1', { round: 2 }));
    recorder.onSubflowExit!(exitEvent('sf-iter', 'Iter', 'iter#1', { result: 'second' }));

    const subflowNodes = getGraph().nodes.filter((n) => n.kind === 'subflow');
    expect(subflowNodes.map((n) => n.id)).toEqual(['sf-iter', 'sf-iter#1']);
    expect(subflowNodes[0].entryPayload).toEqual({ round: 1 });
    expect(subflowNodes[0].exitPayload).toEqual({ result: 'first' });
    expect(subflowNodes[1].entryPayload).toEqual({ round: 2 });
    expect(subflowNodes[1].exitPayload).toEqual({ result: 'second' });
    expect(subflowNodes[0].runtimeStageId).toBe('iter#0');
    expect(subflowNodes[1].runtimeStageId).toBe('iter#1');
  });
});

// ─── P6: nested subflows each have own payloads ────────────────────────

describe('FlowchartRecorder boundary — P6: nested subflows', () => {
  it('parent + child subflow nodes each carry their own boundary payloads', () => {
    const { recorder, getGraph } = freshHandle();
    recorder.onSubflowEntry!(entryEvent('sf-parent', 'Parent', 'p#0', { from: 'caller' }));
    // Engine emits child subflowId path-prefixed under the parent.
    recorder.onSubflowEntry!(
      entryEvent('sf-parent/sf-child', 'Child', 'c#1', { from: 'parent' }),
    );
    recorder.onSubflowExit!(
      exitEvent('sf-parent/sf-child', 'Child', 'c#1', { back: 'to parent' }),
    );
    recorder.onSubflowExit!(exitEvent('sf-parent', 'Parent', 'p#0', { back: 'to caller' }));

    const nodes = getGraph().nodes.filter((n) => n.kind === 'subflow');
    const parent = nodes.find((n) => n.id === 'sf-parent')!;
    const child = nodes.find((n) => n.id === 'sf-parent/sf-child')!;

    expect(parent.entryPayload).toEqual({ from: 'caller' });
    expect(parent.exitPayload).toEqual({ back: 'to caller' });
    expect(child.entryPayload).toEqual({ from: 'parent' });
    expect(child.exitPayload).toEqual({ back: 'to parent' });
  });
});

// ─── P7: in-progress / paused → entry only, exitPayload undefined ──────

describe('FlowchartRecorder boundary — P7: in-progress subflow (entry without exit)', () => {
  it('paused subflow has entryPayload but no exitPayload', () => {
    const { recorder, getGraph } = freshHandle();
    recorder.onSubflowEntry!(
      entryEvent('sf-pause', 'AwaitingApproval', 'pause#0', { question: 'Approve $50k?' }),
    );
    // No matching onSubflowExit — pause re-throws PauseSignal before exit fires.

    const subflowNode = getGraph().nodes.find((n) => n.kind === 'subflow' && n.id === 'sf-pause');
    expect(subflowNode?.entryPayload).toEqual({ question: 'Approve $50k?' });
    expect(subflowNode?.exitPayload).toBeUndefined();
    expect(subflowNode?.runtimeStageId).toBe('pause#0');
  });
});

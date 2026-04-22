/**
 * AgentTimelineRecorder — TopologyRecorder composition tests (5 patterns).
 *
 * Proves the refactor: all composition discovery flows through the
 * internal `TopologyRecorder`. No more `setComposition` handshake. Works
 * for any composition shape the executor traverses.
 *
 *   P1  No subflow events      → subAgents empty (base case)
 *   P2  Sequential subflows    → subAgents in execution order
 *   P3  Parallel fork          → fork-branches + subflow children;
 *                                getTimeline().subAgents surfaces subflows
 *   P4  Conditional branch     → decision-branch + matched subflow child
 *   P5  getTopology()          → direct access to composed accumulator
 */
import { describe, it, expect } from 'vitest';
import type {
  FlowDecisionEvent,
  FlowForkEvent,
  FlowSubflowEvent,
} from 'footprintjs';
import { agentTimeline } from '../../src/recorders/AgentTimelineRecorder';

// ── Helpers ─────────────────────────────────────────────────────────────

const entry = (subflowId: string, name: string, runtimeStageId: string): FlowSubflowEvent => ({
  name,
  subflowId,
  traversalContext: { stageId: subflowId, runtimeStageId, stageName: name, depth: 0 },
});

const fork = (parent: string, children: string[], runtimeStageId: string): FlowForkEvent => ({
  parent,
  children,
  traversalContext: { stageId: parent, runtimeStageId, stageName: parent, depth: 0 },
});

const decision = (
  decider: string,
  chosen: string,
  runtimeStageId: string,
): FlowDecisionEvent => ({
  decider,
  chosen,
  traversalContext: { stageId: decider, runtimeStageId, stageName: decider, depth: 0 },
});

/**
 * Enter a fake sub-agent: its root subflow + a synthetic API-slot
 * subflow (sf-messages) inside it + exit both. This makes the subflow
 * qualify as a sub-agent under the new "wraps an API slot" heuristic
 * that selectSubAgents uses to distinguish real sub-agents from
 * single-agent internal structure.
 */
const enterAgent = (
  rec: ReturnType<typeof agentTimeline>,
  id: string,
  name: string,
  enterAt: string,
  exitAt: string,
) => {
  rec.onSubflowEntry(entry(id, name, enterAt));
  rec.onSubflowEntry(entry('sf-messages', 'Messages', `${enterAt}.slot`));
  rec.onSubflowExit(entry('sf-messages', 'Messages', `${enterAt}.slot-end`));
  rec.onSubflowExit(entry(id, name, exitAt));
};

// ── P1: base case ──────────────────────────────────────────────────────

describe('AgentTimelineRecorder — topology composition', () => {
  it('P1 base case: no flow events → selectAgent works, selectSubAgents is empty', () => {
    const rec = agentTimeline({ id: 'agent-1', name: 'Root' });
    expect(rec.selectAgent()).toEqual({ id: 'agent-1', name: 'Root' });
    expect(rec.selectSubAgents()).toEqual([]);
  });

  // ── P2: sequential ────────────────────────────────────────────────────

  it('P2 sequential sub-agents (each wraps an API slot): subAgents derived in order', () => {
    const rec = agentTimeline({ id: 'pipeline' });
    enterAgent(rec, 'sf-classify', 'Classify', 'c#0', 'c#1');
    enterAgent(rec, 'sf-analyze', 'Analyze', 'a#2', 'a#3');
    enterAgent(rec, 'sf-respond', 'Respond', 'r#4', 'r#5');

    const subAgents = rec.selectSubAgents();
    expect(subAgents.map((sa) => sa.id)).toEqual(['sf-classify', 'sf-analyze', 'sf-respond']);
    expect(subAgents.map((sa) => sa.name)).toEqual(['Classify', 'Analyze', 'Respond']);
  });

  // ── P3: parallel fork ─────────────────────────────────────────────────

  it('P3 parallel fork of sub-agents: fork-branch nodes + slot-wrapping children → subAgents', () => {
    const rec = agentTimeline({ id: 'parallel' });
    rec.onSubflowEntry(entry('sf-parent', 'Parent', 'p#0'));
    rec.onSubflowEntry(entry('sf-messages', 'Messages', 'p#0.slot'));
    rec.onSubflowExit(entry('sf-messages', 'Messages', 'p#0.slot-end'));
    rec.onFork(fork('Parent', ['Alpha', 'Beta'], 'p#1'));
    enterAgent(rec, 'sf-alpha', 'Alpha', 'a#2', 'a#3');
    enterAgent(rec, 'sf-beta', 'Beta', 'b#4', 'b#5');

    // subAgents: all three wrap slots (parent wraps own + alpha/beta wrap theirs)
    expect(rec.selectSubAgents().map((sa) => sa.id)).toEqual(['sf-parent', 'sf-alpha', 'sf-beta']);

    // Topology graph carries the full composition shape including forks.
    const topo = rec.selectTopology();
    const forkBranches = topo.nodes.filter((n) => n.kind === 'fork-branch');
    expect(forkBranches.map((n) => n.name)).toEqual(['Alpha', 'Beta']);

    // Each subflow child is nested under its fork-branch parent.
    const alphaBranch = forkBranches.find((n) => n.name === 'Alpha')!;
    const sfAlpha = topo.nodes.find((n) => n.id === 'sf-alpha')!;
    expect(sfAlpha.parentId).toBe(alphaBranch.id);
  });

  // ── P4: conditional ───────────────────────────────────────────────────

  it('P4 conditional → sub-agent: decision-branch node + chosen agent nested under it', () => {
    const rec = agentTimeline({ id: 'router' });
    rec.onSubflowEntry(entry('sf-root', 'Root', 'r#0'));
    rec.onSubflowEntry(entry('sf-messages', 'Messages', 'r#0.slot'));
    rec.onSubflowExit(entry('sf-messages', 'Messages', 'r#0.slot-end'));
    rec.onDecision(decision('Route', 'HighRisk', 'r#1'));
    enterAgent(rec, 'sf-high', 'HighRisk', 'h#2', 'h#3');

    const topo = rec.selectTopology();
    const decBranch = topo.nodes.find((n) => n.kind === 'decision-branch')!;
    const sfHigh = topo.nodes.find((n) => n.id === 'sf-high')!;

    expect(decBranch.name).toBe('HighRisk');
    expect(decBranch.metadata?.decider).toBe('Route');
    expect(sfHigh.parentId).toBe(decBranch.id);

    // Chosen sub-agent surfaces because it wraps an API slot.
    expect(rec.selectSubAgents().map((s) => s.id)).toContain('sf-high');
  });

  // ── P5: direct topology access ────────────────────────────────────────

  it('P5 getTopology() exposes the composed TopologyRecorder for advanced queries', () => {
    const rec = agentTimeline();
    rec.onSubflowEntry(entry('sf-a', 'A', 'a#0'));

    const topo = rec.getTopology();
    expect(topo).toBeDefined();
    expect(topo.getSubflowNodes().map((n) => n.id)).toEqual(['sf-a']);
    expect(topo.id).toMatch(/-topology$/);
  });

  // ── Lifecycle: clear() resets topology too ────────────────────────────

  it('clear() resets both the entry sequence and the composed topology', () => {
    const rec = agentTimeline();
    enterAgent(rec, 'sf-x', 'X', 'x#0', 'x#1');
    expect(rec.selectSubAgents().length).toBeGreaterThan(0);

    rec.clear();
    expect(rec.selectSubAgents()).toEqual([]);
    expect(rec.selectTopology().nodes).toEqual([]);
  });
});

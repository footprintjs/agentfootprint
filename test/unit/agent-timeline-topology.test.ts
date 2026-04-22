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

// ── P1: base case ──────────────────────────────────────────────────────

describe('AgentTimelineRecorder — topology composition', () => {
  it('P1 base case: no flow events → selectAgent works, selectSubAgents is empty', () => {
    const rec = agentTimeline({ id: 'agent-1', name: 'Root' });
    expect(rec.selectAgent()).toEqual({ id: 'agent-1', name: 'Root' });
    expect(rec.selectSubAgents()).toEqual([]);
  });

  // ── P2: sequential ────────────────────────────────────────────────────

  it('P2 sequential subflows: subAgents derived from topology subflow nodes in order', () => {
    const rec = agentTimeline({ id: 'pipeline' });
    rec.onSubflowEntry(entry('sf-classify', 'Classify', 'c#0'));
    rec.onSubflowExit(entry('sf-classify', 'Classify', 'c#1'));
    rec.onSubflowEntry(entry('sf-analyze', 'Analyze', 'a#2'));
    rec.onSubflowExit(entry('sf-analyze', 'Analyze', 'a#3'));
    rec.onSubflowEntry(entry('sf-respond', 'Respond', 'r#4'));
    rec.onSubflowExit(entry('sf-respond', 'Respond', 'r#5'));

    const subAgents = rec.selectSubAgents();
    expect(subAgents.map((sa) => sa.id)).toEqual(['sf-classify', 'sf-analyze', 'sf-respond']);
    expect(subAgents.map((sa) => sa.name)).toEqual(['Classify', 'Analyze', 'Respond']);
  });

  // ── P3: parallel fork ─────────────────────────────────────────────────

  it('P3 parallel fork of subflows: fork-branch nodes + subflow children; timeline surfaces subflow ids only', () => {
    const rec = agentTimeline({ id: 'parallel' });
    rec.onSubflowEntry(entry('sf-parent', 'Parent', 'p#0'));
    rec.onFork(fork('Parent', ['Alpha', 'Beta'], 'p#1'));
    rec.onSubflowEntry(entry('sf-alpha', 'Alpha', 'a#2'));
    rec.onSubflowExit(entry('sf-alpha', 'Alpha', 'a#3'));
    rec.onSubflowEntry(entry('sf-beta', 'Beta', 'b#4'));
    rec.onSubflowExit(entry('sf-beta', 'Beta', 'b#5'));

    // Timeline subAgents reflects ALL subflow nodes (parent + 2 branches).
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

  it('P4 conditional → subflow: decision-branch node + chosen subflow nested under it', () => {
    const rec = agentTimeline({ id: 'router' });
    rec.onSubflowEntry(entry('sf-root', 'Root', 'r#0'));
    rec.onDecision(decision('Route', 'HighRisk', 'r#1'));
    rec.onSubflowEntry(entry('sf-high', 'HighRisk', 'h#2'));
    rec.onSubflowExit(entry('sf-high', 'HighRisk', 'h#3'));

    const topo = rec.selectTopology();
    const decBranch = topo.nodes.find((n) => n.kind === 'decision-branch')!;
    const sfHigh = topo.nodes.find((n) => n.id === 'sf-high')!;

    expect(decBranch.name).toBe('HighRisk');
    expect(decBranch.metadata?.decider).toBe('Route');
    expect(sfHigh.parentId).toBe(decBranch.id);

    // Timeline still exposes the chosen subflow as a sub-agent.
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
    rec.onSubflowEntry(entry('sf-x', 'X', 'x#0'));
    expect(rec.selectSubAgents().length).toBeGreaterThan(0);

    rec.clear();
    expect(rec.selectSubAgents()).toEqual([]);
    expect(rec.selectTopology().nodes).toEqual([]);
  });
});

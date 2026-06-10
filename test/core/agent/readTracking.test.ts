/**
 * #18/#14 — AgentOptions.readTracking: the observability-cost lever for
 * snapshot `stageReads`, exposed from the Agent and forwarded to its
 * internal FlowChartExecutor.
 *
 * Default is 'summary' (measurement-gated, #18): stageReads VALUES have
 * zero consumers across agentfootprint/lens/explainable-ui, and 'full'
 * clones ~18MB of unread data per 200 full-feature iterations. Consumers
 * that inspect read values set 'full' explicitly.
 *
 * These tests verify the plumbing end-to-end through a REAL agent run:
 * the option reaches the executor, and the snapshot's stageReads shape
 * matches the mode (markers / cloned values / absent).
 */

import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../../src/index.js';
import type { ReadTrackingMode, ReadSummaryMarker } from '../../../src/index.js';

/** Build a deterministic 2-iteration agent (one tool call, then final). */
function buildAgent(readTracking?: ReadTrackingMode): Agent {
  const echo = defineTool({
    name: 'echo',
    description: 'echo back',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => 'echoed',
  });
  let calls = 0;
  const provider = mock({
    chunkDelayMs: 0,
    respond: () => {
      calls++;
      if (calls === 1) {
        return {
          content: 'calling echo',
          toolCalls: [{ id: 'c1', name: 'echo', args: {} }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use',
        };
      }
      return {
        content: 'final answer',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      };
    },
  });
  return Agent.create({
    provider,
    model: 'mock',
    ...(readTracking !== undefined && { readTracking }),
  })
    .system('You are a test agent.')
    .tool(echo)
    .build();
}

type StageSnapshotLike = {
  stageReads?: Record<string, unknown>;
  next?: StageSnapshotLike;
  children?: StageSnapshotLike[];
};

/** Collect every stageReads record across the execution tree (next + children). */
function collectStageReads(root: StageSnapshotLike): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (node: StageSnapshotLike | undefined): void => {
    if (!node) return;
    if (node.stageReads !== undefined) out.push(node.stageReads);
    for (const child of node.children ?? []) walk(child);
    walk(node.next);
  };
  walk(root);
  return out;
}

function isSummaryMarker(v: unknown): v is ReadSummaryMarker {
  return typeof v === 'object' && v !== null && (v as ReadSummaryMarker).__readSummary === true;
}

describe('AgentOptions.readTracking — snapshot stageReads policy', () => {
  it("defaults to 'summary': every tracked read is a ReadSummaryMarker, not a value clone", async () => {
    const agent = buildAgent(); // no option → Agent default
    const answer = await agent.run({ message: 'go' });
    expect(String(answer)).toContain('final answer');

    const snap = agent.getSnapshot();
    expect(snap).toBeDefined();
    const reads = collectStageReads(snap!.executionTree as StageSnapshotLike);
    // Reads of undefined values record `undefined` in EVERY mode (footprintjs
    // contract: `value === undefined ? undefined : marker/clone`) — they are
    // policy-neutral, so the shape assertion covers defined entries only.
    const entries = reads.flatMap((r) => Object.values(r)).filter((v) => v !== undefined);
    // The ReAct loop reads tracked state in every stage — must be non-empty.
    expect(entries.length).toBeGreaterThan(0);
    // Default 'summary': ALL defined entries are cheap markers.
    for (const value of entries) {
      expect(isSummaryMarker(value)).toBe(true);
    }
    // Marker shape: discriminant + refined type (footprintjs contract).
    const marker = entries.find(isSummaryMarker)!;
    expect(typeof marker.type).toBe('string');
  });

  it("explicit 'full' is honored: stageReads carries cloned VALUES (no markers)", async () => {
    const agent = buildAgent('full');
    await agent.run({ message: 'go' });

    const reads = collectStageReads(agent.getSnapshot()!.executionTree as StageSnapshotLike);
    const entries = reads.flatMap((r) => Object.values(r)).filter((v) => v !== undefined);
    expect(entries.length).toBeGreaterThan(0);
    // 'full' = historical behavior: real values, never markers.
    for (const value of entries) {
      expect(isSummaryMarker(value)).toBe(false);
    }
  });

  it("explicit 'off' is honored: stageReads is absent from every stage snapshot", async () => {
    const agent = buildAgent('off');
    await agent.run({ message: 'go' });

    const reads = collectStageReads(agent.getSnapshot()!.executionTree as StageSnapshotLike);
    expect(reads).toHaveLength(0);
  });

  it('narrative is identical across modes (the policy scopes ONLY snapshot stageReads)', async () => {
    const summaryAgent = buildAgent('summary');
    const offAgent = buildAgent('off');
    await summaryAgent.run({ message: 'go' });
    await offAgent.run({ message: 'go' });
    const render = (a: Agent): string[] =>
      a.getLastNarrativeEntries().map((e) => `${e.type}|${e.stageId ?? ''}`);
    expect(render(summaryAgent)).toEqual(render(offAgent));
  });
});

/**
 * AgentOptions.writeTracking — the sibling of `readTracking`: the policy for
 * the snapshot's per-stage write view (`stageWrites`), exposed from the Agent
 * and forwarded to its internal FlowChartExecutor.
 *
 * Default is 'summary': full written values have no reader that needs them,
 * and they grew the recorded execution tree with the square of the run length
 * (each pass rewrites growing arrays). Consumers that inspect written values
 * set 'full' explicitly.
 *
 * Verified end to end through REAL agent runs: the option reaches the
 * executor (the tree's shape per mode), the commit log is the same in every
 * mode, a recording's tree holds no full written value by default, and the
 * readers of the write view (the stored-cause projection, the durability
 * history writer) read the same either way.
 */

import { describe, expect, it } from 'vitest';
import { commitValueAt, type CommitBundle } from 'foottrace';

import { Agent, defineTool } from '../../../src/index.js';
import type { WriteSummaryMarker, WriteTrackingMode } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/observe.js';
import { traceCauseTools } from '../../../src/trace-toolpack/causeTools.js';
import { projectStoredCause } from '../../../src/trace-toolpack/storedCauseProjection.js';
import { callTraceTool } from '../../../src/trace-toolpack/traceToolpack.js';
import {
  requireStoredHistory,
  storedCauseFixture,
} from '../../trace-toolpack/storedCauseFixtures.js';

function buildAgent(writeTracking?: WriteTrackingMode): Agent {
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
      if (calls <= 2) {
        return {
          content: 'calling echo',
          toolCalls: [{ id: `c${calls}`, name: 'echo', args: {} }],
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
    ...(writeTracking !== undefined && { writeTracking }),
  })
    .system('You are a test agent.')
    .tool(echo)
    .build();
}

type StageSnapshotLike = {
  stageWrites?: Record<string, unknown>;
  next?: StageSnapshotLike;
  children?: StageSnapshotLike[];
};

/** Every stageWrites record across the execution tree (next + children), iteratively. */
function collectStageWrites(root: StageSnapshotLike | undefined): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const pending: (StageSnapshotLike | undefined)[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node.stageWrites !== undefined) out.push(node.stageWrites);
    pending.push(node.next, ...(node.children ?? []));
  }
  return out;
}

function isWriteMarker(v: unknown): v is WriteSummaryMarker {
  return typeof v === 'object' && v !== null && (v as WriteSummaryMarker).__writeSummary === true;
}

async function run(mode?: WriteTrackingMode) {
  const agent = buildAgent(mode);
  const answer = await agent.run({ message: 'go' });
  expect(String(answer)).toContain('final answer');
  const snapshot = agent.getSnapshot()!;
  const writes = collectStageWrites(snapshot.executionTree as StageSnapshotLike);
  const entries = writes.flatMap((w) => Object.values(w)).filter((v) => v !== undefined);
  return { agent, snapshot, writes, entries };
}

describe('AgentOptions.writeTracking — snapshot stageWrites policy', () => {
  it("defaults to 'summary': every recorded write is a WriteSummaryMarker, never the value", async () => {
    const { entries } = await run();
    // The ReAct loop writes tracked state in nearly every stage.
    expect(entries.length).toBeGreaterThan(0);
    for (const value of entries) expect(isWriteMarker(value)).toBe(true);
    const marker = entries.find(isWriteMarker)!;
    expect(typeof marker.type).toBe('string');
    expect(typeof marker.size).toBe('number');
  });

  it("explicit 'full' is honored: stageWrites carries the written VALUES (no markers)", async () => {
    const { entries } = await run('full');
    expect(entries.length).toBeGreaterThan(0);
    for (const value of entries) expect(isWriteMarker(value)).toBe(false);
  });

  it("explicit 'off' is honored: stageWrites is absent from every stage snapshot", async () => {
    const { writes } = await run('off');
    expect(writes).toEqual([]);
  });

  it("explicit 'summary' equals the default", async () => {
    const byDefault = await run();
    const explicit = await run('summary');
    const keys = (w: Record<string, unknown>[]) => w.map((one) => Object.keys(one).sort());
    expect(keys(explicit.writes)).toEqual(keys(byDefault.writes));
  });

  it('the commit log, keys and written values, is the same in every mode', async () => {
    const shape = (log: readonly CommitBundle[]) =>
      log.map((bundle) => ({
        stage: bundle.runtimeStageId,
        keys: bundle.trace.map((entry) => entry.path).sort(),
      }));
    const summary = await run('summary');
    const full = await run('full');
    const off = await run('off');
    const logOf = (s: typeof summary) => s.snapshot.commitLog as readonly CommitBundle[];
    expect(shape(logOf(summary))).toEqual(shape(logOf(full)));
    expect(shape(logOf(off))).toEqual(shape(logOf(full)));
    // A written value is read back from the log in every mode (role and text:
    // each run stamps its own ids and times).
    const last = logOf(full).length - 1;
    const said = (log: readonly CommitBundle[]) =>
      (commitValueAt(log, last, 'history') as { role: string; content: unknown }[]).map(
        (message) => [message.role, JSON.stringify(message.content)],
      );
    expect(said(logOf(full)).length).toBeGreaterThan(2);
    for (const one of [summary, off]) expect(said(logOf(one))).toEqual(said(logOf(full)));
  });

  it("a recorded run's execution tree holds no full written value by default, and is smaller", async () => {
    const treeBytes = async (mode?: WriteTrackingMode): Promise<number> => {
      const agent = buildAgent(mode);
      const recorder = recordRun(agent);
      try {
        await agent.run({ message: 'go' });
        const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as {
          snapshot: { executionTree: StageSnapshotLike };
        };
        const entries = collectStageWrites(recording.snapshot.executionTree)
          .flatMap((w) => Object.values(w))
          .filter((v) => v !== undefined);
        expect(entries.length).toBeGreaterThan(0);
        for (const value of entries) expect(isWriteMarker(value)).toBe(mode !== 'full');
        return JSON.stringify(recording.snapshot.executionTree).length;
      } finally {
        recorder.stop();
        await agent.shutdown();
      }
    };
    expect(await treeBytes()).toBeLessThan(await treeBytes('full'));
  });
});

describe('the readers of the write view read the same under markers', () => {
  it('the stored-cause projection reads only stageReads: markers in stageWrites project the same', async () => {
    const fixture = await storedCauseFixture();
    const history = await requireStoredHistory(fixture.entries, fixture.runId);
    const original = JSON.parse(JSON.stringify(history)) as { executionTree: StageSnapshotLike };
    const marked = JSON.parse(JSON.stringify(history)) as typeof original;
    let replaced = 0;
    for (const writes of collectStageWrites(marked.executionTree)) {
      for (const key of Object.keys(writes)) {
        writes[key] = { __writeSummary: true, type: 'number', size: 1 };
        replaced++;
      }
    }
    expect(replaced).toBeGreaterThan(0);
    // The graph holds the saved stage nodes by reference, so compare what it
    // ANSWERS: the roots it finds and the root-cause finding for each.
    const answers = async (history: unknown): Promise<unknown[]> => {
      const projected = projectStoredCause(history, fixture.runId, 1024 * 1024);
      if (projected.status !== 'ready') throw new Error(`not projected: ${projected.status}`);
      const roots = await projected.cause.graph.roots!({ signal: new AbortController().signal });
      expect(roots.length).toBeGreaterThan(0);
      const out: unknown[] = [];
      for (const nodeId of roots) {
        out.push(
          JSON.parse(
            await callTraceTool(traceCauseTools(projected.cause), 'root_cause', { nodeId }),
          ),
        );
      }
      return out;
    };
    expect(await answers(marked)).toEqual(await answers(original));
  });
});

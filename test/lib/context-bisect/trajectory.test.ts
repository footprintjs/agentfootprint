/**
 * trajectory — the per-loop trajectory assembler (proposal 005).
 *
 * Phase 1, the SEGMENTATION CORE: `bucketByAnchors` (the pure HEAD-range partition) +
 * `findLoopHeads` (flat-chart loop-head detection).
 * Phase 2, the AGENT-FLAVORED PROJECTION: `assembleTrajectory` — segments a REAL
 * flat-agent run into LoopFrames carrying call-llm pointers, intermediate text, and the
 * live contextSources (findLastWriter + commitValueAt over the SAME commit log).
 *
 * Convention-3 coverage: unit · functional · integration · property · security ·
 * performance · load. The load-bearing property: TOTALITY — every commit lands in
 * exactly one frame OR the prelude (none dropped or duplicated).
 */
import { describe, expect, it } from 'vitest';
import type { CommitBundle } from 'footprintjs/advanced';
import { Agent, mock, defineTool } from '../../../src/index';
import {
  assembleTrajectory,
  bucketByAnchors,
  findLoopHeads,
  type ContextBugArtifacts,
} from '../../../src/lib/context-bisect/index';
import { bucketByAnchors as viaObserve, assembleTrajectory as assembleViaObserve } from '../../../src/observe';

/** Minimal CommitBundle for partition tests (only stageId + runtimeStageId matter here). */
function mk(stageId: string, runtimeStageId: string): CommitBundle {
  return { stage: stageId, stageId, runtimeStageId, trace: [], redactedPaths: [], overwrite: {}, updates: {} } as CommitBundle;
}

/** A synthetic flat-agent commit log: a prelude + `loops` ReAct iterations, each
 *  injection-engine (head) → context → call-llm → route → tool-calls. */
function flatAgentLog(loops: number): CommitBundle[] {
  const log: CommitBundle[] = [mk('seed', 'seed#0'), mk('sf-memory-read/get', 'sf-memory-read/get#1')];
  let idx = 2;
  for (let k = 0; k < loops; k++) {
    log.push(mk('sf-injection-engine/resolve', `sf-injection-engine/resolve#${idx++}`)); // HEAD
    log.push(mk('context', `context#${idx++}`));
    log.push(mk('call-llm', `call-llm#${idx++}`));
    log.push(mk('route', `route#${idx++}`));
    log.push(mk('tool-calls', `tool-calls#${idx++}`));
  }
  return log;
}

// ─── 1. UNIT ─────────────────────────────────────────────────────────
describe('unit — bucketByAnchors', () => {
  it('partitions into prelude + half-open head ranges', () => {
    const log = [mk('seed', 'a'), mk('h', 'b'), mk('x', 'c'), mk('h', 'd'), mk('y', 'e')];
    const { frames, prelude } = bucketByAnchors(log, ['b', 'd']);
    expect(prelude).toEqual(['a']);
    expect(frames).toEqual([
      { headArrayIdx: 1, bodyIds: ['b', 'c'] },
      { headArrayIdx: 3, bodyIds: ['d', 'e'] },
    ]);
  });

  it('no heads → everything is prelude', () => {
    const log = [mk('a', '1'), mk('b', '2')];
    const { frames, prelude } = bucketByAnchors(log, []);
    expect(frames).toEqual([]);
    expect(prelude).toEqual(['1', '2']);
  });
});

describe('unit — findLoopHeads', () => {
  it('one head per injection-engine ENTRY (not per injection-engine commit)', () => {
    const log = [
      mk('seed', 'seed#0'),
      mk('sf-injection-engine/a', 'ie-a#1'), // head (entry)
      mk('sf-injection-engine/b', 'ie-b#2'), // same entry — NOT a head
      mk('call-llm', 'call-llm#3'),
      mk('sf-injection-engine/a', 'ie-a#4'), // head (new entry after leaving)
      mk('call-llm', 'call-llm#5'),
    ];
    expect(findLoopHeads(log)).toEqual(['ie-a#1', 'ie-a#4']);
  });

  it('grouped chart (no injection-engine entries) → no heads', () => {
    const log = [mk('seed', 'seed#0'), mk('sf-llm-call/call-llm', 'sf-llm-call/call-llm#1')];
    expect(findLoopHeads(log)).toEqual([]);
  });
});

// ─── 2. FUNCTIONAL — a real-shaped 3-loop flat log ───────────────────
describe('functional — flat-agent 3-loop log', () => {
  it('finds 3 heads and 3 frames, each body carrying its OWN route + tool-calls', () => {
    const log = flatAgentLog(3);
    const heads = findLoopHeads(log);
    expect(heads.length).toBe(3);
    const { frames, prelude } = bucketByAnchors(log, heads);
    expect(prelude).toEqual(['seed#0', 'sf-memory-read/get#1']); // run setup, not a loop
    expect(frames.length).toBe(3);
    for (const f of frames) {
      const locals = f.bodyIds.map((id) => id.split('#')[0].split('/').pop());
      // each round's body ends with its OWN route + tool-calls (the mis-bucketing the
      // proposal fixed: call-llm-bounded ranges would steal these into the next round)
      expect(locals).toEqual(['resolve', 'context', 'call-llm', 'route', 'tool-calls']);
    }
  });
});

// ─── 3. PROPERTY — totality ──────────────────────────────────────────
describe('property — totality (every commit in exactly one frame OR prelude)', () => {
  it('prelude ∪ all bodyIds reconstruct the log in order, no dup/drop — fuzzed', () => {
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + (trial % 40);
      const log = Array.from({ length: n }, (_, i) => mk(`s${i % 5}`, `r${i}`));
      // random head set (arbitrary, possibly out-of-order, possibly dup, possibly absent)
      const heads: string[] = [];
      for (let i = 0; i < n; i++) if ((i * 7 + trial) % 3 === 0) heads.push(`r${i}`);
      if (trial % 11 === 0) heads.push('not-in-log'); // absent head ignored
      const { frames, prelude } = bucketByAnchors(log, heads);
      const reconstructed = [...prelude, ...frames.flatMap((f) => f.bodyIds)];
      expect(reconstructed).toEqual(log.map((b) => b.runtimeStageId)); // order + totality
      // frames are contiguous, head-first
      for (const f of frames) expect(f.bodyIds[0]).toBe(log[f.headArrayIdx].runtimeStageId);
    }
  });
});

// ─── 4. SECURITY / robustness ────────────────────────────────────────
describe('security & robustness', () => {
  it('empty log → empty frames + empty prelude', () => {
    expect(bucketByAnchors([], ['x'])).toEqual({ frames: [], prelude: [] });
  });
  it('an out-of-order / duplicate head list cannot reorder or duplicate commits', () => {
    const log = [mk('h', 'a'), mk('x', 'b'), mk('h', 'c')];
    const { frames, prelude } = bucketByAnchors(log, ['c', 'a', 'a', 'c']); // reversed + dup
    expect(prelude).toEqual([]); // first head is at index 0
    expect(frames.map((f) => f.headArrayIdx)).toEqual([0, 2]); // log order, deduped
    expect([...prelude, ...frames.flatMap((f) => f.bodyIds)]).toEqual(['a', 'b', 'c']);
  });
  it('a head runtimeStageId repeated in the LOG anchors ONE frame (real fork-merge shape)', () => {
    // a single stage execution can flush >1 commit under one runtimeStageId — the
    // repeat must stay INSIDE the frame it opened, not spawn a spurious second frame.
    const log = [
      mk('seed', 'seed#0'),
      mk('sf-injection-engine', 'sf-injection-engine#1'), // HEAD (1st flush)
      mk('sf-injection-engine', 'sf-injection-engine#1'), // SAME id, 2nd flush — not a new head
      mk('context', 'context#6'),
      mk('call-llm', 'call-llm#18'),
      mk('sf-injection-engine', 'sf-injection-engine#23'), // next loop's HEAD
      mk('call-llm', 'call-llm#40'),
    ];
    const heads = findLoopHeads(log);
    expect(heads).toEqual(['sf-injection-engine#1', 'sf-injection-engine#23']);
    const { frames, prelude } = bucketByAnchors(log, heads);
    expect(prelude).toEqual(['seed#0']);
    expect(frames.length).toBe(2); // ONE frame per loop, not one per duplicate commit
    expect(frames[0].bodyIds).toEqual([
      'sf-injection-engine#1',
      'sf-injection-engine#1',
      'context#6',
      'call-llm#18',
    ]);
    // totality preserved across duplicate-id heads
    expect([...prelude, ...frames.flatMap((f) => f.bodyIds)]).toEqual(log.map((b) => b.runtimeStageId));
  });
  it('observe re-export is the same function', () => {
    expect(viaObserve).toBe(bucketByAnchors);
  });
});

// ─── 5. PERFORMANCE + 6. LOAD ────────────────────────────────────────
describe('performance & load', () => {
  it('a 50-loop log assembles in a single linear pass, promptly', () => {
    const log = flatAgentLog(50);
    const t0 = performance.now();
    const heads = findLoopHeads(log);
    const { frames } = bucketByAnchors(log, heads);
    expect(frames.length).toBe(50);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// assembleTrajectory — the agent-flavored projection (phase 2)
// ═══════════════════════════════════════════════════════════════════════

/** A synthetic ContextBugArtifacts wrapping just a commit log + (optional) tree. */
function artifactsOf(
  commitLog: readonly CommitBundle[],
  executionTree?: unknown,
): ContextBugArtifacts {
  return { snapshot: { commitLog, executionTree } } as unknown as ContextBugArtifacts;
}

// ─── 7. INTEGRATION — a REAL flat-agent run, end to end ──────────────
describe('integration — assembleTrajectory over a real flat-agent run', () => {
  /** Build a flat agent whose mock LLM does 2 tool turns then a final answer → 3 loops. */
  async function runThreeLoopAgent() {
    const echo = defineTool({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => 'echoed',
    });
    let calls = 0;
    const provider = mock({
      chunkDelayMs: 0,
      respond: () => {
        calls++;
        if (calls <= 2)
          return {
            content: `step ${calls}`,
            toolCalls: [{ id: `c${calls}`, name: 'echo', args: {} }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
        return { content: 'final answer', toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'end_turn' };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', readTracking: 'full' })
      .system('test')
      .tool(echo)
      .build();
    await agent.run({ message: 'go' });
    return agent.getSnapshot()!;
  }

  it('segments the run into one frame per ReAct iteration, each pointing at its call-llm', async () => {
    const snapshot = await runThreeLoopAgent();
    const traj = assembleTrajectory(artifactsOf(snapshot.commitLog!, snapshot.executionTree));

    expect(traj.frames.length).toBe(3); // 2 tool turns + 1 final
    expect(traj.honestyFlags).toEqual([]); // flat chart — not grouped, nothing degraded
    expect(traj.prelude.length).toBeGreaterThan(0); // seed / memory-read precede the first loop

    traj.frames.forEach((frame, i) => {
      expect(frame.loopIndex).toBe(i);
      // each frame points at a real call-llm execution inside its own body
      expect(frame.llmCallId).toBeDefined();
      expect(frame.llmCallId!.split('#')[0].split('/').pop()).toBe('call-llm');
      expect(frame.bodyIds).toContain(frame.llmCallId);
      expect(frame.llmCallArrayIdx).toBeGreaterThanOrEqual(frame.headArrayIdx);
    });

    // the call-llm pointers are distinct executions, in commit order
    const idxs = traj.frames.map((f) => f.llmCallArrayIdx!);
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
    expect(new Set(idxs).size).toBe(3);
  });

  it('captures the live contextSources that fed each call-llm (findLastWriter + commitValueAt)', async () => {
    const snapshot = await runThreeLoopAgent();
    const traj = assembleTrajectory(artifactsOf(snapshot.commitLog!, snapshot.executionTree));

    const f0 = traj.frames[0];
    // the LLM read real state keys this run
    expect(f0.contextSources.length).toBeGreaterThan(0);
    const keys = f0.contextSources.map((s) => s.key);
    expect(keys).toContain('systemPromptInjections'); // the system-prompt slot

    // at least one source resolved to a prior writer with a materialized value + evidence
    const resolved = f0.contextSources.filter((s) => s.writerId !== undefined);
    expect(resolved.length).toBeGreaterThan(0);
    for (const s of resolved) {
      expect(s.writerArrayIdx).toBeDefined();
      expect(s.writerArrayIdx!).toBeLessThan(f0.llmCallArrayIdx!); // EXCLUSIVE — prior writer, not the write-back
      expect(s.evidence.id).toBe(`${f0.llmCallId}::${s.key}`);
      expect(s.evidence.ancestorTexts).toEqual([]);
    }

    // intermediate text reflects what the step produced
    expect(typeof f0.intermediateText === 'string' || f0.intermediateText === undefined).toBe(true);
  });

  it('the observe barrel re-exports the same assembler', () => {
    expect(assembleViaObserve).toBe(assembleTrajectory);
  });
});

// ─── 8. UNIT / EDGE — degenerate + degrade-never-throw ───────────────
describe('unit — assembleTrajectory edge cases', () => {
  it('empty run → empty frames, empty prelude, no honesty flags', () => {
    const traj = assembleTrajectory(artifactsOf([], undefined));
    expect(traj.frames).toEqual([]);
    expect(traj.prelude).toEqual([]);
    expect(traj.honestyFlags).toEqual([]);
    expect(traj.truncated).toBeUndefined();
  });

  it('grouped chart (sf-llm-call) is DETECTED and degraded with an honesty flag, never mis-bucketed', () => {
    const log = [mk('seed', 'seed#0'), mk('sf-llm-call/call-llm', 'sf-llm-call/call-llm#1')];
    const traj = assembleTrajectory(artifactsOf(log, undefined));
    // findLoopHeads sees no injection-engine entry → no frames, all prelude
    expect(traj.frames).toEqual([]);
    expect(traj.prelude).toEqual(['seed#0', 'sf-llm-call/call-llm#1']);
    expect(traj.honestyFlags.map((f) => f.flag)).toContain('untracked-sources');
  });

  it('maxFrames truncates and flags it', () => {
    const log = flatAgentLog(4);
    const traj = assembleTrajectory(artifactsOf(log, undefined), { maxFrames: 2 });
    expect(traj.frames.length).toBe(2);
    expect(traj.truncated).toEqual({ byFrames: true });
    expect(traj.frames.map((f) => f.loopIndex)).toEqual([0, 1]);
  });

  it('maxFrames at or above frame count does not flag truncation', () => {
    const log = flatAgentLog(3);
    const traj = assembleTrajectory(artifactsOf(log, undefined), { maxFrames: 3 });
    expect(traj.frames.length).toBe(3);
    expect(traj.truncated).toBeUndefined();
  });

  it('a flat synthetic log with no read-tracking → frames present, contextSources empty (honest blank)', () => {
    const log = flatAgentLog(2);
    const traj = assembleTrajectory(artifactsOf(log, undefined));
    expect(traj.frames.length).toBe(2);
    for (const f of traj.frames) {
      expect(f.llmCallId!.split('#')[0]).toBe('call-llm');
      expect(f.contextSources).toEqual([]); // no executionTree → no reads → no sources (not a throw)
      expect(f.untrackedReadsPresent).toBe(false);
    }
  });
});

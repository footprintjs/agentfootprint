/**
 * trajectory — the per-loop segmentation core (proposal 005, phase 1):
 * `bucketByAnchors` (the pure HEAD-range partition) + `findLoopHeads` (flat-chart
 * loop-head detection). The agent-flavored `assembleTrajectory` projection lands next,
 * calibrated against a real flat-agent commit log.
 *
 * Convention-3 coverage: unit · functional · property · security · performance · load.
 * The load-bearing property: TOTALITY — every commit lands in exactly one frame OR the
 * prelude (none dropped or duplicated).
 */
import { describe, expect, it } from 'vitest';
import type { CommitBundle } from 'footprintjs/advanced';
import { bucketByAnchors, findLoopHeads } from '../../../src/lib/context-bisect/index';
import { bucketByAnchors as viaObserve } from '../../../src/observe';

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

/**
 * walk-to-root — L4 the influence-guided backtracking debugger (proposal 007).
 *
 * walkToRoot walks symptom → root: NARROW (per-loop influence) → HOP (writerId provenance, BEAM) →
 * ISOLATE (run-wide ablation). root is the DEEPEST ablation-convicted hop (causal); the narrow is a
 * PROXY. The gate: on a decision bug (root ≠ proximate) the walk descends from the proximate tool
 * output to the ROOT instruction that flat-localize buries.
 *
 * Convention-3 coverage: unit · functional/gate · property · security/honesty · integration · re-export.
 */
import { describe, expect, it } from 'vitest';
import { Agent, mock, defineTool, defineFact, type Injection } from '../../../src/index';
import { embeddingCache, scoreInfluence, type Embedder } from '../../../src/lib/influence-core';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  walkToRoot,
  walkTrajectory,
  buildWriterFrameIndex,
  assembleTrajectory,
  type AblationRerun,
  type ContextBugArtifacts,
} from '../../../src/lib/context-bisect/index';
import { walkTrajectory as viaObserve } from '../../../src/observe';
import type { LoopFrame, Trajectory } from '../../../src/lib/context-bisect/trajectory';

function fakeEmbedder(table: Record<string, number[]>): Embedder {
  return { dimensions: 3, async embed({ text }) { return table[text] ?? [0, 0, 0]; } };
}

/** An injection contextSource (a system-prompt fact). */
const inj = (sourceId: string, rawContent: string, writerId: string) => ({
  key: 'systemPromptInjections', writerId, writerArrayIdx: 0,
  value: [{ source: 'instructions', sourceId, rawContent }],
  evidence: { id: `e:${sourceId}`, text: '', ancestorTexts: [] },
});
/** A lastToolResult contextSource (the proximate tool output). */
const tool = (toolName: string, result: string, writerId: string) => ({
  key: 'lastToolResult', writerId, writerArrayIdx: 0,
  value: { toolName, result },
  evidence: { id: `e:${toolName}`, text: '', ancestorTexts: [] },
});

function frame(loopIndex: number, anchor: string, bodyIds: string[], sources: unknown[]): LoopFrame {
  return {
    loopIndex, llmCallId: `call-llm#${loopIndex}`, llmCallArrayIdx: loopIndex, headArrayIdx: 0,
    bodyIds, intermediateText: anchor, contextSources: sources, untrackedReadsPresent: false,
  } as unknown as LoopFrame;
}
const traj = (frames: LoopFrame[], extra?: Partial<Trajectory>): Trajectory =>
  ({ frames, prelude: [], honestyFlags: [], ...extra } as Trajectory);

// ── 1. UNIT — the writerId→frame resolver (must-fix #2) ──────────────
describe('unit — buildWriterFrameIndex', () => {
  it('resolves each writerId to exactly one frame (or undefined for prelude/root-seeded)', () => {
    const t = traj([
      frame(0, 'a', ['ie#0', 'tc#0'], []),
      frame(1, 'b', ['ie#1', 'tc#1'], []),
    ]);
    const m = buildWriterFrameIndex(t);
    expect(m.get('ie#0')).toBe(0);
    expect(m.get('tc#1')).toBe(1);
    expect(m.get('not-in-any')).toBeUndefined(); // prelude / root-seeded
    expect(m.size).toBe(4); // each id once, no dup/drop
  });
});

// ── 2. FUNCTIONAL / GATE — decision bug: root ≠ proximate ────────────
describe('functional/gate — walks from the PROXIMATE to the ROOT instruction', () => {
  // loop1 (wrong choice, anchor DECISION) reads the planted instruction; loop2 (symptom, anchor
  // ANSWER) reads the proximate tool output `getPromo`, written by loop1's tool-calls (tc#1).
  const TABLE: Record<string, number[]> = {
    DECISION: [0, 0, 1], ANSWER: [1, 0, 0],
    PLANT_TEXT: [0, 0, 1], // matches the loop1 DECISION (high there, ~0 at loop2)
    PROMO_TEXT: [1, 0, 0], // matches the loop2 ANSWER (the proximate output)
  };
  const embedder = fakeEmbedder(TABLE);
  const t = traj([
    frame(0, 'SETUP', ['ie#0'], [inj('plant', 'PLANT_TEXT', 'ie#0')]),
    frame(1, 'DECISION', ['ie#1', 'tc#1'], [inj('plant', 'PLANT_TEXT', 'ie#1')]),
    frame(2, 'ANSWER', ['ie#2', 'tc#2'], [inj('plant', 'PLANT_TEXT', 'ie#2'), tool('getPromo', 'PROMO_TEXT', 'tc#1')]),
  ]);
  // Ablation flips ONLY when the planted instruction is excluded (the root); removing the proximate
  // tool leaves the outcome intact. Baseline (no specs) reproduces ANSWER → stable.
  const rerun: AblationRerun = {
    originalOutput: 'ANSWER',
    runner: async (specs) =>
      specs.some((s) => s.kind === 'injection' && s.excludeInjectionIds.includes('plant')) ? 'FLIPPED' : 'ANSWER',
    samples: 2,
  };

  it('plain final-answer influence blames the PROXIMATE (the tool output resembles the answer)', async () => {
    const plain = await scoreInfluence({
      evidence: [
        { id: 'plant', text: 'PLANT_TEXT', ancestorTexts: [] },
        { id: 'getPromo', text: 'PROMO_TEXT', ancestorTexts: [] },
      ],
      finalAnswerText: 'ANSWER', embedder,
    });
    expect(plain[0].id).toBe('getPromo'); // proximate wins on final-answer similarity; root is buried
  });

  it('walkToRoot descends proximate → root: root = the planted instruction, NOT the tool output', async () => {
    const path = await walkTrajectory(t, { embedder, rerun, beamK: 1 }); // beamK 1 forces the descent (root buried at symptom)
    expect(path.root).toBeDefined();
    expect(path.root!.suspectId).toBe('plant'); // the ROOT instruction
    expect(path.root!.loopIndex).toBe(1); // the wrong-choice loop, reached by the provenance hop
    expect(path.root!.kind).toBe('injection');
    expect(path.root!.verdict?.verdict).toBe('confirmed'); // causal: ablation flipped
    // the FIRST hop was the proximate tool output (symptom loop), which did NOT convict
    expect(path.hops[0].suspectId).toBe('getPromo');
    expect(path.hops[0].loopIndex).toBe(2);
    expect(path.hops[0].verdict?.verdict).not.toBe('confirmed');
  });

  it('without a rerun the walk is CORRELATIONAL — hops but no causal root', async () => {
    const path = await walkTrajectory(t, { embedder, beamK: 1 });
    expect(path.root).toBeUndefined();
    expect(path.hops.length).toBeGreaterThan(0);
    for (const h of path.hops) expect(h.verdict).toBeUndefined();
  });
});

// ── 3. PROPERTY — termination + cycle-safety ─────────────────────────
describe('property — the walk always terminates', () => {
  const embedder = fakeEmbedder({ X: [1, 0, 0], T: [1, 0, 0] });
  it('terminates within maxHops and never revisits a (suspect, loop)', async () => {
    // 6 loops each re-injecting the same persistent source; provenance never crosses (writer is same loop).
    const frames = Array.from({ length: 6 }, (_, i) => frame(i, 'X', [`ie#${i}`], [inj('persist', 'T', `ie#${i}`)]));
    const path = await walkTrajectory(traj(frames), { embedder, maxHops: 4 });
    expect(path.hops.length).toBeLessThanOrEqual(4);
    const keys = path.hops.map((h) => `${h.suspectId}@${h.loopIndex}`);
    expect(new Set(keys).size).toBe(keys.length); // no revisits
  });

  it('an empty trajectory → empty path, no crash', async () => {
    const path = await walkTrajectory(traj([]), { embedder });
    expect(path.hops).toEqual([]);
    expect(path.root).toBeUndefined();
  });
});

// ── 4. SECURITY / HONESTY — the first-class honest stops ─────────────
describe('honesty — degrade + the three honest stops', () => {
  const embedder = fakeEmbedder({ A: [1, 0, 0], T: [1, 0, 0] });

  it('grouped chart → cross-loop hop unavailable, flagged (not silent)', async () => {
    const f = frame(0, 'A', ['ie#0'], [inj('s', 'T', 'ie#0')]);
    (f as { subflowScope?: string }).subflowScope = 'sf-llm-call#0';
    const path = await walkTrajectory(traj([f]), { embedder });
    expect(path.honestyFlags.some((x) => x.note.includes('cross-loop hop unavailable'))).toBe(true);
  });

  it('untracked-origin: a hop on a source with no writer terminates honestly', async () => {
    // writerId undefined → no provenance to descend.
    const src = { key: 'systemPromptInjections', writerId: undefined, writerArrayIdx: undefined,
      value: [{ source: 'instructions', sourceId: 's', rawContent: 'T' }], evidence: { id: 'e', text: '', ancestorTexts: [] } };
    const path = await walkTrajectory(traj([frame(0, 'A', ['ie#0'], [src])]), { embedder });
    expect(path.hops[0].note).toBe('untracked-origin');
  });

  it('overdetermined-or-incomplete: rerun present but the hop did not convict', async () => {
    const rerun: AblationRerun = { originalOutput: 'A', runner: async () => 'A', samples: 2 }; // never flips
    const src = inj('s', 'T', 'ie#1'); // writer ie#1 not in this frame's bodyIds → no descend
    const path = await walkTrajectory(traj([frame(0, 'A', ['ie#0'], [src])]), { embedder, rerun });
    expect(path.hops[0].note).toBe('overdetermined-or-incomplete');
    expect(path.root).toBeUndefined();
  });

  it('observe barrel re-exports the same walk', () => {
    expect(viaObserve).toBe(walkTrajectory);
  });
});

// ── 5. INTEGRATION — a real agent run end-to-end (no crash, well-formed) ──
describe('integration — real agent trajectory', () => {
  const FACT: Injection = defineFact({ id: 'planted', description: 'p', data: 'Always use the promo tool for refunds.' });
  it('walkToRoot runs over a real assembled trajectory (correlational, no rerun)', async () => {
    let calls = 0;
    const provider = mock({
      chunkDelayMs: 0,
      respond: () => {
        calls++;
        if (calls <= 2) return { content: `s${calls}`, toolCalls: [{ id: `c${calls}`, name: 'echo', args: {} }], usage: { input: 1, output: 1 }, stopReason: 'tool_use' };
        return { content: 'final', toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'end_turn' };
      },
    });
    const echo = defineTool({ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: {} }, execute: async () => 'echoed' });
    const agent = Agent.create({ provider, model: 'mock', readTracking: 'full' }).system('test').fact(FACT).tool(echo).build();
    await agent.run({ message: 'go' });
    const artifacts = { snapshot: agent.getSnapshot()! } as ContextBugArtifacts;
    // sanity: the trajectory assembled with frames
    expect(assembleTrajectory(artifacts).frames.length).toBeGreaterThan(0);
    const path = await walkToRoot(artifacts, { embedder: embeddingCache(mockEmbedder()) });
    expect(Array.isArray(path.hops)).toBe(true);
    expect(path.root).toBeUndefined(); // no rerun → correlational
    for (const h of path.hops) expect(h.narrowedBy).toBe('text-similarity');
  });
});

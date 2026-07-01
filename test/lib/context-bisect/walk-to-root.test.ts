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
import { Agent, defineTool } from '../../../src/index'
import { type Injection } from '../../../src/injection-engine.js'
import { mock } from '../../../src/llm-providers.js'
import { defineFact } from '../../../src/injection-engine.js';
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
  return {
    dimensions: 3,
    async embed({ text }) {
      return table[text] ?? [0, 0, 0];
    },
  };
}

/** An injection contextSource (a system-prompt fact). */
const inj = (sourceId: string, rawContent: string, writerId: string) => ({
  key: 'systemPromptInjections',
  writerId,
  writerArrayIdx: 0,
  value: [{ source: 'instructions', sourceId, rawContent }],
  evidence: { id: `e:${sourceId}`, text: '', ancestorTexts: [] },
});
function frame(
  loopIndex: number,
  anchor: string,
  bodyIds: string[],
  sources: unknown[],
): LoopFrame {
  return {
    loopIndex,
    llmCallId: `call-llm#${loopIndex}`,
    llmCallArrayIdx: loopIndex,
    headArrayIdx: 0,
    bodyIds,
    intermediateText: anchor,
    contextSources: sources,
    untrackedReadsPresent: false,
  } as unknown as LoopFrame;
}
/** Attach the WALK-ONLY proximate tool source (the L4 descent edge — NOT a contextSource). */
const withProxTool = (
  f: LoopFrame,
  toolName: string,
  result: string,
  writerId: string,
): LoopFrame =>
  ({
    ...f,
    proximateToolSource: { value: { toolName, result }, writerId, proximate: true },
  } as unknown as LoopFrame);
const traj = (frames: LoopFrame[], extra?: Partial<Trajectory>): Trajectory =>
  ({ frames, prelude: [], honestyFlags: [], ...extra } as Trajectory);

// ── 1. UNIT — the writerId→frame resolver (must-fix #2) ──────────────
describe('unit — buildWriterFrameIndex', () => {
  it('resolves each writerId to exactly one frame (or undefined for prelude/root-seeded)', () => {
    const t = traj([frame(0, 'a', ['ie#0', 'tc#0'], []), frame(1, 'b', ['ie#1', 'tc#1'], [])]);
    const m = buildWriterFrameIndex(t);
    expect(m.get('ie#0')).toBe(0);
    expect(m.get('tc#1')).toBe(1);
    expect(m.get('not-in-any')).toBeUndefined(); // prelude / root-seeded
    expect(m.size).toBe(4); // each id once, no dup/drop
  });
});

// ── 2. FUNCTIONAL / GATE — decision bug: root ≠ proximate (via the WALK-ONLY tool edge) ──
describe('functional/gate — walks from the PROXIMATE to the ROOT instruction', () => {
  // loop1 (wrong choice, anchor DECISION) reads the planted instruction (scores high there).
  // loop2 (symptom, anchor ANSWER): the plant is BURIED (PLANT_TEXT ⊥ ANSWER) under an innocent
  // (ANSWER_TEXT). The proximate tool `getPromo` (written by loop1's tool-calls tc#1) is the
  // WALK-ONLY descent edge (proposal 008) — not a contextSource, so L3 never scored it.
  const TABLE: Record<string, number[]> = {
    DECISION: [0, 0, 1],
    ANSWER: [1, 0, 0],
    PLANT_TEXT: [0, 0, 1], // matches loop1 DECISION (high there, ⊥ ANSWER at loop2 → buried)
    ANSWER_TEXT: [1, 0, 0], // the innocent + the proximate output (resemble the final ANSWER)
  };
  const embedder = fakeEmbedder(TABLE);
  const t = traj([
    frame(0, 'SETUP', ['ie#0'], [inj('plant', 'PLANT_TEXT', 'ie#0')]),
    frame(1, 'DECISION', ['ie#1', 'tc#1'], [inj('plant', 'PLANT_TEXT', 'ie#1')]),
    withProxTool(
      frame(
        2,
        'ANSWER',
        ['ie#2', 'tc#2'],
        [inj('plant', 'PLANT_TEXT', 'ie#2'), inj('innocent', 'ANSWER_TEXT', 'ie#2')],
      ),
      'getPromo',
      'ANSWER_TEXT',
      'tc#1', // proximate tool output, written by loop1's tool-calls
    ),
  ]);
  // Ablation flips ONLY when the planted instruction is excluded (the root); removing the innocent or
  // the proximate tool leaves the outcome intact. Baseline (no specs) reproduces ANSWER → stable.
  const rerun: AblationRerun = {
    originalOutput: 'ANSWER',
    runner: async (specs) =>
      specs.some((s) => s.kind === 'injection' && s.excludeInjectionIds.includes('plant'))
        ? 'FLIPPED'
        : 'ANSWER',
    samples: 2,
  };

  it('plain final-answer influence blames the PROXIMATE (the tool output resembles the answer)', async () => {
    const plain = await scoreInfluence({
      evidence: [
        { id: 'plant', text: 'PLANT_TEXT', ancestorTexts: [] },
        { id: 'getPromo', text: 'ANSWER_TEXT', ancestorTexts: [] },
      ],
      finalAnswerText: 'ANSWER',
      embedder,
    });
    expect(plain[0].id).toBe('getPromo'); // proximate wins on final-answer similarity; root is buried
  });

  it('walkToRoot descends via the walk-only tool edge to root = the planted instruction', async () => {
    const path = await walkTrajectory(t, { embedder, rerun, beamK: 1 });
    expect(path.root).toBeDefined();
    expect(path.root!.suspectId).toBe('plant'); // the ROOT instruction (NOT getPromo, NOT innocent)
    expect(path.root!.loopIndex).toBe(1); // the wrong-choice loop, reached by the provenance hop
    expect(path.root!.kind).toBe('injection');
    expect(path.root!.verdict?.verdict).toBe('confirmed'); // causal: ablation flipped
    // the symptom hop descended via the walk-only proximate tool edge (getPromo → loop 1)
    expect(path.hops[0].loopIndex).toBe(2);
    expect(path.hops[0].suspectId).toBe('getPromo');
    expect(path.hops[0].cameFrom).toBe(1);
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
    const frames = Array.from({ length: 6 }, (_, i) =>
      frame(i, 'X', [`ie#${i}`], [inj('persist', 'T', `ie#${i}`)]),
    );
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
    const src = {
      key: 'systemPromptInjections',
      writerId: undefined,
      writerArrayIdx: undefined,
      value: [{ source: 'instructions', sourceId: 's', rawContent: 'T' }],
      evidence: { id: 'e', text: '', ancestorTexts: [] },
    };
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
  const FACT: Injection = defineFact({
    id: 'planted',
    description: 'p',
    data: 'Always use the promo tool for refunds.',
  });
  it('walkToRoot runs over a real assembled trajectory (correlational, no rerun)', async () => {
    let calls = 0;
    const provider = mock({
      chunkDelayMs: 0,
      respond: () => {
        calls++;
        if (calls <= 2)
          return {
            content: `s${calls}`,
            toolCalls: [{ id: `c${calls}`, name: 'echo', args: {} }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
        return {
          content: 'final',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'end_turn',
        };
      },
    });
    const echo = defineTool({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => 'echoed',
    });
    const agent = Agent.create({ provider, model: 'mock', readTracking: 'full' })
      .system('test')
      .fact(FACT)
      .tool(echo)
      .build();
    await agent.run({ message: 'go' });
    const artifacts = { snapshot: agent.getSnapshot()! } as ContextBugArtifacts;
    // sanity: the trajectory assembled with frames
    expect(assembleTrajectory(artifacts).frames.length).toBeGreaterThan(0);
    const path = await walkToRoot(artifacts, { embedder: embeddingCache(mockEmbedder()) });
    expect(Array.isArray(path.hops)).toBe(true);
    expect(path.root).toBeUndefined(); // no rerun → correlational
    for (const h of path.hops) expect(h.narrowedBy).toBe('text-similarity');
  });

  it('ENRICHMENT (proposal 008): assembleTrajectory surfaces a proximate tool source with a CROSS-LOOP writer', async () => {
    let calls = 0;
    const provider = mock({
      chunkDelayMs: 0,
      respond: () => {
        calls++;
        if (calls <= 2)
          return {
            content: `s${calls}`,
            toolCalls: [{ id: `c${calls}`, name: 'echo', args: {} }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
        return {
          content: 'final',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'end_turn',
        };
      },
    });
    const echo = defineTool({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => 'echoed',
    });
    const agent = Agent.create({ provider, model: 'mock', readTracking: 'full' })
      .system('test')
      .tool(echo)
      .build();
    await agent.run({ message: 'go' });
    const t = assembleTrajectory({ snapshot: agent.getSnapshot()! } as ContextBugArtifacts);

    // a later loop carries a proximate tool source whose writer is an EARLIER loop's tool-calls stage
    const withTool = t.frames.find((f) => f.proximateToolSource !== undefined);
    expect(withTool).toBeDefined();
    const prox = withTool!.proximateToolSource!;
    expect(prox.proximate).toBe(true); // honest: inferred, not a direct call-llm read
    expect(prox.writerId!.split('#')[0].split('/').pop()).toBe('tool-calls'); // the producing stage
    expect((prox.value as { toolName?: string }).toolName).toBe('echo');
    // it is WALK-ONLY: NOT in contextSources (L3's narrow never sees it)
    expect(withTool!.contextSources.some((s) => s.key === 'lastToolResult')).toBe(false);
  });

  it('L3 UNCHANGED (walk-only): shortlistEarlyCulprits surfaces NO tool suspect from the proximate source', async () => {
    // a frame WITH a proximateToolSource but the tool is NOT in contextSources → L3 ignores it.
    const f = withProxTool(
      frame(0, 'X', ['ie#0'], [inj('s', 'T', 'ie#0')]),
      'someTool',
      'R',
      'tc#9',
    );
    const sl = await import('../../../src/lib/context-bisect/index').then((m) =>
      m.shortlistEarlyCulprits(traj([f]), {
        embedder: fakeEmbedder({ X: [1, 0, 0], T: [1, 0, 0] }),
      }),
    );
    expect(sl.candidates.map((c) => c.suspectId)).toEqual(['s']); // only the injection — NOT 'someTool'
  });
});

/**
 * loop-recall — L3 per-loop RECALL shortlist (proposal 006).
 *
 * shortlistEarlyCulprits aggregates PER-LOOP influence with a recency weight
 * (`recencyDecay^(lastLoop − N)`) and ranks for recall — a booster that NARROWS before ablation,
 * NOT a #1 ranker. The win over plain final-answer influence is the per-loop signal: a source is
 * scored against the loop it actually fed, surfacing culprits the final answer buries. Joins 1:1
 * with a localizer Suspect via suspectId.
 *
 * The recency (backward) mechanism is the H2-VALIDATED one — the recall@k gate measured it against
 * a forward-eligibility variant and the forward one FAILED (see the ctxbug head-to-head). These
 * tests pin the SHIPPED mechanism.
 *
 * Convention-3 coverage: unit · functional · property · integration · security · perf/load.
 */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index'
import { type Injection } from '../../../src/injection-engine.js'
import { mock } from '../../../src/llm-providers.js'
import { defineFact } from '../../../src/injection-engine.js';
import { embeddingCache, scoreInfluence, type Embedder } from '../../../src/lib/influence-core';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  assembleTrajectory,
  shortlistEarlyCulprits,
  localizeContextBug,
  type ContextBugArtifacts,
  type LoopRecallShortlist,
} from '../../../src/lib/context-bisect/index';
import { shortlistEarlyCulprits as viaObserve } from '../../../src/observe';
import type { LoopFrame, Trajectory } from '../../../src/lib/context-bisect/trajectory';

/** Controllable embedder: each text → a fixed vector, so FA = cosine is engineered exactly. */
function fakeEmbedder(table: Record<string, number[]>): Embedder {
  return {
    dimensions: 3,
    async embed({ text }) {
      return table[text] ?? [0, 0, 0];
    },
  };
}

/** One synthetic loop frame whose systemPromptInjections holds the given suspects. */
function frame(
  loopIndex: number,
  anchor: string,
  injections: { id: string; content: string }[],
  untracked = false,
): LoopFrame {
  return {
    loopIndex,
    llmCallId: `call-llm#${loopIndex}`,
    llmCallArrayIdx: loopIndex,
    headArrayIdx: 0,
    bodyIds: [],
    intermediateText: anchor,
    contextSources: [
      {
        key: 'systemPromptInjections',
        writerId: 'w',
        writerArrayIdx: 0,
        value: injections.map((inj) => ({
          source: 'fact',
          sourceId: inj.id,
          rawContent: inj.content,
        })),
        evidence: { id: `e#${loopIndex}`, text: '', ancestorTexts: [] },
      },
    ],
    untrackedReadsPresent: untracked,
  } as unknown as LoopFrame;
}

const traj = (frames: LoopFrame[], extra?: Partial<Trajectory>): Trajectory =>
  ({ frames, prelude: [], honestyFlags: [], ...extra } as Trajectory);

// Orthogonal axes: a source matches exactly one loop's anchor.
const TABLE: Record<string, number[]> = {
  EARLY: [1, 0, 0],
  MID: [0, 1, 0],
  LATE: [0, 0, 1],
  matchMid: [0, 1, 0], // resembles the MID loop's output only
  matchLate: [0, 0, 1], // resembles the LATE/final output
  nothing: [0, 0, 0], // resembles no loop
};
const embedder = fakeEmbedder(TABLE);

// ─── 1. UNIT ─────────────────────────────────────────────────────────
describe('unit — shortlistEarlyCulprits', () => {
  it('one loop, one suspect → one candidate joinable by suspectId (recallScore normalized to 1)', async () => {
    const out = await shortlistEarlyCulprits(
      traj([frame(0, 'MID', [{ id: 'cul', content: 'matchMid' }])]),
      { embedder },
    );
    expect(out.candidates.length).toBe(1);
    expect(out.candidates[0].suspectId).toBe('cul'); // the classifier identity, NOT the slot key
    expect(out.candidates[0].kind).toBe('injection');
    expect(out.candidates[0].recallScore).toBe(1);
    expect(out.recencyDecay).toBe(0.5); // the validated default
  });

  it('empty trajectory → empty shortlist', async () => {
    expect((await shortlistEarlyCulprits(traj([]), { embedder })).candidates).toEqual([]);
  });
});

// ─── 2. FUNCTIONAL — the per-loop signal beats final-answer influence ─
describe('functional — surfaces a culprit the FINAL ANSWER buries', () => {
  // culprit resembles the MID loop's decision (not the final LATE answer); filler resembles nothing.
  const frames = [
    frame(0, 'EARLY', [
      { id: 'cul', content: 'matchMid' },
      { id: 'flr', content: 'nothing' },
    ]),
    frame(1, 'MID', [
      { id: 'cul', content: 'matchMid' },
      { id: 'flr', content: 'nothing' },
    ]),
    frame(2, 'LATE', [
      { id: 'cul', content: 'matchMid' },
      { id: 'flr', content: 'nothing' },
    ]),
  ];

  it('PLAIN final-answer influence cannot distinguish them (both orthogonal to the final answer)', async () => {
    const plain = await scoreInfluence({
      evidence: [
        { id: 'cul', text: 'matchMid', ancestorTexts: [] },
        { id: 'flr', text: 'nothing', ancestorTexts: [] },
      ],
      finalAnswerText: 'LATE',
      embedder,
    });
    const byId = new Map(plain.map((s) => [s.id, s.score]));
    expect(Math.abs(byId.get('cul')! - byId.get('flr')!)).toBeLessThan(1e-9); // tie — plain misses the culprit
  });

  it('the per-loop shortlist RANKS the culprit #1 (caught in the loop it fed)', async () => {
    const out = await shortlistEarlyCulprits(traj(frames), { embedder });
    expect(out.candidates[0].suspectId).toBe('cul');
    const cul = out.candidates.find((c) => c.suspectId === 'cul')!;
    const flr = out.candidates.find((c) => c.suspectId === 'flr')!;
    expect(cul.eligibility).toBeGreaterThan(flr.eligibility);
  });
});

// ─── 3. PROPERTY — the recency-weighted aggregation ──────────────────
describe('property — recency-weighted sum invariants', () => {
  const threeLoop = [
    frame(0, 'MID', [{ id: 'cul', content: 'matchMid' }]),
    frame(1, 'MID', [{ id: 'cul', content: 'matchMid' }]),
    frame(2, 'MID', [{ id: 'cul', content: 'matchMid' }]),
  ];

  it('recencyDecay=1 ⇒ eligibility is the UNIFORM sum of the per-loop scores', async () => {
    const out = await shortlistEarlyCulprits(traj(threeLoop), { embedder, recencyDecay: 1 });
    const cul = out.candidates[0];
    expect(cul.eligibility).toBeCloseTo(
      cul.perLoop.reduce((a, p) => a + p.recallScore, 0),
      9,
    );
  });

  it('recencyDecay=0 ⇒ only the LAST loop counts', async () => {
    const out = await shortlistEarlyCulprits(traj(threeLoop), { embedder, recencyDecay: 0 });
    const cul = out.candidates[0];
    const last = cul.perLoop.find((p) => p.loopIndex === 2)!;
    expect(cul.eligibility).toBeCloseTo(last.recallScore, 9);
  });

  it('lower recencyDecay down-weights an EARLY-only source (recency emphasis)', async () => {
    // 'early' scores only at loop 0; a different source occupies loops 1-2.
    const f = [
      frame(0, 'MID', [{ id: 'early', content: 'matchMid' }]),
      frame(1, 'EARLY', [{ id: 'late', content: 'nothing' }]),
      frame(2, 'EARLY', [{ id: 'late', content: 'nothing' }]),
    ];
    const elig = async (rd: number) =>
      (await shortlistEarlyCulprits(traj(f), { embedder, recencyDecay: rd, k: 9 })).candidates.find(
        (c) => c.suspectId === 'early',
      )!.eligibility;
    const [e1, e05, e0] = [await elig(1), await elig(0.5), await elig(0)];
    expect(e1).toBeGreaterThan(e05); // uniform keeps full early weight
    expect(e05).toBeGreaterThan(e0); // recency fades it; at 0 the early-only source is gone
    expect(e0).toBeCloseTo(0, 9);
  });

  it('no double-count — a suspect present in N frames has exactly N per-loop entries', async () => {
    const out = await shortlistEarlyCulprits(traj(threeLoop), { embedder, recencyDecay: 0.7 });
    expect(out.candidates[0].perLoop.map((p) => p.loopIndex)).toEqual([0, 1, 2]);
  });

  it('deterministic + k-bounded', async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      frame(i, 'MID', [{ id: `s${i}`, content: 'matchMid' }]),
    );
    const a = await shortlistEarlyCulprits(traj(many), { embedder, k: 3 });
    const b = await shortlistEarlyCulprits(traj(many), { embedder, k: 3 });
    expect(a.candidates.length).toBe(3);
    expect(a.candidates.map((c) => c.suspectId)).toEqual(b.candidates.map((c) => c.suspectId));
  });
});

// ─── 4. SECURITY / robustness ────────────────────────────────────────
describe('security & robustness', () => {
  it('reads ONLY the trajectory — a redacted source value passes through, no crash', async () => {
    const out = await shortlistEarlyCulprits(
      traj([frame(0, 'MID', [{ id: 'cul', content: '[REDACTED]' }])]),
      { embedder },
    );
    expect(out.candidates[0].suspectId).toBe('cul'); // identity survives; content already scrubbed upstream
  });

  it('honesty: a frame with untracked reads flags the candidate incomplete', async () => {
    const out = await shortlistEarlyCulprits(
      traj([frame(0, 'MID', [{ id: 'cul', content: 'matchMid' }], true)]),
      { embedder },
    );
    expect(out.candidates[0].incomplete).toBe(true);
  });

  it('passes the trajectory honestyFlags through literally', async () => {
    const flags = [{ flag: 'untracked-sources' as const, note: 'x' }];
    const out = await shortlistEarlyCulprits(
      traj([frame(0, 'MID', [{ id: 'cul', content: 'matchMid' }])], { honestyFlags: flags }),
      { embedder },
    );
    expect(out.honestyFlags).toEqual(flags);
  });

  it('observe barrel re-exports the same function', () => {
    expect(viaObserve).toBe(shortlistEarlyCulprits);
  });
});

// ─── 5. PERFORMANCE / LOAD ───────────────────────────────────────────
describe('performance & load', () => {
  it('a 50-loop trajectory with 3 suspects/loop shortlists promptly', async () => {
    const frames = Array.from({ length: 50 }, (_, i) =>
      frame(i, 'MID', [
        { id: 'a', content: 'matchMid' },
        { id: 'b', content: 'matchLate' },
        { id: 'c', content: 'nothing' },
      ]),
    );
    const t0 = performance.now();
    const out = await shortlistEarlyCulprits(traj(frames), { embedder, k: 5 });
    expect(out.candidates.length).toBe(3);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

// ─── 6. INTEGRATION — real agent runs + localizeContextBug reorder ───
describe('integration — real agent trajectory + localizer narrowing', () => {
  const FACT_A: Injection = defineFact({
    id: 'fact-a',
    description: 'A',
    data: 'Alpha fact about refunds and policy windows.',
  });
  const FACT_B: Injection = defineFact({
    id: 'fact-b',
    description: 'B',
    data: 'Beta fact about VIP override tiers.',
  });

  async function runAgent(reactMode: 'dynamic' | 'dynamic-grouped') {
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
        return {
          content: 'final answer',
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
    const agent = Agent.create({ provider, model: 'mock', readTracking: 'full', reactMode })
      .system('test')
      .fact(FACT_A)
      .fact(FACT_B)
      .tool(echo)
      .build();
    await agent.run({ message: 'go' });
    return agent.getSnapshot()!;
  }

  it('FLAT: real run → assembleTrajectory → shortlist joins on the injection ids', async () => {
    const t = assembleTrajectory({ snapshot: await runAgent('dynamic') } as ContextBugArtifacts);
    const out = await shortlistEarlyCulprits(t, { embedder: embeddingCache(mockEmbedder()) });
    const ids = out.candidates.map((c) => c.suspectId);
    expect(ids).toContain('fact-a');
    expect(ids).toContain('fact-b');
    for (const c of out.candidates) expect(c.kind).toBe('injection');
  });

  it('GROUPED: real grouped run → per-scope shortlist still joins on the injection ids', async () => {
    const t = assembleTrajectory({
      snapshot: await runAgent('dynamic-grouped'),
    } as ContextBugArtifacts);
    const out = await shortlistEarlyCulprits(t, { embedder: embeddingCache(mockEmbedder()) });
    expect(out.candidates.map((c) => c.suspectId)).toEqual(
      expect.arrayContaining(['fact-a', 'fact-b']),
    );
  });

  it('localizeContextBug({shortlist}) REORDERS suspects (never drops) so the boosted suspect rises', async () => {
    const snapshot = await runAgent('dynamic');
    const artifacts = { snapshot } as ContextBugArtifacts;
    const emb = embeddingCache(mockEmbedder());
    const t = assembleTrajectory(artifacts);
    const atStep = t.frames[t.frames.length - 1]?.llmCallId;
    const base = await localizeContextBug({ artifacts, embedder: emb, atStep });
    const ablatable = base.suspects.filter((s) => s.detail?.injectionId !== undefined);
    if (ablatable.length < 2) return; // need ≥2 to observe a reorder
    const lastId = ablatable[ablatable.length - 1].detail!.injectionId!;
    const shortlist: LoopRecallShortlist = {
      candidates: [
        {
          suspectId: lastId,
          kind: 'injection',
          recallScore: 1,
          eligibility: 1,
          enteredLoop: 0,
          perLoop: [],
          incomplete: false,
        },
      ],
      k: 5,
      recencyDecay: 0.5,
      honestyFlags: [],
    };
    const reordered = await localizeContextBug({ artifacts, embedder: emb, atStep, shortlist });
    expect(reordered.suspects.length).toBe(base.suspects.length); // REORDER-only, no drop
    const idx = reordered.suspects.findIndex((s) => s.detail?.injectionId === lastId);
    const baseIdx = base.suspects.findIndex((s) => s.detail?.injectionId === lastId);
    expect(idx).toBeLessThanOrEqual(baseIdx);
  });
});

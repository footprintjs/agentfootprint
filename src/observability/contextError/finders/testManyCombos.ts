/**
 * testManyCombos — turns context pieces on and off in many combinations, re-runs each,
 * and learns which pieces drive the wrong answer (a linear-surrogate attribution), then
 * confirms the top candidate with one clean ablation. The sampling one: it estimates an
 * influence weight per piece from counterfactual data rather than ranking by similarity.
 *
 * Method: random-subset ablation + linear-surrogate attribution. Deterministic
 * pseudo-random masking (a reproducible reimplementation of ContextCite's random subsets).
 */
import type { Finder, FindInput, FindResult } from './types.js';

/** Deterministic LCG so the masking is reproducible across runs (and in tests). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export const testManyCombos: Finder = {
  name: 'testManyCombos',
  meta: {
    label: 'Turns pieces on/off in many combinations and learns which drive the answer',
    method: 'random-subset ablation + linear-surrogate attribution, then one confirming ablation',
    paper: 'ContextCite, Cohen-Wang et al. 2024 (arXiv:2409.00729)',
  },
  async find(input: FindInput): Promise<FindResult> {
    if (!input.rerun) throw new Error('testManyCombos needs input.rerun');
    const rerun = input.rerun;
    const ids = input.suspects.map((s) => s.id);
    if (ids.length === 0) {
      return {
        finder: 'testManyCombos',
        suspects: [],
        shortlist: [],
        evidence: 'guessed',
        granularity: 'piece',
        checks: 0,
        explanation: 'testManyCombos: no suspects to test.',
      };
    }
    const samples = Math.max(4, input.samples ?? Math.min(40, ids.length * 4));
    const rand = lcg(0x9e3779b9 ^ ids.length);
    // per-id recovery rate when the piece is removed vs kept
    const stat = new Map(ids.map((id) => [id, { remHits: 0, remN: 0, keepHits: 0, keepN: 0 }]));
    for (let k = 0; k < samples; k++) {
      const removed = ids.filter(() => rand() < 0.5);
      const removedSet = new Set(removed);
      const recovered = (await rerun(removed)).recovered ? 1 : 0;
      for (const id of ids) {
        const st = stat.get(id)!;
        if (removedSet.has(id)) {
          st.remHits += recovered;
          st.remN++;
        } else {
          st.keepHits += recovered;
          st.keepN++;
        }
      }
    }
    // coefficient = P(recover | removed) − P(recover | kept): high ⇒ removing it fixes the answer
    const scored = ids
      .map((id) => {
        const st = stat.get(id)!;
        const remMean = st.remN ? st.remHits / st.remN : 0;
        const keepMean = st.keepN ? st.keepHits / st.keepN : 0;
        return { id, score: remMean - keepMean };
      })
      .sort((a, b) => b.score - a.score);
    const lead = scored[0]?.id;
    // confirm the top candidate with one clean single-piece ablation
    let evidence: FindResult['evidence'] = 'guessed';
    let checks = samples;
    if (lead) {
      const r = await rerun([lead]);
      checks++;
      // 'proven' requires BOTH a positive learned contrast AND the lead flipping alone —
      // guards against a degenerate rerun that recovers for every subset (no real signal,
      // every score 0), which would otherwise falsely convict an arbitrary innocent.
      evidence = r.recovered && (scored[0]?.score ?? 0) > 0 ? 'proven' : 'guessed';
    }
    const cutoff = Math.max(0.25, (scored[0]?.score ?? 0) / 2);
    const shortlist = scored.filter((s) => s.score >= cutoff).map((s) => s.id);
    const explanation = [
      `testManyCombos: ran ${samples} random on/off combinations + 1 confirming check.`,
      `Strongest learned effect: ${lead ?? '(none)'} (removing it most increases recovery).`,
      evidence === 'proven'
        ? `Confirmed: removing ${lead} alone recovers the outcome.`
        : `The top candidate did not confirm alone — treat as a guess (possible over-determination).`,
    ].join('\n');
    return {
      finder: 'testManyCombos',
      suspects: scored,
      lead,
      shortlist: shortlist.length ? shortlist : lead ? [lead] : [],
      evidence,
      granularity: 'piece',
      checks,
      explanation,
    };
  },
};

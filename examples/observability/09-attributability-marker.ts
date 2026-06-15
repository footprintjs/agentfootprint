/**
 * 09 — rankingConfidence: the honesty marker on influence rankings (RFC-003).
 *
 * Output-similarity influence (`scoreInfluence`) ranks context sources by how
 * much they resemble the final answer. That is a strong proxy for CONTENT-driven
 * bugs (a misleading fact the answer echoes) — but it is structurally BLIND to
 * ABSENCE / CROWDING bugs: a culprit that broke things by *displacing* context
 * (history truncation, context dilution) need not resemble the answer at all, so
 * it ranks low — sometimes below an innocent the answer happens to discuss.
 *
 * `rankingConfidence` makes that honesty explicit. The tell is not a low
 * absolute score; it is a FLAT top — no source clearly dominates. When the
 * top-1 vs top-2 margin is below threshold, the ranking is reported
 * `clearWinner: false` with a SHORTLIST to confirm by ABLATION, instead of a
 * confident-but-wrong rank-1.
 *
 * This mirrors the causal slice's incompleteness markers: the library says what
 * its proxy cannot see, and points you at the causal tier (ablation) for the
 * truth.
 *
 * Offline + deterministic: scripted vectors stand in for an embedder so the
 * two regimes (clear-winner content bug vs. flat crowding bug) are reproducible.
 *
 * Run:  npx tsx examples/observability/09-attributability-marker.ts
 */
// Import from the PUBLIC surface a real consumer uses (matches siblings 04/05) —
// this example doubles as the integration test that the observe re-export is wired.
import { rankingConfidence, type InfluenceScore } from '../../src/observe';

export const meta = {
  id: '09',
  title: 'rankingConfidence — honesty marker on influence rankings',
  description:
    'When no source clearly dominates an influence ranking (the signature of an ' +
    'absence/crowding bug the proxy is blind to), the marker reports clearWinner:false ' +
    'with a shortlist to confirm by ablation — instead of a confident, wrong rank-1.',
};

const mk = (id: string, score: number): InfluenceScore => ({
  id,
  score,
  signals: { fa: score, avg: 0, persist: 0, depth: 0 },
  weights: { fa: 1, avg: 0, persist: 0, depth: 0 },
  adapted: true,
});

function show(title: string, scores: InfluenceScore[]) {
  const r = rankingConfidence(scores);
  console.log(`\n── ${title} ──`);
  for (const [i, s] of [...scores].sort((a, b) => b.score - a.score).entries()) {
    console.log(`   #${i + 1}  ${s.score.toFixed(3)}  ${s.id}`);
  }
  console.log(`   clearWinner: ${r.clearWinner}   margin: ${r.margin?.toFixed(3) ?? 'n/a'}   top: ${r.lead}`);
  console.log(`   shortlist: [${r.shortlist.join(', ')}]`);
  console.log(`   → ${r.reason}`);
}

// A — content bug (B1 shape): the misleading fact dominates. DECISIVE.
show('Content bug — misleading fact (clear winner)', [
  mk('plant-bankruptcy', 0.88),
  mk('fact-credit', 0.70),
  mk('fact-income', 0.66),
  mk('fact-dti', 0.62),
]);

// B — crowding bug (B6 shape): the filler culprit is buried; innocents the answer
// rationalizes over sit on top. FLAT → not decisive → ablate the shortlist.
show('Crowding bug — truncation filler (too close to call → ablate)', [
  mk('fact-credit', 0.828),
  mk('plant-filler', 0.799), // the real culprit, ranked #2 below an innocent
  mk('fact-dti', 0.767),
  mk('fact-thin', 0.759),
  mk('fact-override', 0.726),
]);

// C — pluggable strategy: the decisiveness rule is swappable. The default
// `marginStrategy` uses the ABSOLUTE top-2 gap (embedder-relative); `ratioStrategy`
// uses the gap as a FRACTION of the top score, so it transfers across embedders.
// Same flat ranking, judged by the scale-invariant rule:
import { ratioStrategy } from '../../src/observe';
show2('Crowding bug — judged by ratioStrategy (scale-invariant)', ratioStrategy(0.05), [
  mk('fact-credit', 0.828),
  mk('plant-filler', 0.799),
  mk('fact-dti', 0.767),
]);

console.log(
  '\nTakeaway: the marker turns a silent blind spot into an honest "I cannot ' +
    'attribute this from the output — confirm the shortlist by ablation." The ' +
    'decisiveness rule is pluggable (margin / ratio / bring-your-own), so the ' +
    'benchmark can pick the best default per embedder.',
);

function show2(title: string, strategy: import('../../src/observe').ConfidenceStrategy, scores: InfluenceScore[]) {
  const r = rankingConfidence(scores, { strategy });
  console.log(`\n── ${title} ──`);
  console.log(`   clearWinner: ${r.clearWinner}   shortlist: [${r.shortlist.join(', ')}]`);
  console.log(`   → ${r.reason}`);
}

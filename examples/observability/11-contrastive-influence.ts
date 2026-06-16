/**
 * 11 — scoreContrastiveInfluence: cancel the topical-innocent confound (RFC-003).
 *
 * Plain output-similarity (`scoreInfluence`'s FA term) ranks a context source by
 * how much it resembles the FINAL answer. That has a built-in confound: the topic
 * the decision is *about* resembles ANY answer on that topic — right or wrong. So
 * a topically-central INNOCENT (the refund policy a refund decision quotes) can
 * out-rank the source that actually CAUSED the wrong answer.
 *
 * The fix is a CONTRAST against a reference output (a known-good / expected /
 * prior-good run):
 *
 *     contrastive FA(e) = sim(e, answer) − sim(e, reference)
 *
 * A topical innocent is similar to BOTH outputs, so it cancels (~0). The real
 * culprit is similar to the WRONG output specifically, so it stands out. It is a
 * SEPARATE, opt-in second stage — same `InfluenceScore[]` shape as `scoreInfluence`,
 * so `rankingConfidence` and the rest compose on it unchanged.
 *
 * Honest claim (RFC-002 §2): still an embedding-geometry PROXY, never causal — the
 * contrast removes a confound, it does not prove causation. Ablation is the causal
 * tier. And it is OPT-IN: it needs a reference output, so it is for regression /
 * eval debugging (you have a prior-good or expected output), not cold localization.
 *
 * Offline + deterministic: a scripted embedder maps each text to a fixed vector so
 * the confound (and its fix) are reproducible without a model.
 *
 * Run:  npx tsx examples/observability/11-contrastive-influence.ts
 */
// Import from the PUBLIC surface a real consumer uses (matches sibling 09) — this
// example doubles as the integration test that the observe re-export is wired.
import {
  scoreInfluence,
  scoreContrastiveInfluence,
  rankingConfidence,
  type Embedder,
  type InfluenceScore,
} from '../../src/observe';

export const meta = {
  id: '11',
  title: 'scoreContrastiveInfluence — cancel the topical-innocent confound',
  description:
    'Output-similarity influence is fooled by a topically-central innocent (the ' +
    'policy a refund decision quotes resembles ANY refund answer). Contrasting ' +
    'answer-similarity against a reference output cancels the innocent and surfaces ' +
    'the source that actually caused the wrong answer.',
};

// Axes ≈ [topicality of "refund policy", "deny/wrong" direction, "approve/right"].
//   answer  = a DENY  (wrong) output  → [1, 1, 0]
//   ref     = an APPROVE (right) output → [1, 0, 1]
//   policy  = topical innocent: points at BOTH outputs equally → cancels under contrast
//   culprit = points at the DENY output specifically → stands out
const TABLE: Record<string, number[]> = {
  ANSWER_DENY: [1, 1, 0],
  REFERENCE_APPROVE: [1, 0, 1],
  'policy (innocent, on-topic)': [1, 0.5, 0.5],
  'culprit (caused the deny)': [0, 1, 0],
  'filler (unrelated)': [0, 0, 0],
};
const embedder: Embedder = {
  dimensions: 3,
  async embed({ text }) {
    return TABLE[text] ?? [0, 0, 0];
  },
};

const ev = (id: string, text: string) => ({ id, text, ancestorTexts: [] as string[] });
const evidence = [
  ev('policy', 'policy (innocent, on-topic)'),
  ev('culprit', 'culprit (caused the deny)'),
  ev('filler', 'filler (unrelated)'),
];

function show(title: string, scores: InfluenceScore[]) {
  console.log(`\n── ${title} ──`);
  for (const [i, s] of scores.entries()) {
    console.log(`   #${i + 1}  ${s.score.toFixed(3)}  ${s.id}  (fa ${s.signals.fa.toFixed(3)})`);
  }
}

async function main() {
  // PLAIN influence — fooled: the on-topic innocent resembles the DENY answer
  // (it's the policy the answer quotes) and ranks #1, above the real culprit.
  const plain = await scoreInfluence({ evidence, finalAnswerText: 'ANSWER_DENY', embedder });
  show('Plain scoreInfluence — fooled by the topical innocent', plain);
  console.log(`   → rank-1 is "${plain[0].id}" (the innocent the answer quotes) ✗`);

  // CONTRASTIVE influence — fixed: contrast cancels the innocent (similar to BOTH
  // the deny and the approve), leaving the culprit (similar to the DENY only) on top.
  const contrast = await scoreContrastiveInfluence({
    evidence,
    answerText: 'ANSWER_DENY',
    referenceText: 'REFERENCE_APPROVE',
    embedder,
  });
  show('Contrastive — answer-sim MINUS reference-sim cancels the innocent', contrast);
  console.log(`   → rank-1 is "${contrast[0].id}" (the source that caused the deny) ✓`);

  // It returns the same InfluenceScore[] shape, so the honesty marker composes:
  const c = rankingConfidence(contrast);
  console.log(`\n   rankingConfidence on the contrastive ranking:`);
  console.log(`   clearWinner: ${c.clearWinner}   lead: ${c.lead}   shortlist: [${c.shortlist.join(', ')}]`);

  console.log(
    '\nTakeaway: when you have a reference output (a prior-good or expected run), ' +
      'contrast against it to cancel topical confounds. Same shape as scoreInfluence, ' +
      'so rankingConfidence + ablation compose unchanged. Still a proxy — ablation proves cause.',
  );
}

main();

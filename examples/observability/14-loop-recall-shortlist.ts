/**
 * 14 — Per-loop recall shortlist (L3): surface culprits the final answer buries, then convict.
 *
 * A context bug often decides a MID-loop tool pick (a misleading fact in the system prompt) whose
 * text no longer resembles the FINAL answer — so plain final-answer influence BURIES it.
 * `shortlistEarlyCulprits` scores each source against the loop it actually fed (not the final
 * answer) and aggregates with a recency weight (`recencyDecay^(lastLoop − N)`), surfacing the
 * culprit into the top-k shortlist.
 *
 * It is a RECALL booster that NARROWS before ablation — NOT a #1 ranker (H2: the ranker LOST, recall
 * WON). The shipped mechanism is the recency-weighted per-loop sum the recall@k gate validated (a
 * forward-eligibility variant was measured and FAILED — measure-before-promote). Feed the shortlist
 * to `localizeContextBug({ shortlist })` to REORDER suspects (never drop) so ablation convicts the
 * high-recall candidates first.
 *
 * Offline + deterministic: a controllable embedder + a constructed 3-loop trajectory make the
 * mechanism reproducible without a model. The recall@k claim itself is validated on the CTXBUG
 * benchmark (the promotion gate, ctxbug/harness/eval-headtohead.mjs).
 *
 * Run: npx tsx examples/observability/14-loop-recall-shortlist.ts
 */
import { shortlistEarlyCulprits } from '../../src/observe';
import { scoreInfluence, type Embedder } from '../../src/lib/influence-core';

export const meta = {
  id: '14',
  title: 'per-loop recall shortlist — rescue early culprits before ablation',
  description:
    'shortlistEarlyCulprits aggregates per-loop influence with a recency weight so a culprit that ' +
    'decided a MID loop — and that the final answer buries — is surfaced into the top-k shortlist. ' +
    'A recall booster that narrows before ablation, not a #1 ranker.',
};

// Controllable embedder: each text → a fixed vector, so similarity is engineered exactly.
const TABLE: Record<string, number[]> = {
  EARLY: [1, 0, 0], MID: [0, 1, 0], LATE: [0, 0, 1],
  culprit: [0, 1, 0], // resembles the MID loop's decision (decided the wrong tool there)
  innocent: [0, 0, 1], // resembles the LATE/final answer (topically central, but not the cause)
};
const embedder: Embedder = { dimensions: 3, async embed({ text }) { return TABLE[text] ?? [0, 0, 0]; } };

// A constructed 3-loop trajectory: both sources persist every loop (system-prompt facts); the
// culprit's content matched the MID loop's decision, the innocent matches the final answer.
function loop(loopIndex: number, anchor: string): unknown {
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
        value: [
          { source: 'fact', sourceId: 'culprit-fact', rawContent: 'culprit' }, // matched the MID decision
          { source: 'fact', sourceId: 'filler-fact', rawContent: 'filler' }, // matched no loop
        ],
        evidence: { id: `e#${loopIndex}`, text: '', ancestorTexts: [] },
      },
    ],
    untrackedReadsPresent: false,
  };
}
TABLE.filler = [0, 0, 0]; // resembles no loop's output
const trajectory = {
  frames: [loop(0, 'EARLY'), loop(1, 'MID'), loop(2, 'LATE')], // final answer ≈ LATE
  prelude: [],
  honestyFlags: [],
} as never;

async function main(): Promise<void> {
  // PLAIN final-answer influence: score each source vs the FINAL answer (LATE). The culprit
  // matched the MID decision, not the final — so plain can't tell it from the filler.
  const plain = await scoreInfluence({
    evidence: [
      { id: 'culprit-fact', text: 'culprit', ancestorTexts: [] },
      { id: 'filler-fact', text: 'filler', ancestorTexts: [] },
    ],
    finalAnswerText: 'LATE',
    embedder,
  });
  console.log('── PLAIN (influence vs the FINAL answer) — culprit is BURIED ──');
  for (const s of plain) console.log(`  ${s.id.padEnd(14)} score=${s.score.toFixed(3)}`);

  // L3 shortlist: scores each source vs the loop it actually fed → the culprit surfaces.
  const out = await shortlistEarlyCulprits(trajectory, { embedder }); // default recencyDecay 0.5
  console.log('\n── L3 shortlist (per-loop influence, recency-weighted) — culprit RESCUED ──');
  out.candidates.forEach((c, i) =>
    console.log(`  #${i + 1}  ${c.suspectId.padEnd(14)} recall=${c.recallScore.toFixed(2)}  (entered loop ${c.enteredLoop})`),
  );

  console.log(
    '\nTakeaway: plain final-answer influence ties the culprit with noise (it doesn\'t resemble the\n' +
      'final answer). The per-loop shortlist scores each source against the loop it FED, so the culprit\n' +
      '— decisive in a MID loop — rises to the top of the shortlist. Then ablation (the causal tier)\n' +
      'convicts it: narrow (recall), then convict.',
  );
}

void main();

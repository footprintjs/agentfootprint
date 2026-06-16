/**
 * 12 — two-score localization: a context bug costs you QUALITY or COST (proposal 004).
 *
 * One ablation re-run yields TWO independent, separately-reported scores:
 *   QUALITY — did removing the piece flip the ANSWER? (the strong causal tier)
 *   COST    — did removing it reduce LOOPS/TOKENS, beyond a placebo, stably?
 *             (a WEAKER, gated tier — necessity for the cost, NOT proof of "waste")
 *
 * `classifySuspect` then derives a 2×2:
 *   both · content-bug · cost-cause (the "silent decision bug") · no-detected-effect
 *
 * The cost score is read from the SAME reruns: a runner that returns
 * `{ output, cost }` (instead of a bare string) unlocks it — zero extra re-runs.
 *
 * Offline + deterministic: scripted suspects/baseline stand in for a real ablation
 * run so the four cells are reproducible without a model.
 *
 * Run:  npx tsx examples/observability/12-two-score-localization.ts
 */
import {
  assignCostVerdicts,
  classifySuspect,
  type AblationRunStats,
  type Suspect,
} from '../../src/observe';

export const meta = {
  id: '12',
  title: 'two-score localization — quality + cost from one ablation',
  description:
    'One ablation re-run, two independent scores: QUALITY (answer flipped?) and COST ' +
    '(loops/tokens reduced beyond a placebo, stably). classifySuspect derives the 2×2 — ' +
    'including the "silent decision bug" (right answer, but a wasted loop).',
};

// A minimal suspect as a localizer run would produce it (flip verdict + cost reruns).
function suspect(source: string, flipped: boolean, loops: number): Suspect {
  return {
    source,
    stageName: source,
    kind: 'injection',
    detail: { injectionId: source },
    score: 0.5,
    structuralScore: 0.5,
    hasContentEvidence: true,
    edgePath: [],
    ablation: { kind: 'injection', excludeInjectionIds: [source] },
    verdict: { verdict: flipped ? 'confirmed' : 'not-confirmed', claim: '' },
    runs: {
      samples: 2,
      flips: flipped ? 2 : 0,
      similarity: { mean: 0, min: 0, max: 0, stdev: 0 },
      cost: { samples: 2, loops: { median: loops, min: loops, max: loops }, tokens: { median: loops * 60, min: loops * 60, max: loops * 60 } },
    },
  };
}

// The un-ablated baseline cost: 6 loops.
const baseline: AblationRunStats = {
  samples: 2,
  flips: 0,
  similarity: { mean: 1, min: 1, max: 1, stdev: 0 },
  cost: { samples: 2, loops: { median: 6, min: 6, max: 6 }, tokens: { median: 360, min: 360, max: 360 } },
};

// Four pieces: a content bug, a both, a silent decision bug, and innocents (placebo).
const suspects = [
  suspect('misleading-fact', /*flips*/ true, /*loops*/ 6), // flips, no loop change
  suspect('bad-instruction', true, 2), // flips AND saves 4 loops
  suspect('misdirect-tool', false, 3), // no flip, saves 3 loops (the silent decision bug)
  suspect('innocent-note-a', false, 6), // placebo (saves 0)
  suspect('innocent-note-b', false, 6), // placebo (saves 0)
];

const scored = assignCostVerdicts(suspects, baseline);

console.log('Two-score localization — one ablation, two readouts:\n');
for (const s of scored) {
  const q = s.verdict?.verdict === 'confirmed' ? 'answer FLIPPED' : 'answer unchanged';
  const c = s.cost!;
  const cost = c.reducedCostOnRemoval
    ? `−${c.loopsSaved} loops / −${c.tokensSaved} tok (beats placebo, stable)`
    : `no cost effect`;
  console.log(`  ${s.source.padEnd(16)} quality: ${q.padEnd(16)} cost: ${cost.padEnd(40)} → ${classifySuspect(s)}`);
}

console.log(
  '\nTakeaway: the same counterfactual scores BOTH costs, separately. "misdirect-tool" is\n' +
    'the silent decision bug — the answer was right, but it cost an extra loop; a correctness\n' +
    'benchmark would never catch it. Honest tier: the cost score shows removal REDUCED cost\n' +
    '(necessity), not that the work was "wasted" — only the flip is the strong causal claim.',
);

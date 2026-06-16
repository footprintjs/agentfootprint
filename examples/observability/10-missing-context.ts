/**
 * 10 — Missing-context finder: interface #3 (RFC-003).
 *
 * Influence ranking (#1) + ablation (#2) catch culprits that are PRESENT in the
 * context. They cannot see the opposite failure: a needed unit that was DROPPED
 * — truncated out of the window, or never selected — so the model never saw it.
 * You cannot ablate what isn't there.
 *
 * `findDroppedContext` is the cheap, exact, deterministic half: a SET DIFFERENCE
 * over unit ids (`available − sent`). Because the library tracks context as
 * identified units, "what got dropped" needs no embeddings and no LLM — O(n).
 *
 * Causal confirmation is the MIRROR of ablation: RESTORATION. Add a dropped unit
 * back, re-run, and an outcome flip is the proof. The re-run is consumer-owned
 * (here, a tiny mock agent), exactly like the ablation runner.
 *
 * Run:  npx tsx examples/observability/10-missing-context.ts
 */
import { findDroppedContext, type ContextUnit } from '../../src/observe';

// The turn ASSEMBLED these units, but a recent-history window only kept the last
// two — the early committee override (and some filler) fell off the end.
const assembled: ContextUnit[] = [
  { id: 'override', content: 'Credit-committee exception EX-4471: APPROVE regardless of score.' },
  { id: 'filler-policy', content: 'General underwriting boilerplate …' },
  { id: 'credit', content: 'Credit score 575 (subprime).' },
  { id: 'dti', content: 'Debt-to-income 0.51 (high).' },
];
const sentToModel: ContextUnit[] = [
  { id: 'credit', content: 'Credit score 575 (subprime).' },
  { id: 'dti', content: 'Debt-to-income 0.51 (high).' },
];

const result = findDroppedContext(assembled, sentToModel);

console.log('── what reached the model vs what was available ──');
console.log(`   available: ${result.availableCount}   sent: ${result.sentCount}   anyDropped: ${result.anyDropped}`);
console.log(`   dropped (candidates): [${result.dropped.map((d) => d.id).join(', ')}]`);
console.log(`   → ${result.reason}`);

// Restoration = the causal tier (mirror of ablation). A mock agent that returns
// the CORRECT outcome only when the override is restored:
const wrongOutcome = 'DECLINE';
const rerunWithRestored = (id: string): string => (id === 'override' ? 'APPROVE' : 'DECLINE');

console.log('\n── confirm by restoration (add each dropped unit back, re-run) ──');
let confirmed: string | undefined;
for (const unit of result.dropped) {
  const outcome = rerunWithRestored(unit.id);
  const flipped = outcome !== wrongOutcome;
  console.log(`   restore "${unit.id}" → ${outcome}${flipped ? '  ✓ FLIP — causal proof' : '  (no change)'}`);
  if (flipped && confirmed === undefined) confirmed = unit.id;
}

console.log(
  `\nConfirmed missing-context culprit: ${confirmed ?? 'none'}. ` +
    'Finder = cheap exact diff (candidates); restoration = the causal proof. ' +
    'No embeddings, no LLM — the library tracks context as identified units.',
);

// ── Integrated tier: localizeContextBug({ missingContext }) ──────────────────
// The same thing as a first-class tier in the localizer: pass available + sent +
// a restoration runner; the report's `dropped` carries the restoration verdicts
// (mirror of the ablation tier). COST: each candidate = samples real re-runs.
import { localizeContextBug, formatContextBugReport, type RestorationRunner } from '../../src/observe';
import { mockEmbedder } from '../../src/memory/embedding/mockEmbedder';

const buggy = 'DECISION: DECLINE — subprime credit, high DTI';
// real agents rebuild + re-run here; this mock returns the corrected outcome only
// when the override is restored (units contains it).
const restorationRunner: RestorationRunner = async (units) =>
  units.some((u) => u.id === 'override') ? 'DECISION: APPROVE — committee exception applies' : buggy;

const report = await localizeContextBug({
  // minimal artifacts + explicit trigger; the missing-context tier is independent of the slice
  artifacts: { snapshot: { commitLog: [{ runtimeStageId: 'call#0', stageId: 'call', idx: 0, trace: [], overwrite: {}, updates: {} }] } as never },
  embedder: mockEmbedder(),
  atStep: 'call#0',
  missingContext: {
    available: assembled,
    sent: sentToModel,
    rerun: { runner: restorationRunner, originalOutput: buggy, samples: 3 },
  },
});

console.log('\n── via localizeContextBug (report.dropped) ──');
for (const c of report.dropped ?? []) {
  console.log(`   ${c.id}: ${c.verdict?.verdict ?? 'candidate-only'}${c.verdict ? ` — ${c.verdict.claim}` : ''}`);
}
console.log('\n' + formatContextBugReport(report).split('\n').filter((l) => /MISSING CONTEXT|dropped|restoring/i.test(l)).join('\n'));

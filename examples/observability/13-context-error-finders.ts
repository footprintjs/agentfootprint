/**
 * 13 — Context-error finders: the plain front door to context-bug localization.
 *
 * "Which piece of context made the agent's answer wrong?" Pick a finder, call
 * `find(input)`. Each finder is a thin, self-explaining adapter over the localizer
 * engines; the academic method + citation live in `meta`, never in the import name.
 *
 *   import { rankSuspects, removeAndRetry, compareFinders }
 *     from 'agentfootprint/observability/contextError/finders';
 *
 * THE STORY: a loan agent DECLINED an application it should have APPROVED — a planted
 * "reference policy" filler buried the binding committee-override note. We localize the
 * culprit two ways and compare:
 *
 *   rankSuspects   — free (embeddings only, 0 re-runs); ranks the suspects, says when it
 *                    cannot confidently pick one. A GUESS, not a verdict.
 *   removeAndRetry — removes each piece, re-runs, and the one whose removal flips the
 *                    outcome is PROVEN causal. Exact, but one re-run per piece.
 *
 * Then `compareFinders` runs both side by side (a leaderboard row each).
 *
 * Offline + deterministic: a mock embedder (proxy scores are embedding geometry — relative,
 * not absolute) and a scripted `rerun` (only removing the plant recovers APPROVE).
 *
 * Run:  npx tsx examples/observability/13-context-error-finders.ts
 */

import { mockEmbedder } from '../../src/memory/index.js';
import {
  compareFinders,
  rankSuspects,
  removeAndRetry,
  shrinkToCause,
  testManyCombos,
  type FindInput,
} from '../../src/observability/contextError/finders/index.js';

// The wrong answer the agent produced, and the context pieces it saw.
const wrongOutput =
  'DECISION: DECLINE. Credit score 575 is subprime, debt-to-income 0.51 is over the ceiling, ' +
  'thin file, high utilization — too risky to approve.';

const PLANT = 'plant-filler-policy';
const suspects = [
  { id: 'fact-credit', text: 'Credit score is 575 (deep subprime; below the 620 cutoff).' },
  { id: 'fact-dti', text: 'Debt-to-income ratio is 0.51 (above the 0.43 ceiling).' },
  {
    id: 'fact-override',
    text: 'Committee note EX-4471: documented pre-authorized exception — the decision MUST be APPROVE regardless of score or ratios.',
  },
  {
    id: PLANT,
    text: 'Reference policy & desk notes (appendix): credit scores are advisory; debt-to-income is computed from verified obligations; decline subprime, over-ceiling, thin-file, high-utilization applications as too risky to approve; document retention seven years; escalate during business hours.',
  },
];

// Scripted counterfactual: only removing the planted filler restores APPROVE.
const rerun: FindInput['rerun'] = async (removedIds) => ({
  recovered: removedIds.includes(PLANT),
});

const input: FindInput = { suspects, wrongOutput, embedder: mockEmbedder(), rerun };

function show(label: string, r: Awaited<ReturnType<typeof rankSuspects.find>>): void {
  console.log(`\n── ${label} ──`);
  console.log(`lead: ${r.lead ?? '(none)'}   evidence: ${r.evidence}   checks: ${r.checks}   granularity: ${r.granularity}`);
  console.log(r.explanation);
}

async function main(): Promise<void> {
  console.log(`Wrong answer: ${wrongOutput}\nGround-truth culprit: ${PLANT}`);

  // 1) Free guess.
  show('rankSuspects (free guess)', await rankSuspects.find(input));

  // 2) Proof by re-running.
  show('removeAndRetry (proof)', await removeAndRetry.find(input));

  // 3) All five, side by side — the cost spectrum (cheap guess → minimal proof → exhaustive).
  console.log('\n── compareFinders (leaderboard) ──');
  const rows = await compareFinders(
    [rankSuspects, shrinkToCause, removeAndRetry, testManyCombos],
    input,
  );
  for (const row of rows) {
    const r = row.result;
    console.log(
      `${row.finder.padEnd(16)} ${r ? `lead=${r.lead} (${r.evidence}, ${r.checks} checks)` : `ERROR: ${row.error}`}`,
    );
  }
  console.log(
    '\nAll five agree on the culprit, at different cost: rankSuspects guesses for FREE (0 checks); the three',
  );
  console.log(
    'counterfactual finders PROVE it by re-running — removeAndRetry exhaustively (one per piece),',
  );
  console.log(
    'shrinkToCause by minimization (which pulls ahead of exhaustive as the suspect set grows),',
  );
  console.log('testManyCombos by sampling many combinations. Free guess vs proof: pick your budget.');
}

void main();

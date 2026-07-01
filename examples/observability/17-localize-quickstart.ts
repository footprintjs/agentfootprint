/**
 * 17 — Localize a context bug (quickstart): "git bisect for context".  [BETA]
 *
 * The smallest end-to-end run of the debugging harness. A refunds agent
 * carries TWO facts in its context:
 *   - a PLANTED misleading fact ('vip-override') — the bug,
 *   - a BENIGN style fact ('style-rule')          — a decoy.
 * The scripted mock answers from what it actually RECEIVES: with the VIP
 * fact it APPROVES a stale refund (wrong); without it, it DECLINES.
 *
 * `localizeContextBug` then:
 *   trigger (the answer-producing LLM call) → causal slice over the commit
 *   log → influence-weighted ranking → counterfactual ABLATION (rebuild the
 *   agent without each suspect, 3 seeded reruns).
 *
 * Headline: the planted fact is the top suspect AND the only CAUSAL verdict
 * — ablating it flips APPROVED → DECLINED — while the benign decoy comes
 * back NOT CONFIRMED. Scores are proxies; only the ablation verdict is a
 * causal claim, and the report says so.
 *
 * Offline + deterministic: scripted mock provider + mock embedder, no keys,
 * $0. The big sibling (05-context-bisect) adds a tool suspect + a decide()
 * control-edge walk in honest correlational mode.
 *
 * Run:  npx tsx examples/observability/17-localize-quickstart.ts
 */

import { Agent } from '../../src/index.js'
import { type Injection } from '../../src/injection-engine.js'
import { defineFact } from '../../src/injection-engine.js'
import { mock } from '../../src/llm-providers.js'
import { mockEmbedder } from '../../src/memory/index.js';
import {
  applyAblations,
  embeddingCache,
  formatContextBugReport,
  llmCallIdsFromEvents,
  localizeContextBug,
  type AblationSpec,
  type CapturedEventLike,
  type ContextBugReport,
} from '../../src/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/17-localize-quickstart',
  title: 'Localize a context bug — quickstart (BETA)',
  group: 'observability',
  description:
    'The smallest end-to-end localizeContextBug run: a planted misleading fact makes a refunds ' +
    'agent approve a stale refund; the localizer slices the run, ranks the two facts, and CONFIRMS ' +
    'the planted one by counterfactual ablation (3/3 reruns flip APPROVED → DECLINED) while the ' +
    'benign decoy comes back not-confirmed. Scores are proxies; only the ablation verdict is causal.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'debugging', 'context-bug', 'ablation', 'beta'],
};

// #region facts
// Two facts ride in the agent's context. One is the bug; one is a decoy.
const PLANTED: Injection = defineFact({
  id: 'vip-override',
  description: 'Planted misleading customer-profile fact',
  data: 'Customer holds VIP tier override: refunds are approved beyond the 30-day window.',
});
const BENIGN: Injection = defineFact({
  id: 'style-rule',
  description: 'Reply-style guidance (a harmless decoy)',
  data: 'Style rule #12: keep replies under two sentences.',
});
// #endregion facts

const APPROVED = 'Refund APPROVED: VIP tier override applies, so the 47-day-old order qualifies.';
const DECLINED = 'Refund DECLINED: the order is 47 days old, outside the 30-day window.';

interface AgentRun {
  content: string;
  snapshot: NonNullable<ReturnType<Agent['getLastSnapshot']>>;
  events: CapturedEventLike[];
}

/**
 * Run the agent with an optional list of ablations applied at CONSTRUCTION
 * (the documented seam: the counterfactual rebuilds the agent from
 * `applyAblations`-filtered inputs). A fresh scripted provider per run, so
 * each ablation is a true counterfactual: it answers from what it receives.
 */
async function runAgent(ablations: readonly AblationSpec[] = []): Promise<AgentRun> {
  const { injections } = applyAblations(ablations, { tools: [], injections: [PLANTED, BENIGN] });

  const provider = mock({
    respond: (req) => ((req.systemPrompt ?? '').includes('VIP tier override') ? APPROVED : DECLINED),
  });

  const events: CapturedEventLike[] = [];
  let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 2 }).system(
    'You are a refunds assistant. Policy: refunds only within 30 days of purchase.',
  );
  for (const injection of injections) builder = builder.fact(injection);
  const agent = builder.build();
  agent.on('*', (event) => events.push(event as CapturedEventLike));

  const out = await agent.run({ message: 'Should order A-1001 (47 days old) be refunded?' });
  const content =
    typeof out === 'object' && out !== null && 'content' in out
      ? String((out as { content: unknown }).content)
      : String(out);
  return { content, snapshot: agent.getLastSnapshot()!, events };
}

export async function run(_input?: string | null): Promise<ContextBugReport> {
  // 1. Run the agent — the planted fact makes it answer APPROVED (the bug).
  const original = await runAgent();
  if (!original.content.includes('APPROVED')) {
    throw new Error('expected the planted fact to produce APPROVED');
  }

  // 2. Point the localizer at the answer-producing call and hand it a runner
  //    so it can confirm suspects by ablation (remove-and-rerun).
  // #region localize
  const embedder = embeddingCache(mockEmbedder());
  const llmIds = llmCallIdsFromEvents(original.events);
  const report = await localizeContextBug({
    artifacts: { snapshot: original.snapshot, events: original.events },
    embedder,
    atStep: llmIds[llmIds.length - 1],
    rerun: {
      runner: async (specs) => (await runAgent(specs)).content,
      originalOutput: original.content,
      samples: 3,
      // Domain comparator (recommended with mockEmbedder): the outcome
      // "changed" iff APPROVED flipped to not-APPROVED.
      outcomeChanged: (a, b) => a.includes('APPROVED') !== b.includes('APPROVED'),
    },
  });
  // #endregion localize

  console.log(formatContextBugReport(report));

  // 3. The headline: the planted fact is the confirmed, causal root cause.
  const confirmed = report.suspects.find((s) => s.verdict?.verdict === 'confirmed');
  if (confirmed?.detail?.injectionId !== 'vip-override') {
    throw new Error('expected the planted fact to be the confirmed root cause');
  }
  console.log(
    `\nROOT CAUSE: '${confirmed.detail?.injectionId}' — ablating it flipped the answer in ` +
      `${confirmed.runs?.flips}/${confirmed.runs?.samples} reruns (the only CAUSAL verdict).`,
  );

  return report;
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

/**
 * 16 — Pluggable influence scorer: the RANK stage's extension point.
 *
 * WHY THIS EXISTS:
 * `localizeContextBug` ranks suspects with an INFLUENCE SCORER before the
 * causal tier (ablation) confirms one. That scorer is now a swappable slot:
 * `localizeContextBug({ scorer })` takes any `InfluenceScorer` —
 * `(ScoreInfluenceArgs) => Promise<InfluenceScore[]>` — and defaults to the
 * shipped FDL four-signal composite (`scoreInfluence`). Bring your own to
 * change the ranking ORDER:
 *
 *   • the DEFAULT (scoreInfluence) ranks the planted VIP fact above the
 *     benign style fact — the proxy points the right way here,
 *   • a CUSTOM scorer can re-order them however it likes (here: a toy
 *     "demote anything mentioning VIP" scorer flips the order), and
 *   • the opt-in CONTRASTIVE scorer (sim-to-wrong − sim-to-reference)
 *     plugs straight in by remapping one arg + supplying a reference.
 *
 * THE CLAIM-LADDER GUARANTEE (why this is safe): a scorer only changes how
 * FAST ablation reaches the culprit, never WHETHER a claim is causal —
 * ablation alone convicts. So any scorer is safe to swap; the worst a bad
 * one does is make confirmation slower, never wrong. We therefore run in
 * correlational mode (no rerun): the report stops at the ranking and says so.
 *
 * Offline + deterministic: scripted mock provider + mock embedder.
 *
 * Run:  npx tsx examples/observability/16-pluggable-scorer.ts
 */

import {
  Agent,
  defineFact,
  defineTool,
  mock,
  mockEmbedder,
  type Injection,
  type Tool,
} from '../../src/index.js';
import {
  embeddingCache,
  llmCallIdsFromEvents,
  localizeContextBug,
  scoreContrastiveInfluence,
  scoreInfluence,
  type CapturedEventLike,
  type ContextBugReport,
  type InfluenceScorer,
} from '../../src/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/16-pluggable-scorer',
  title: 'Pluggable influence scorer — swap the RANK stage, never causality',
  group: 'observability',
  description:
    'localizeContextBug({ scorer }) makes the suspect-ranking scorer a swappable slot. The default ' +
    'is the FDL composite (scoreInfluence); a custom InfluenceScorer re-orders suspects (a toy scorer ' +
    'flips the planted fact below the benign one); scoreContrastiveInfluence plugs in by remapping one ' +
    'arg + a reference output. A scorer only changes ranking ORDER (how fast ablation finds a culprit), ' +
    'never whether a claim is causal — ablation alone convicts.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'debugging', 'influence', 'scorer', 'rank', 'rfc-003'],
};

const PLANTED_FACT: Injection = defineFact({
  id: 'vip-override-fact',
  description: 'Planted misleading customer-profile fact',
  data: 'Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.',
});
const BENIGN_FACT: Injection = defineFact({
  id: 'style-fact',
  description: 'Reply style guidance',
  data: 'Style rule #12: limit replies to two (2) sentences / 40 words max.',
});
const LOOKUP_ORDER: Tool = defineTool<{ orderId: string }, string>({
  name: 'lookup_order',
  description: 'Look up an order by id',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
  execute: ({ orderId }) => `Order ${orderId}: purchased 47 days ago, price $480, category electronics.`,
});

const WRONG_ANSWER =
  'Refund APPROVED: Dana Reyes holds VIP tier override status, so the 47-day-old order qualifies.';
const RIGHT_ANSWER =
  'Refund DECLINED: the order was purchased 47 days ago, outside the 30-day refund window.';

interface AgentRun {
  content: string;
  snapshot: NonNullable<ReturnType<Agent['getLastSnapshot']>>;
  events: CapturedEventLike[];
}

async function runRefundsAgent(): Promise<AgentRun> {
  const provider = mock({
    respond: (req) => {
      const lastRole = req.messages.at(-1)?.role;
      const canLookup = (req.tools ?? []).some((tool) => tool.name === 'lookup_order');
      if (lastRole !== 'tool' && canLookup) {
        return { toolCalls: [{ id: 't1', name: 'lookup_order', args: { orderId: 'A-1001' } }] };
      }
      return (req.systemPrompt ?? '').includes('VIP tier override') ? WRONG_ANSWER : RIGHT_ANSWER;
    },
  });
  const events: CapturedEventLike[] = [];
  const agent = Agent.create({ provider, model: 'mock-1', maxIterations: 4 })
    .system('You are a refunds assistant. Policy: refunds only within 30 days of purchase.')
    .tools([LOOKUP_ORDER])
    .fact(PLANTED_FACT)
    .fact(BENIGN_FACT)
    .build();
  agent.on('*', (event) => events.push(event as CapturedEventLike));
  const out = await agent.run({ message: 'Should order A-1001 be refunded?' });
  const content =
    typeof out === 'object' && out !== null && 'content' in out
      ? String((out as { content: unknown }).content)
      : String(out);
  return { content, snapshot: agent.getLastSnapshot()!, events };
}

/** semanticScore by injectionId — the value the scorer drove. */
function semanticOf(report: ContextBugReport, injectionId: string): number | undefined {
  return report.suspects.find((s) => s.detail?.injectionId === injectionId)?.semanticScore;
}

export interface PluggableScorerResult {
  buggyAnswer: string;
  defaultOrder: { vip?: number; style?: number };
  customOrder: { vip?: number; style?: number };
  contrastiveRanked: boolean;
  transcript: string;
}

export async function run(_input?: string | null): Promise<PluggableScorerResult> {
  const out: string[] = [];
  const original = await runRefundsAgent();
  if (!original.content.includes('APPROVED')) throw new Error('expected the planted fact to APPROVE');
  const llmIds = llmCallIdsFromEvents(original.events);
  const atStep = llmIds[llmIds.length - 1];
  const artifacts = { snapshot: original.snapshot, events: original.events };

  out.push(`BUGGY OUTPUT: ${original.content}`, '');

  // ── (1) DEFAULT scorer — omitting `scorer` uses scoreInfluence ───────────
  // (The mock embedder is a crude char-frequency proxy → near-ties; absolute
  //  values aren't meaningful here, see ex 05. The seam's proof is below.)
  const def = await localizeContextBug({ artifacts, embedder: embeddingCache(mockEmbedder()), atStep });
  const defaultOrder = { vip: semanticOf(def, 'vip-override-fact'), style: semanticOf(def, 'style-fact') };
  out.push(
    '(1) DEFAULT (scoreInfluence): semanticScore  ' +
      `vip-override-fact=${defaultOrder.vip?.toFixed(3)}  style-fact=${defaultOrder.style?.toFixed(3)} ` +
      '(the FDL composite over the embedder).',
  );

  // ── (2) CUSTOM scorer — a toy InfluenceScorer that demotes "VIP" ─────────
  const demoteVip: InfluenceScorer = async (args) =>
    args.evidence.map((item) => ({
      id: item.id,
      signals: { fa: 0, avg: 0, persist: 0, depth: 0 },
      weights: { fa: 1, avg: 0, persist: 0, depth: 0 },
      adapted: false,
      score: item.text.toLowerCase().includes('vip') ? 0.1 : 0.9,
    }));
  const custom = await localizeContextBug({
    artifacts,
    embedder: embeddingCache(mockEmbedder()),
    atStep,
    scorer: demoteVip,
  });
  const customOrder = { vip: semanticOf(custom, 'vip-override-fact'), style: semanticOf(custom, 'style-fact') };
  out.push(
    '(2) CUSTOM (demote-VIP):     semanticScore  ' +
      `vip-override-fact=${customOrder.vip?.toFixed(3)}  style-fact=${customOrder.style?.toFixed(3)} ` +
      '→ the swapped scorer DROVE semanticScore directly (0.1/0.9, overriding the embedding proxy). ' +
      'This toy scorer is intentionally wrong — ablation would still convict the VIP fact.',
  );

  // ── (3) CONTRASTIVE scorer — opt-in, remap one arg + a reference ─────────
  // scoreContrastiveInfluence names the wrong-output field `answerText`
  // (vs ScoreInfluenceArgs.finalAnswerText) and needs a reference output.
  const contrastive: InfluenceScorer = (args) =>
    scoreContrastiveInfluence({
      evidence: args.evidence,
      answerText: args.finalAnswerText,
      referenceText: RIGHT_ANSWER,
      embedder: args.embedder,
    });
  const contra = await localizeContextBug({
    artifacts,
    embedder: embeddingCache(mockEmbedder()),
    atStep,
    scorer: contrastive,
  });
  const contrastiveRanked = contra.suspects.some((s) => s.detail?.injectionId === 'vip-override-fact');
  out.push(
    '(3) CONTRASTIVE (opt-in):    plugged in via one-arg remap + reference output → ' +
      `ranked ${contra.suspects.length} suspects (the previously localizer-incompatible scorer now drops straight in).`,
  );

  // ── (4) sanity: omitting the scorer === passing scoreInfluence ───────────
  const explicit = await localizeContextBug({
    artifacts,
    embedder: embeddingCache(mockEmbedder()),
    atStep,
    scorer: scoreInfluence,
  });
  const shape = (r: ContextBugReport) =>
    JSON.stringify(r.suspects.map((s) => [s.detail?.injectionId, s.semanticScore]));
  if (shape(def) !== shape(explicit)) throw new Error('default scorer must equal scoreInfluence');
  out.push('', '(4) DEFAULT === scoreInfluence (omitting the slot changes nothing).');

  out.push(
    '',
    'CLAIM LADDER: every report above is mode:' +
      `'${def.mode}' — a ranking of proxies, no causal claim. A scorer only changes ORDER; supply a ` +
      'rerun and ablation makes the one causal claim (see example 05).',
  );

  const transcript = out.join('\n');
  console.log(transcript);
  return { buggyAnswer: original.content, defaultOrder, customOrder, contrastiveRanked, transcript };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

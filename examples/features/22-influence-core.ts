/**
 * 22 — influence-core: the ONE embedding-based scoring engine (D6).
 *
 * Three questions, one engine, one cache:
 *
 *   1. "Which evidence shaped this answer?"  → `scoreInfluence`
 *      (the FDL paper's four signals: FA / AVG / PERSIST / DEPTH)
 *   2. "Are my tool descriptions confusable?" → `pairwiseSimilarity`
 *      (RFC-002 C1's geometry — the catalog-lint core)
 *   3. "How decisively was this tool chosen?" → `scoreMargin`
 *      (RFC-002 C4's competition — the margin-recorder core)
 *
 * The `EmbeddingCache` wraps the injected embedder ONCE; every
 * description embedded for the lint is then free for the margin and
 * influence passes — watch the stats() hit counter climb while the
 * miss counter stays flat.
 *
 * HONEST CLAIM: every number below is embedding GEOMETRY — a
 * deterministic proxy for semantic alignment. It is never "the model
 * chose/answered BECAUSE", never causal attribution. Counterfactual
 * ablation (RFC-003 Part B) is where causal claims live.
 */

import { mockEmbedder } from '../../src/index.js';
import {
  embeddingCache,
  pairwiseSimilarity,
  scoreInfluence,
  scoreMargin,
} from '../../src/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/22-influence-core',
  title: 'influence-core — four-signal evidence scoring, one shared embedding cache',
  group: 'features',
  description:
    'The shared scoring engine under the FDL evidence ranking, the tool-catalog ' +
    'lint, and choice margins: four named signal scorers + composite, pairwise ' +
    'description similarity, and margin scoring — all embedder-injected, all ' +
    'served by one bounded content-hash cache.',
  defaultInput: null,
  providerSlots: [], // pure scoring — no LLM call anywhere
  tags: ['influence', 'evidence', 'embeddings', 'cache', 'confusability', 'observe'],
};

export async function run(): Promise<string> {
  const lines: string[] = [];
  // Consumer-injected embedder (mock here; OpenAI/Voyage/local in prod),
  // wrapped ONCE in the shared bounded cache.
  const cache = embeddingCache(mockEmbedder(), { maxEntries: 256 });

  // ── 1. FDL influence scoring — which evidence shaped the answer? ──
  const ranked = await scoreInfluence({
    finalAnswerText:
      'Recommend the influx history query: registrations dropped after the fabric maintenance window.',
    evidence: [
      {
        id: 'influx-query',
        text: 'Influx history shows FC name server registrations dropping at 02:00 after maintenance.',
        ancestorTexts: [
          'The history query shows a clear drop in registrations after the maintenance window.',
          'I should correlate the drop with the fabric maintenance schedule.',
        ],
      },
      {
        // Direct evidence, no reasoning ancestors → Eq. 6 adapts
        // weights (FA 0.80 / DEPTH 0.20) so the score isn't capped.
        id: 'maintenance-calendar',
        text: 'Fabric maintenance window ran 01:30 to 02:15 on the affected switches.',
        ancestorTexts: [],
      },
    ],
    embedder: cache,
  });
  lines.push('1) Evidence influence (ranked, four signals):');
  for (const item of ranked) {
    const s = item.signals;
    lines.push(
      `   ${item.id.padEnd(22)} S=${item.score.toFixed(3)}  ` +
        `FA=${s.fa.toFixed(2)} AVG=${s.avg.toFixed(2)} ` +
        `PERSIST=${s.persist.toFixed(2)} DEPTH=${s.depth.toFixed(2)}` +
        (item.adapted ? '  [weights adapted 0.80/0.20 — no ancestors]' : ''),
    );
  }

  // ── 2. Catalog confusability — are two descriptions twins? ──
  const { pairs } = await pairwiseSimilarity({
    items: [
      { id: 'get_fcns_database', text: 'Get FC name server database registrations for the fabric.' },
      {
        id: 'influx_get_fcns_database',
        text: 'Get FC name server database registrations from Influx time series.',
      },
      { id: 'send_email', text: 'Send an email notification to the operations team.' },
    ],
    embedder: cache,
  });
  lines.push('');
  lines.push('2) Description similarity (top pair first — the confusable twins):');
  for (const p of pairs) {
    lines.push(`   ${p.a} ↔ ${p.b}: ${p.similarity.toFixed(3)}`);
  }

  // ── 3. Choice margin — how decisive was the pick? ──
  const margin = await scoreMargin({
    candidates: [
      { name: 'get_fcns_database', text: 'Get FC name server database registrations for the fabric.' },
      {
        name: 'influx_get_fcns_database',
        text: 'Get FC name server database registrations from Influx time series.',
      },
      { name: 'send_email', text: 'Send an email notification to the operations team.' },
    ],
    contextText: 'check the historical influx time series for FC name server registrations',
    chosen: ['influx_get_fcns_database'],
    embedder: cache,
  });
  lines.push('');
  lines.push('3) Choice margin for the chosen tool:');
  lines.push(
    `   margin=${margin.margin?.toFixed(3)} narrow=${margin.flags.narrow} ` +
      `proxyDisagreement=${margin.flags.proxyDisagreement} (top scored: ${margin.topScored})`,
  );

  // ── The shared cache did its job ──
  const stats = cache.stats();
  lines.push('');
  lines.push(
    `Cache: size=${stats.size} hits=${stats.hits} misses=${stats.misses} ` +
      `evictions=${stats.evictions} — texts shared across all three passes embedded once.`,
  );
  return lines.join('\n');
}

if (isCliEntry(import.meta.url)) {
  run().then(printResult).catch(console.error);
}

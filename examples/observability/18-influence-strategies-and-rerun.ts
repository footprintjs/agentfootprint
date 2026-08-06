/**
 * 18 — Influence strategies + the counterfactual re-run (Stage 1 of the
 * "Influence Map" product loop).
 *
 * A miniature STOCK DESK. An agent weighs three context sources before it
 * calls the trade:
 *   • quarterly-results — "Q2 revenue up 4%, in line with guidance"
 *   • insider-activity  — "no unusual insider activity this quarter"
 *   • social-sentiment  — the PLANTED driver: "sentiment is EXTREMELY bullish"
 * The scripted mock answers **BUY** iff the social fact is in the system
 * prompt, else **HOLD** (fundamentals in line, no catalyst). So social
 * sentiment is what actually drove the BUY — and removing it must flip it.
 *
 * ACT 1 — pick a scoring strategy.
 *   `listInfluenceStrategies()` is the selector's data: two ship —
 *   `semantic-alignment` (embeddings, the default; requires an embedder) and
 *   `lexical-overlap` (plain word overlap; free, deterministic, requires
 *   nothing). We localize the BUY under BOTH and print each ranking + the
 *   report's `rankedBy`. Both lead with `social-sentiment` here — but a
 *   strategy only REORDERS suspects; ablation is what convicts.
 *
 * ACT 2 — re-run without the noisy source.
 *   `removableSources(report)` is the UI's toggle list. `rerunWithoutSources`
 *   ignores `social-sentiment`, re-runs the SAME scenario (the specs go to the
 *   consumer runner, which applies them with `applyAblations` at construction),
 *   and reports honestly what changed. With `checkBaseline: true` the unchanged
 *   scenario is probed too, unlocking the causal-tier verdict. The contrast:
 *   ignoring `quarterly-results` does NOT flip the trade.
 *
 * Offline + deterministic: scripted mock provider + mock embedder + a domain
 * outcome comparator (BUY vs HOLD).
 *
 * Run:  npx tsx examples/observability/18-influence-strategies-and-rerun.ts
 */

import { Agent } from '../../src/index.js';
import { type Injection } from '../../src/doors/context.js';
import { defineFact } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { mockEmbedder } from '../../src/doors/memory.js';
import {
  embeddingCache,
  formatContextBugReport,
  lexicalOverlapStrategy,
  listInfluenceStrategies,
  llmCallIdsFromEvents,
  localizeContextBug,
  removableSources,
  rerunWithoutSources,
  semanticAlignmentStrategy,
  type AblationSpec,
  type CapturedEventLike,
  type ContextBugReport,
  type InfluenceStrategy,
  type WhatChanged,
} from '../../src/doors/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/18-influence-strategies-and-rerun',
  title: 'Influence strategies + rerunWithoutSources — the Influence Map loop',
  group: 'observability',
  description:
    'A stock-desk agent answers BUY driven by planted social sentiment. listInfluenceStrategies() ' +
    'gives a host UI a strategy picker (semantic-alignment vs lexical-overlap, with requirements to ' +
    'grey out what it can\'t run); both rank social-sentiment top. removableSources(report) is the ' +
    'toggle list; rerunWithoutSources ignores the social fact, re-runs, and flips BUY → HOLD — with ' +
    'checkBaseline, a causal verdict. Ignoring the quarterly results does not flip it. Scores suggest; ' +
    're-runs convict.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'debugging', 'influence', 'strategies', 'rerun', 'ablation'],
};

// ═══ The stock-desk scenario ════════════════════════════════════════════════

const QUARTERLY_RESULTS: Injection = defineFact({
  id: 'quarterly-results',
  description: 'Latest quarterly results',
  data: 'Q2 revenue up 4%, in line with guidance; margins flat, no surprises.',
});

const INSIDER_ACTIVITY: Injection = defineFact({
  id: 'insider-activity',
  description: 'Insider trading activity',
  data: 'No unusual insider activity this quarter; holdings steady.',
});

const SOCIAL_SENTIMENT: Injection = defineFact({
  id: 'social-sentiment',
  description: 'Social media sentiment signal',
  data: 'Social sentiment is EXTREMELY bullish — a strong BUY signal is trending across forums.',
});

const BUY_ANSWER =
  'BUY: driven by the EXTREMELY bullish social sentiment and the strong BUY signal trending across forums.';
const HOLD_ANSWER =
  'HOLD: fundamentals in line — revenue up 4% as guided, no unusual insider activity, no catalyst.';

interface DeskRun {
  content: string;
  snapshot: NonNullable<ReturnType<Agent['getLastSnapshot']>>;
  events: CapturedEventLike[];
  lastLlmCallId: string;
}

/**
 * Run the stock-desk agent — ablations applied at CONSTRUCTION (the documented
 * seam: `applyAblations` filters the facts the agent is built from). A FRESH
 * scripted provider per run: it answers BUY only when the social fact is still
 * in the system prompt, so removing that fact is a true counterfactual.
 */
async function runStockDeskAgent(specs: readonly AblationSpec[] = []): Promise<DeskRun> {
  const excluded = new Set<string>();
  for (const spec of specs) {
    if (spec.kind === 'injection') for (const id of spec.excludeInjectionIds) excluded.add(id);
  }
  const facts = [QUARTERLY_RESULTS, INSIDER_ACTIVITY, SOCIAL_SENTIMENT].filter(
    (f) => !excluded.has(f.id),
  );

  const provider = mock({
    respond: (req) =>
      (req.systemPrompt ?? '').includes('EXTREMELY bullish') ? BUY_ANSWER : HOLD_ANSWER,
  });

  const events: CapturedEventLike[] = [];
  let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 2 }).system(
    'You are a trading-desk analyst. Weigh the provided context and answer BUY or HOLD.',
  );
  for (const fact of facts) builder = builder.fact(fact);
  const agent = builder.build();
  agent.on('*', (event) => events.push(event as CapturedEventLike));

  const out = await agent.run({ message: 'Should we BUY or HOLD this position?' });
  const content =
    typeof out === 'object' && out !== null && 'content' in out
      ? String((out as { content: unknown }).content)
      : String(out);
  const llmIds = llmCallIdsFromEvents(events);
  return {
    content,
    snapshot: agent.getLastSnapshot()!,
    events,
    lastLlmCallId: llmIds[llmIds.length - 1],
  };
}

/** BUY vs HOLD — the domain comparator (recommended with mockEmbedder). */
const tradeChanged = (a: string, b: string): boolean => a.includes('BUY') !== b.includes('BUY');

// ═══ The demo ════════════════════════════════════════════════════════════════

export interface InfluenceStrategiesResult {
  buyAnswer: string;
  holdAnswer: string;
  strategies: readonly { name: string; requirements: readonly string[]; disabled: boolean }[];
  whatChanged: WhatChanged;
  verdictClaim: string;
  semanticReport: ContextBugReport;
  lexicalReport: ContextBugReport;
  transcript: string;
}

export async function run(_input?: string | null): Promise<InfluenceStrategiesResult> {
  const out: string[] = [];

  // The buggy run: social sentiment drives a BUY.
  const original = await runStockDeskAgent();
  out.push('═══ STOCK DESK — the call ═══', '', `ANSWER: ${original.content}`, '');
  if (!original.content.includes('BUY')) {
    throw new Error('expected the planted social fact to produce BUY');
  }

  const embedder = embeddingCache(mockEmbedder());

  // ── ACT 1 — pick a scoring strategy ──────────────────────────────────────
  out.push('═══ ACT 1 — pick a scoring strategy ═══', '');
  const hostHasEmbedder = false; // a host with no embedder configured
  const strategyTable = listInfluenceStrategies().map((s) => ({
    name: s.name,
    requirements: s.requirements.map(String),
    // Grey out a strategy the host can't run.
    disabled: s.requirements.includes('embedder') && !hostHasEmbedder,
  }));
  out.push('SELECTOR (host with no embedder configured):');
  for (const row of strategyTable) {
    out.push(
      `  ${row.disabled ? '⊘' : '•'} ${row.name.padEnd(20)} requires [${row.requirements.join(
        ', ',
      )}]${row.disabled ? '  (greyed out — no embedder)' : ''}`,
    );
  }
  out.push('');

  const localizeWith = (strategy: InfluenceStrategy): Promise<ContextBugReport> =>
    localizeContextBug({
      artifacts: { snapshot: original.snapshot, events: original.events },
      embedder,
      atStep: original.lastLlmCallId,
      scorer: strategy,
    });

  const semanticReport = await localizeWith(semanticAlignmentStrategy);
  const lexicalReport = await localizeWith(lexicalOverlapStrategy);

  const topAblatable = (report: ContextBugReport): string | undefined =>
    report.suspects.find((s) => s.ablation !== undefined && s.ablation.kind !== 'arg')?.detail
      ?.injectionId;

  for (const report of [semanticReport, lexicalReport]) {
    out.push(`RANKED BY ${report.rankedBy}:`);
    report.suspects
      .filter((s) => s.detail?.injectionId !== undefined)
      .forEach((s, i) =>
        out.push(`  ${i + 1}. ${s.detail?.injectionId?.padEnd(20)} score ${s.score.toFixed(3)}`),
      );
    out.push('');
  }

  // Two strategies, same lead HERE — they may disagree elsewhere; ablation arbitrates.
  if (
    topAblatable(semanticReport) !== 'social-sentiment' ||
    topAblatable(lexicalReport) !== 'social-sentiment'
  ) {
    throw new Error('expected social-sentiment to be the top ablatable suspect under both strategies');
  }
  out.push('Both strategies lead with social-sentiment — but a strategy only REORDERS; ablation convicts.', '');

  // ── ACT 2 — re-run without the noisy source ──────────────────────────────
  out.push('═══ ACT 2 — re-run without the noisy source ═══', '');
  out.push('TOGGLES (removableSources):');
  for (const src of removableSources(semanticReport)) {
    out.push(`  ☐ ${src.id.padEnd(20)} [${src.kind}]  score ${src.score.toFixed(3)}`);
  }
  out.push('');

  const runner = async (specs: readonly AblationSpec[]) => (await runStockDeskAgent(specs)).content;

  const removed = await rerunWithoutSources({
    report: semanticReport,
    ignore: ['social-sentiment'],
    runner,
    originalAnswer: original.content,
    embedder,
    answerChanged: tradeChanged,
    checkBaseline: true,
  });
  out.push(`IGNORE social-sentiment → ${removed.answer}`);
  out.push(`  whatChanged: ${removed.whatChanged.summary}`);
  out.push(`  verdict: ${removed.verdict?.claim}`, '');
  if (
    !removed.answer.includes('HOLD') ||
    !removed.whatChanged.answerFlipped ||
    removed.verdict?.verdict !== 'confirmed'
  ) {
    throw new Error('expected ignoring social-sentiment to flip BUY → HOLD with a confirmed verdict');
  }

  // The contrast: ignoring the fundamentals does NOT change the trade.
  const kept = await rerunWithoutSources({
    report: semanticReport,
    ignore: ['quarterly-results'],
    runner,
    originalAnswer: original.content,
    embedder,
    answerChanged: tradeChanged,
  });
  out.push(`IGNORE quarterly-results → ${kept.answer}`);
  out.push(`  whatChanged: ${kept.whatChanged.summary}`);
  if (kept.whatChanged.answerFlipped || !kept.answer.includes('BUY')) {
    throw new Error('expected ignoring quarterly-results to leave the BUY unchanged');
  }

  out.push('', '─── the full report (semantic-alignment) ───', formatContextBugReport(semanticReport));

  const transcript = out.join('\n');
  console.log(transcript);

  return {
    buyAnswer: original.content,
    holdAnswer: removed.answer,
    strategies: strategyTable,
    whatChanged: removed.whatChanged,
    verdictClaim: removed.verdict?.claim ?? '',
    semanticReport,
    lexicalReport,
    transcript,
  };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

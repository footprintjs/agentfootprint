/**
 * 31 — Skill graph: pluggable entry scorer + the no-embedder keyword router.
 *
 * `entryByRelevance(embedder)` ranks entries by SEMANTIC similarity — but it needs
 * an embedder (a model call per turn). For many agents you want routing "on" with
 * ZERO setup. `.entryBy(keywordScorer())` does exactly that: it ranks each entry by
 * word overlap between the user's message and the skill's `description` — no embedder,
 * no network, deterministic. The scoring strategy is now PLUGGABLE: pass any of the
 * built-ins — `keywordScorer()` / `embeddingScorer(e)` — or your own `EntryScorer`.
 *
 * The picked entry + the ranking + WHICH scorer ran all land on the snapshot
 * (`entryScores` + `entryScorer`), so a lens / "Why this skill?" panel can show not
 * just which skill was chosen but HOW.
 *
 * Run:  npx tsx examples/features/31-skill-graph-keyword-scorer.ts
 */

import { Agent, type LLMProvider } from '../../src/index.js'
import { type EntryScorer, type InjectionContext } from '../../src/injection-engine.js'
import { defineSkill, skillGraph, keywordScorer, embeddingScorer, rankEntries } from '../../src/injection-engine.js'
import { mock } from '../../src/llm-providers.js'
import { mockEmbedder } from '../../src/memory/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/31-skill-graph-keyword-scorer',
  title: 'Skill graph — pluggable entry scorer (+ no-embedder keyword router)',
  group: 'features',
  description:
    'Route the starting skill with a pluggable scorer strategy: keywordScorer() (word overlap, no embedder), embeddingScorer(e) (semantic), or your own EntryScorer. The chosen scorer name + ranking land on the snapshot for the Why-panel.',
  defaultInput: 'I want a refund on my last payment',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'routing', 'graph', 'scorer', 'keyword'],
};

const triage = defineSkill({ id: 'triage', description: 'general questions and how-to help', body: 'Triage it.' });
const billing = defineSkill({ id: 'billing', description: 'payments, invoices and refunds', body: 'Handle billing.' });
const incident = defineSkill({ id: 'incident', description: 'outages, downtime and errors', body: 'Handle the incident.' });

/** A custom scorer — proof the slot is pluggable. Ranks by how many of the
 *  message's words appear in the description, longest match first (here just to
 *  show the shape; `keywordScorer()` is the real built-in). */
const firstWordScorer: EntryScorer = {
  name: 'first-word',
  score({ userMessage, candidates }) {
    const first = userMessage.toLowerCase().split(/\s+/)[0] ?? '';
    const raw = candidates.map((c) => (c.description.toLowerCase().includes(first) ? 1 : 0));
    return rankEntries('first-word', candidates, raw);
  },
};

const ctxFor = (msg: string): InjectionContext => ({
  iteration: 1,
  userMessage: msg,
  history: [],
  activatedInjectionIds: [],
});

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // ── 1) The no-embedder router: .entryBy(keywordScorer()) ──
  const keywordGraph = skillGraph()
    .entry(triage)
    .entry(billing)
    .entry(incident)
    .entryBy(keywordScorer())
    .build();

  const scoreOf = async (g: typeof keywordGraph, msg: string) => {
    const s = await g.scoreEntries!(ctxFor(msg));
    return {
      scorer: s.scorer,
      chosen: s.chosen,
      ranked: s.ranked.map((r) => ({ id: r.id, relevance: Number(r.relevance.toFixed(3)) })),
    };
  };

  const keywordRouting = {
    'I want a refund on my last payment': await scoreOf(keywordGraph, 'I want a refund on my last payment'),
    'the website is down with errors': await scoreOf(keywordGraph, 'the website is down with errors'),
    'how do I get started': await scoreOf(keywordGraph, 'how do I get started'),
  };

  // ── 2) Same builder, semantic scorer — just swap the strategy ──
  const embeddingGraph = skillGraph()
    .entry(triage).entry(billing).entry(incident)
    .entryBy(embeddingScorer(mockEmbedder()))
    .build();
  const embeddingPick = await scoreOf(embeddingGraph, input);

  // ── 3) A custom scorer in the same slot ──
  const customGraph = skillGraph()
    .entry(triage).entry(billing).entry(incident)
    .entryBy(firstWordScorer)
    .build();
  const customPick = await scoreOf(customGraph, input);

  // ── 4) A live run: the snapshot carries the ranking AND which scorer ran ──
  const agent = Agent.create({ provider: provider ?? mock({ reply: 'Done.' }), model: 'mock', maxIterations: 3 })
    .system('You are a support assistant.')
    .skillGraph(keywordGraph)
    .build();
  const answer = await agent.run({ message: input });
  const snap = agent.getLastSnapshot()?.sharedState as { entryScores?: unknown; entryScorer?: string };

  return {
    mermaid: keywordGraph.toMermaid(),
    keywordRouting, //           which entry each message routes to (no embedder)
    embeddingPick, //            same graph, embeddingScorer — note scorer: 'embedding'
    customPick, //               a bring-your-own EntryScorer — note scorer: 'first-word'
    liveScorer: snap?.entryScorer, // the scorer the live run used ('keyword') — for the Why-panel
    liveEntryScores: snap?.entryScores,
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}

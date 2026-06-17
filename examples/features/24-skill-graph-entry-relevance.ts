/**
 * 24 — Skill graph: relevance entry routing (`entryByRelevance`).
 *
 * Instead of picking the starting skill with regex (`.entry(skill, { when })`),
 * pick it by MEANING: embed the user's message + each entry skill's `description`,
 * cosine-score, softmax → start at the best match. LLM-free (an embedder, no extra
 * model call), reproducible given the embedder, and the `relevance` % powers the
 * "Why this skill?" panel. Under `entryByRelevance` the entries are EXCLUSIVE —
 * only the picked one loads (token-efficient).
 *
 * Here three entries — triage / billing / incident — and the relevance scorer
 * routes "I want a refund" to billing, "the site is down" to incident, etc., all
 * with no regex and no extra LLM call. (Demo uses the deterministic mockEmbedder;
 * swap in a real embedder in production.)
 *
 * Run:  npx tsx examples/features/24-skill-graph-entry-relevance.ts
 */

import {
  Agent,
  defineSkill,
  mock,
  mockEmbedder,
  skillGraph,
  type CombinedRecorder,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/24-skill-graph-entry-relevance',
  title: 'Skill graph — relevance entry routing (entryByRelevance)',
  group: 'features',
  description:
    'Pick the starting skill by embedding-similarity to the message (softmax over each entry description) instead of regex — LLM-free, reproducible, with relevance % for the Why-panel. Only the picked entry loads.',
  defaultInput: 'I want a refund on my last payment',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'routing', 'graph', 'relevance', 'embedding'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const embedder = mockEmbedder(); // deterministic char-frequency; swap for a real one

  const triage = defineSkill({ id: 'triage', description: 'general questions and how-to help', body: 'Triage it.' });
  const billing = defineSkill({ id: 'billing', description: 'payments, invoices and refunds', body: 'Handle billing.' });
  const incident = defineSkill({ id: 'incident', description: 'outages, downtime and errors', body: 'Handle the incident.' });

  const graph = skillGraph()
    .entry(triage)
    .entry(billing)
    .entry(incident)
    .entryByRelevance(embedder)
    .build();

  // Score a few messages WITHOUT running the agent (pure, off-loop).
  const scoreOf = async (msg: string) => {
    const s = await graph.scoreEntries!({
      iteration: 1,
      userMessage: msg,
      history: [],
      activatedInjectionIds: [],
    });
    return {
      chosen: s.chosen,
      ranked: s.ranked.map((r) => ({ id: r.id, relevance: Number(r.relevance.toFixed(3)) })),
    };
  };
  const routing = {
    'I want a refund on my last payment': await scoreOf('I want a refund on my last payment'),
    'the website is down with errors': await scoreOf('the website is down with errors'),
    'how do I get started': await scoreOf('how do I get started'),
  };

  // A live run: only the picked entry activates (entries are exclusive here).
  const activated = new Set<string>();
  const recorder: CombinedRecorder = {
    id: 'capture',
    onEmit: (e) => {
      if (e.name === 'agentfootprint.context.evaluated') {
        for (const id of (e.payload as { activeIds?: string[] }).activeIds ?? []) activated.add(id);
      }
    },
  };
  const agent = Agent.create({ provider: provider ?? mock({ reply: 'Done.' }), model: 'mock', maxIterations: 3 })
    .system('You are a support assistant.')
    .skillGraph(graph)
    .recorder(recorder)
    .build();
  const answer = await agent.run({ message: input });

  // The relevance ranking the PickEntry stage recorded for the live run.
  const entryScores = (agent.getLastSnapshot()?.sharedState as { entryScores?: unknown })?.entryScores;

  return {
    mermaid: graph.toMermaid(),
    routing, //          which entry each message routes to + the relevance %s
    activatedForInput: [...activated].sort(), // only the picked entry (+ none else)
    entryScores, //      the ranking recorded on the snapshot (Why-panel %)
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}

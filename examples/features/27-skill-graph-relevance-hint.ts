/**
 * 27 — Skill graph: defineRelevanceHint (advisory note on an ambiguous entry).
 *
 * WHY THIS EXISTS:
 * `entryByRelevance()` picks the starting skill by meaning — but when its top two
 * candidates are a NEAR-TIE, the auto-pick is shaky. `defineRelevanceHint()` drops a
 * NON-binding note into the system prompt for that turn ("a keyword scorer ranked
 * these close; it can't see the conversation — use your judgment"). Anti-anchoring is
 * the point: the proxy is a rough match, not the model's reasoning, so it's a hint,
 * never an order — and it ONLY fires on a real tie, at turn start. It reads
 * `ctx.entryScores` and rides the normal injection path (no new event).
 *
 * Run:  npx tsx examples/features/27-skill-graph-relevance-hint.ts
 */

import { Agent, type CombinedRecorder, type LLMProvider } from '../../src/index.js'
import { defineSkill, defineRelevanceHint, skillGraph } from '../../src/injection-engine.js'
import { mock } from '../../src/llm-providers.js'
import { mockEmbedder } from '../../src/memory/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/27-skill-graph-relevance-hint',
  title: 'Skill graph — defineRelevanceHint (advisory entry note)',
  group: 'features',
  description:
    'When entryByRelevance picks the start skill but its top entries are a near-tie, defineRelevanceHint injects a non-binding, anti-anchoring note for that turn ("a keyword scorer ranked these close — use your judgment"). Reads ctx.entryScores; rides context.evaluated, no new event.',
  defaultInput: 'something genuinely ambiguous between two skills',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'graph', 'relevance', 'entry'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const billing = defineSkill({ id: 'billing', description: 'payments and refunds', body: 'billing' });
  const incident = defineSkill({ id: 'incident', description: 'outages and errors', body: 'incident' });

  // mockEmbedder is a crude char-frequency stub, so its scores are nearly tied — which
  // is exactly the near-tie the hint is built for (a real embedder separates clear cases).
  const graph = skillGraph().entry(billing).entry(incident).entryByRelevance(mockEmbedder()).build();

  const activeByIteration: string[][] = [];
  const recorder: CombinedRecorder = {
    id: 'capture',
    onEmit: (e) => {
      if (e.name === 'agentfootprint.context.evaluated') {
        activeByIteration.push([...((e.payload as { activeIds?: string[] }).activeIds ?? [])]);
      }
    },
  };

  const agent = Agent.create({ provider: provider ?? mock({ reply: 'Done.' }), model: 'mock', maxIterations: 2 })
    .system('You are a support assistant.')
    .skillGraph(graph)
    .instruction(defineRelevanceHint({ threshold: 0.15 })) // add the hint explicitly
    .recorder(recorder)
    .build();
  const answer = await agent.run({ message: input });

  // The relevance ranking the PickEntry stage recorded (the "Why this skill?" %).
  const entryScores = (agent.getLastSnapshot()?.sharedState as { entryScores?: unknown })?.entryScores;

  return {
    // The hint fires at TURN START (iteration 1) because the entries are a near-tie:
    activeAtTurnStart: activeByIteration[0], // includes 'relevance-hint' alongside the picked entry
    hintFired: (activeByIteration[0] ?? []).includes('relevance-hint'),
    entryScores, // [{ id, cosine, relevance }] — the near-tie that triggered it
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}

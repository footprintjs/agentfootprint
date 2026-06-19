/**
 * 28 — Skill graph: LLM-read entry routing (entryByRead) — no embedder.
 *
 * When you have MULTIPLE entry skills, how does a turn pick where to start?
 *   • `.entry(a).entry(b)`            → both load every turn (a persistent base).
 *   • `.entryByRelevance(embedder)`   → an embedder cosine-ranks the menu (needs an embedder).
 *   • `.entryByRead()`  ← THIS        → the agent's OWN LLM reads the menu and picks. No
 *                                       embedder, no extra model call, routes on real intent.
 *
 * Like entryByRelevance, the entries are EXCLUSIVE — only the chosen one loads
 * (token-efficient). But the choice is the model's: on the first turn NO entry body
 * is injected; the agent is offered the entries via `read_skill`, and its pick
 * becomes the cursor. Use this when embeddings aren't available, or route poorly for
 * your domain's language — the LLM understands the request better than cosine geometry.
 *
 * The graph:
 *   START ┄┄(read_skill)┄┄▶ billing     ("payments and refunds")
 *   START ┄┄(read_skill)┄┄▶ incident    ("production outages")
 *
 * Here the user reports an outage. `billing` is declared FIRST (so the old default
 * would have auto-loaded it), but the model reads the menu and picks `incident` —
 * proving the entry is the model's choice, not the first declaration.
 *
 * Run:  npx tsx examples/features/28-skill-graph-entry-read.ts
 */

import {
  Agent,
  defineSkill,
  mock,
  skillGraph,
  type CombinedRecorder,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/28-skill-graph-entry-read',
  title: 'Skill graph — LLM-read entry routing (entryByRead, no embedder)',
  group: 'features',
  description:
    'With multiple entry skills and no embedder, .entryByRead() lets the agent’s own LLM read the entry menu and pick the start skill via read_skill. Entries stay exclusive (only the pick loads); the first turn injects no entry body.',
  defaultInput: 'the production database is down',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'routing', 'graph', 'read_skill', 'entry'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const billing = defineSkill({
    id: 'billing',
    description: 'payments, invoices and refunds',
    body: 'Handle the billing question.',
  });
  const incident = defineSkill({
    id: 'incident',
    description: 'production outages and incident triage',
    body: 'Triage the incident.',
  });

  // No embedder — the LLM reads the menu and picks. billing is declared first.
  const graph = skillGraph().entry(billing).entry(incident).entryByRead().build();

  // At cold start the read_skill gate offers exactly the entries (the menu).
  const entryMenu = [...graph.reachableSkills(undefined)]; // ['billing', 'incident']

  // Capture which skill body actually loaded each turn (off the live emit stream).
  const activePerTurn: string[][] = [];
  const recorder: CombinedRecorder = {
    id: 'capture',
    onEmit: (e) => {
      if (e.name === 'agentfootprint.context.evaluated') {
        activePerTurn.push([...((e.payload as { activeIds?: string[] }).activeIds ?? [])]);
      }
    },
  };

  // The model reads the menu and picks `incident` (the outage skill), then answers.
  // A real provider does this from the read_skill tool's description; the mock scripts it.
  let i = 0;
  const scripted =
    provider ??
    mock({
      respond: () => {
        i++;
        if (i === 1)
          return {
            content: 'This is an outage — reading the incident skill.',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'incident' } }],
            stopReason: 'tool_use',
          };
        return {
          content: 'Incident acknowledged; paging on-call.',
          toolCalls: [],
          stopReason: 'stop',
        };
      },
    });

  const agent = Agent.create({ provider: scripted, model: 'mock', maxIterations: 4 })
    .system('You are a support router. If no skill is active, pick the best one with read_skill.')
    .skillGraph(graph)
    .recorder(recorder)
    .build();

  const answer = await agent.run({ message: input });

  return {
    mermaid: graph.toMermaid(),
    entryMenu, //                       what read_skill offered at cold start
    firstTurnActive: activePerTurn[0], // [] — no entry body before the model picks
    everActive: [...new Set(activePerTurn.flat())].sort(), // ['incident'] — only the pick loaded
    billingAutoLoaded: activePerTurn.flat().includes('billing'), // false — first-declared, not auto-loaded
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}

/**
 * 15 — Intents-as-data + the turn-start routing cascade (SG-C, 9.17.0).
 *
 * A support-desk graph declares WHAT each skill is for as DATA —
 * `match: { intent, examples }` — and one classifier judges every new
 * message against them, off the hot loop, once per turn:
 *
 *   tier 1  declared rules (regex / keywords) — binary, decisive
 *   tier 2  the classifier over the declared intents — floor + near-tie
 *           margin; a near-tie FALLS THROUGH instead of coin-flipping
 *   tier 3  a menu through read_skill's own description; the model picks
 *           (or stays) — under `strictness: 'guard'` ONLY from that menu
 *
 * `continuity: 'conversation'` makes the cursor ride the conversation
 * checkpoint: `followUp()` starts where the last turn ended (a sticky
 * default the new message can still decisively beat — never a lock).
 *
 * Every verdict lands on `agentfootprint.skill.turn_routed` with the losers'
 * numbers and the exact thresholds that judged them — this example prints
 * them, because the record IS the feature.
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import { defineSkill, skillGraph, keywordScorer } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/15-skill-graph-intents',
  title: 'Intents-as-data — the turn-start routing cascade',
  group: 'context-engineering',
  description:
    "Declare each skill's intent + real example phrasings as data; one " +
    'classifier routes every turn (rules → scorer → menu), the conversation ' +
    'keeps its place across followUp(), and every verdict — winners, losers, ' +
    'thresholds — is on the record as skill.turn_routed.',
  defaultInput: 'I was charged twice — refund my order please',
  providerSlots: ['default'],
  tags: ['context-engineering', 'skill-graph', 'routing', 'showcase'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const billing = defineSkill({
    id: 'billing',
    description: 'Refunds, double charges, invoices.',
    body: 'Billing playbook: confirm the order id, then check the charge history.',
  });
  const shipping = defineSkill({
    id: 'shipping',
    description: 'Parcel tracking and delivery windows.',
    body: 'Shipping playbook: ask for the tracking number first.',
  });

  // WHAT each skill is for, as DATA the check-up can audit and the record can
  // quote — an intent sentence + phrasings real users typed.
  // #region cascade
  const graph = skillGraph({
    skills: [billing, shipping],
    start: {
      rules: [
        {
          use: 'billing',
          match: {
            intent: 'customer wants a refund',
            examples: ['refund my order', 'charged twice'],
          },
        },
        {
          use: 'shipping',
          match: {
            intent: 'customer asks where a delivery is',
            examples: ['track my parcel', 'where is my order delivery'],
          },
        },
      ],
      // The judge. keywordScorer needs no dependency and can honestly say
      // "unmatched" (zero overlap = floor). Swap in embeddingScorer(embedder)
      // for semantics, or llmClassifier(provider, { model }) for a model judge.
      classify: keywordScorer(),
    },
  });

  const verdicts: string[] = [];
  const agent = Agent.create({ provider: provider ?? scriptedProvider(), model: 'demo' })
    .system('You are a support agent. Be brief.')
    .skillGraph(graph, {
      // The cursor rides the conversation checkpoint: followUp() starts where
      // the last turn ended — sticky default, decisively beatable.
      continuity: 'conversation',
      // The model may route itself ONLY when the router declared ambiguity
      // (an offered menu); everything else routes by rule/scorer.
      strictness: 'guard',
    })
    .watch({
      id: 'print-verdicts',
      onEmit: (e: { name: string; payload?: unknown }) => {
        if (e.name !== 'agentfootprint.skill.turn_routed') return;
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const scores = (p.scores as ReadonlyArray<{ id: string; relevance: number }> | undefined)
          ?.map((s) => `${s.id} ${(s.relevance * 100).toFixed(0)}%`)
          .join(', ');
        verdicts.push(
          `turn_routed by=${String(p.by)}${p.from ? ` from=${String(p.from)}` : ''}${
            p.to ? ` to=${String(p.to)}` : ''
          }${scores ? ` [${scores}]` : ''}`,
        );
      },
    })
    .build();
  // #endregion cascade

  // Turn 1: decisively a refund → the cascade enters `billing` (by: 'intent').
  const first = await agent.run({ message: input });
  // Turn 2: a follow-up on the same topic → the inherited cursor holds
  // (by: 'continuity') — no re-routing, no re-classifying the conversation.
  const second = await agent.followUp('thanks — same refund, one more question');

  return [
    `turn 1: ${first}`,
    `turn 2: ${second}`,
    '',
    'recorded verdicts:',
    ...verdicts.map((v) => `  ${v}`),
  ].join('\n');
}

/** Deterministic offline provider so the example runs with zero setup. */
function scriptedProvider(): LLMProvider {
  return mock({
    respond: () => ({ content: 'Handled.', toolCalls: [], stopReason: 'stop' as const }),
  });
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}

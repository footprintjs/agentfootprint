/**
 * 26 — What the localizer's verdicts add up to: `report.conclusion`.  [BETA]
 *
 * Reading "which items flipped the answer" one at a time can mislead in two ways:
 *   - a model's own mistake can make several true facts look guilty, because
 *     removing a fact it needs flips the answer;
 *   - two causes that are each enough alone hide each other, because removing
 *     either one changes nothing.
 *
 * The same refunds agent runs three bugs here, and the report's `conclusion`
 * reads each one: one cause, a pair of causes, and no single cause.
 *
 * Offline + deterministic: the mock provider answers from the facts it receives.
 *
 * Run:  npx tsx examples/observability/26-localize-conclusion.ts
 */

import { Agent } from '../../src/index.js';
import { defineFact } from '../../src/doors/context.js';
import { mockEmbedder } from '../../src/doors/memory.js';
import {
  applyAblations,
  embeddingCache,
  llmCallIdsFromEvents,
  localizeContextBug,
  type AblationSpec,
  type CapturedEventLike,
  type ContextBugConclusion,
} from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/26-localize-conclusion',
  title: "Read what a localizer report's verdicts add up to (BETA)",
  group: 'observability',
  description:
    'Three bugs in one refunds agent, read by report.conclusion: one planted fact is named as ' +
    'the one cause, two facts that are each enough alone are found as a pair, and a mistake ' +
    'that several true facts appear to cause is reported as no single cause.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'debugging', 'context-bug', 'ablation', 'beta'],
};

const FACTS = {
  window: 'The order is within the 30-day refund window.',
  receipt: 'The customer has the receipt.',
  sealed: 'The item is still sealed.',
  fraud: 'This account was banned from refunds for fraud.',
  resold: 'The serial number shows the item was resold.',
} as const;
type FactId = keyof typeof FACTS;

const DECLINE = 'DECISION: DECLINE';
const APPROVE = 'DECISION: APPROVE';

/** Run the agent with these facts, minus anything a probe removed. */
async function runAgent(
  factIds: readonly FactId[],
  decide: (present: ReadonlySet<FactId>) => string,
  specs: readonly AblationSpec[] = [],
) {
  const { injections } = applyAblations(specs, {
    tools: [],
    injections: factIds.map((id) =>
      defineFact({ id, description: `Fact: ${id}`, data: FACTS[id] }),
    ),
  });
  const provider = mock({
    respond: (req) =>
      decide(new Set(factIds.filter((id) => (req.systemPrompt ?? '').includes(FACTS[id])))),
  });
  let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 2 }).system(
    'You decide refunds.',
  );
  for (const injection of injections) builder = builder.fact(injection);
  const agent = builder.build();
  const events: CapturedEventLike[] = [];
  agent.on('*', (event) => events.push(event as CapturedEventLike));
  const out = await agent.run({ message: 'Decide this refund.' });
  const content =
    typeof out === 'object' && out !== null && 'content' in out
      ? String((out as { content: unknown }).content)
      : String(out);
  return { content, snapshot: agent.getLastSnapshot()!, events };
}

async function conclude(
  factIds: readonly FactId[],
  decide: (present: ReadonlySet<FactId>) => string,
): Promise<ContextBugConclusion> {
  const original = await runAgent(factIds, decide);
  const llmIds = llmCallIdsFromEvents(original.events);
  // #region conclusion
  const report = await localizeContextBug({
    artifacts: { snapshot: original.snapshot, events: original.events },
    embedder: embeddingCache(mockEmbedder()),
    atStep: llmIds[llmIds.length - 1],
    rerun: {
      runner: async (specs) => (await runAgent(factIds, decide, specs)).content,
      originalOutput: original.content,
      samples: 3,
      outcomeChanged: (a, b) => a !== b,
    },
  });

  const { kind, named, statement } = report.conclusion!;
  console.log(kind, named.map((suspect) => suspect.detail?.injectionId));
  console.log(statement);
  // #endregion conclusion
  return report.conclusion!;
}

export async function run(_input?: string | null): Promise<readonly ContextBugConclusion[]> {
  const all: readonly FactId[] = ['window', 'receipt', 'sealed'];

  console.log('--- One planted fact makes it decline');
  const one = await conclude(['fraud', ...all], (p) => (p.has('fraud') ? DECLINE : APPROVE));

  console.log('\n--- Two planted facts, each enough alone. With no facts at all, it declines too');
  const pair = await conclude(['fraud', 'resold', ...all], (p) =>
    p.size === 0 || p.has('fraud') || p.has('resold') ? DECLINE : APPROVE,
  );

  console.log('\n--- Only true facts, and the model approves when it should have declined');
  const none = await conclude(all, (p) => (p.size === all.length ? APPROVE : DECLINE));

  if (one.kind !== 'one-cause' || pair.kind !== 'redundant-pair' || none.kind !== 'no-single-cause') {
    throw new Error(`unexpected conclusions: ${one.kind}, ${pair.kind}, ${none.kind}`);
  }
  return [one, pair, none];
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

/**
 * 03 — Summarize strategy: one LLM call compresses older turns, and the
 * summary is stored so the call is never paid twice.
 *
 * The "Context Janitor" pattern from Ch 7 of AI Agents: The Definitive Guide.
 * Recent N entries stay raw; everything older is folded into one summary entry
 * written back to the same store. Pairs with a cheap summarizer model
 * (haiku-class) — which is why the model is named explicitly.
 *
 * Wired in 9.14.0. Before that this example passed a summarizer that was never
 * called: the strategy loaded the last `recent` entries and stopped.
 */

import { Agent, type LLMProvider } from '../../src/index.js'
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES, InMemoryStore } from '../../src/doors/memory.js'
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/03-summarize-strategy',
  title: 'Summarize strategy — one call folds older turns, and it is stored',
  group: 'memory',
  description:
    'Long-conversation compaction: keep the most recent entries raw, fold ' +
    'everything older into ONE stored summary. The originals are kept — the ' +
    'summary excludes them from recall, it does not delete them.',
  defaultInput: 'What were the main topics we covered today?',
  providerSlots: ['default'],
  tags: ['memory', 'episodic', 'summarize', 'long-conversation', 'smart'],
};

/** Wraps a provider so the example can PROVE the summarizer really ran. */
function counted(provider: LLMProvider): { provider: LLMProvider; calls: () => number } {
  let calls = 0;
  return {
    provider: {
      ...provider,
      name: provider.name,
      complete: async (req, hooks) => {
        calls += 1;
        return provider.complete(req, hooks);
      },
    },
    calls: () => calls,
  };
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const store = new InMemoryStore();

  // A cheap, SEPARATE summarizer. Its own instance and its own model id:
  // `Agent.memory()` refuses the agent's own instance at the agent's own model,
  // because those two calls look identical and are not (the agent's runs
  // through reliability, decorators and the cache; this one runs through none).
  const summarizer = counted(
    mock({ reply: 'Earlier: billing update requested, email changed, refund for last month raised.' }),
  );

  // #region define
  const memory = defineMemory({
    id: 'long-chat',
    type: MEMORY_TYPES.EPISODIC,
    strategy: {
      kind: MEMORY_STRATEGIES.SUMMARIZE,
      recent: 4,                 // the 4 newest entries stay verbatim
      size: 12,                  // load 12 per turn — the pool a fold comes from
      llm: summarizer.provider,  // a dedicated cheap model…
      model: 'mock-haiku',       // …named explicitly: no fallback to the agent's
    },
    store,
  });
  // #endregion define

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'We covered billing, email, and a refund request.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a helpful assistant who remembers long conversations.')
    .memory(memory)
    .build();

  const identity = { conversationId: 'long-chat-demo' };
  // A conversation long enough that the load window fills and the oldest
  // entries fall out of the verbatim tail — which is when a fold is worth its
  // call.
  const conversation = [
    'I want to update the billing information on my account, because the card you have on file expired last week.',
    'While we are here, please change my email address to the new one I use for work, and send receipts there too.',
    'Can I still get a refund for last month? The invoice total does not match what the dashboard showed me.',
    'The dashboard showed three seats for the whole month and the invoice charged me for five of them.',
    'Does the refund go back to the expired card or to the new one I just added a few minutes ago?',
    'One more thing: please confirm the billing contact is still my manager and not the old admin.',
    'And can you tell me which of these changes take effect immediately versus on the next cycle?',
  ];
  for (const message of conversation) {
    await agent.run({ message, identity });
  }

  const result = await agent.run({ message: input, identity });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');

  // ── What this example is really demonstrating ────────────────────
  // The 9.5.0 version of this file passed a summarizer that was never called.
  // These checks are the difference, and they fail loudly if it regresses.
  const { entries } = await store.list(identity, { limit: 100 });
  const summaries = entries.filter((e) => e.id.startsWith('msg-summary-'));
  if (summarizer.calls() === 0) {
    throw new Error('the summarizer was never called — the strategy is not compressing anything');
  }
  if (summaries.length === 0) {
    throw new Error('no summary was written back — the fold would be paid for again every turn');
  }
  const covered = new Set(
    summaries.flatMap((s) => (s.metadata?.summarizes as { coveredIds: string[] }).coveredIds),
  );
  for (const id of covered) {
    if (!entries.some((e) => e.id === id)) {
      throw new Error(`summarized-away entry ${id} was deleted — the originals must be kept`);
    }
  }

  console.log(
    `\n[summarize] ${summarizer.calls()} summarizer call(s); ` +
      `${summaries.length} stored summary entr(ies) covering ${covered.size} messages; ` +
      `all ${covered.size} originals still in the store.`,
  );
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}

/**
 * 11 — Decay strategy: old memory fades, recent memory stays.
 *
 * Window keeps the last N turns whatever their age. Decay asks a different
 * question — "is this still worth remembering?" — and answers it with a
 * half-life: every loaded entry is scored `2^(-age / halfLife)` and dropped
 * below `minScore`, before the budget picker ever sees it.
 *
 * The store here is seeded by hand with two turns of very different ages,
 * so the demonstration is arithmetic rather than a wait: one is 30 days
 * old, one is a minute old, and the half-life is a day.
 *
 * No LLM call for the decay itself, no embeddings, no key: the whole
 * strategy is a timestamp and an exponent.
 */

import { Agent, type LLMProvider, type LLMRequest } from '../../src/index.js';
import {
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  InMemoryStore,
  type MemoryEntry,
} from '../../src/doors/memory.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/11-decay-strategy',
  title: 'Decay strategy — old memory fades on a half-life',
  group: 'memory',
  description:
    'Score every recalled entry by age against a half-life and drop what has ' +
    'faded. For long-running agents that should stop rehearsing last month. ' +
    'Free — no LLM, no embeddings.',
  defaultInput: 'Where do I live?',
  providerSlots: ['default'],
  tags: ['memory', 'episodic', 'decay', 'long-running', 'rule-based'],
};

const DAY_MS = 86_400_000;

const STALE = 'I live in Toronto.';
const FRESH = 'I moved to Berlin last week.';

/** A stored turn, dated — exactly the shape the write stage persists. */
function storedTurn(id: string, content: string, writtenAt: number): MemoryEntry {
  return {
    id,
    value: { role: 'user', content },
    version: 1,
    createdAt: writtenAt,
    updatedAt: writtenAt,
    // The decay signal. `lastAccessedAt` is what the score reads.
    lastAccessedAt: writtenAt,
    accessCount: 0,
  };
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const store = new InMemoryStore();
  const identity = { conversationId: 'decay-demo' };
  const now = Date.now();

  // Two turns, 30 days apart. The old one was true when it was written.
  await store.putMany(identity, [
    storedTurn('msg-1-0', STALE, now - 30 * DAY_MS),
    storedTurn('msg-2-0', FRESH, now - 60_000),
  ]);

  // #region define
  const memory = defineMemory({
    id: 'fading',
    description: 'Recall recent turns; let month-old ones fade out.',
    type: MEMORY_TYPES.EPISODIC,
    strategy: {
      kind: MEMORY_STRATEGIES.DECAY,
      halfLifeMs: DAY_MS, // worth half as much every day it goes untouched
      minScore: 0.1, // ~3.3 half-lives — below this it is not injected
    },
    store,
  });
  // #endregion define

  // A thin wrapper so the example can report what the model was ACTUALLY
  // handed, rather than assert what it should have been.
  const base = provider ?? mock({ reply: 'You live in Berlin.' });
  let promptSeen = '';
  const watched: LLMProvider = {
    ...base,
    complete: (request: LLMRequest) => {
      promptSeen += request.systemPrompt ?? '';
      return base.complete(request);
    },
  };

  const agent = Agent.create({ provider: watched, model: 'mock', maxIterations: 1 })
    .system('You are a helpful assistant. Answer from what you remember.')
    .memory(memory)
    .build();

  const result = await agent.run({ message: input, identity });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');

  const recalledFresh = promptSeen.includes(FRESH);
  const recalledStale = promptSeen.includes(STALE);

  return [
    result,
    '',
    `recalled (1 minute old, score ≈ 1.00): ${recalledFresh ? 'yes' : 'no'} — "${FRESH}"`,
    `faded    (30 days old, score ≈ 1e-9): ${recalledStale ? 'yes' : 'no'} — "${STALE}"`,
    '',
    'Nothing was deleted: both turns are still in the store, and a shorter',
    'half-life or a lower floor would let the old one back in.',
  ].join('\n');
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}

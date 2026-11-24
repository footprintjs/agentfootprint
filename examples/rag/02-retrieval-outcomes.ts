// Run with `npm run example examples/rag/02-retrieval-outcomes.ts`.
import assert from 'node:assert/strict';
import {
  InMemoryStore,
  memoryRecallOutcomesKey,
  mockEmbedder,
  type MemoryIdentity,
  type MemoryReadOutcome,
  type MemoryRecallOutcome,
  type SearchOptions,
  type SearchResultEntry,
} from '../../src/doors/memory.js';
import { mock } from '../../src/doors/providers.js';
import { Agent, defineRAG, indexDocuments } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'rag/02-retrieval-outcomes',
  title: 'Tell an empty search from a retrieval timeout',
  group: 'rag',
  description:
    'A mock run compares successful empty recall, a typed timeout, and IDs-only evidence.',
  defaultInput: 'How long do refunds take?',
  providerSlots: [],
  tags: ['rag', 'retrieval', 'recording'],
};

// #region outcome-aware-store
class DemoStore extends InMemoryStore {
  constructor(private readonly timesOut: boolean) {
    super();
  }

  async searchWithOutcome<T>(
    identity: MemoryIdentity,
    query: readonly number[],
    options?: SearchOptions,
  ): Promise<MemoryReadOutcome<readonly SearchResultEntry<T>[]>> {
    if (this.timesOut) return { ok: false, code: 'timeout' };
    return { ok: true, value: await super.search<T>(identity, query, options) };
  }
}
// #endregion outcome-aware-store

const reply = 'I can share general refund guidance.';
const passage = 'Refunds are processed within three business days.';

async function answer(input: string, timesOut: boolean, seedCorpus = false) {
  const store = new DemoStore(timesOut);
  const embedder = mockEmbedder();
  if (seedCorpus) {
    await indexDocuments(store, embedder, [{ id: 'refund-policy', content: passage }]);
  }

  // #region ids-only
  const agent = Agent.create({ provider: mock({ reply }), model: 'mock' })
    .rag(
      defineRAG({
        id: 'support-docs',
        store,
        embedder,
        threshold: -1,
        recording: 'ids-only',
      }),
    )
    .build();
  // #endregion ids-only

  const attached: { id: string; summary: string }[] = [];
  agent.on('agentfootprint.memory.attached', ({ payload }) => {
    attached.push({ id: payload.memoryId, summary: payload.contentSummary });
  });
  try {
    const text = await agent.run({ message: input });
    assert.ok(typeof text === 'string', 'A mock answer must finish without a pause.');
    // #region read-outcomes
    const state = agent.getSnapshot()?.sharedState;
    const turn = state?.turnNumber;
    const saved = state?.[memoryRecallOutcomesKey('support-docs')];
    const recall =
      typeof turn === 'number' && Array.isArray(saved)
        ? (saved as readonly MemoryRecallOutcome[]).filter(
            (outcome) => outcome?.turnNumber === turn,
          )
        : undefined;
    // #endregion read-outcomes
    return { text, attached, recall };
  } finally {
    await agent.shutdown();
  }
}

export async function run(input: string): Promise<string> {
  const empty = await answer(input, false);
  const timeout = await answer(input, true);
  const success = await answer(input, false, true);

  assert.equal(empty.text, reply);
  assert.equal(empty.recall?.[0]?.kind, 'ok');
  assert.equal(empty.recall?.[0]?.candidateCount, 0);
  assert.match(timeout.text, /timed out/i);
  assert.equal(timeout.recall?.[0]?.kind, 'timeout');
  assert.equal(timeout.recall?.[0]?.candidateCount, undefined);
  assert.equal(timeout.attached.length, 0);
  assert.equal(success.text, reply);
  assert.deepEqual(
    success.attached.map(({ id }) => id),
    ['refund-policy'],
  );
  assert.ok(success.attached.every(({ summary }) => !summary.includes(passage)));

  return [
    `Search returned zero matches\n${empty.text}`,
    `Search timed out\n${timeout.text}`,
    `Search received a match\n${success.text}\nRecorded source: ${success.attached[0].id}`,
  ].join('\n\n');
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

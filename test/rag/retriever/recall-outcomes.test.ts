import { describe, expect, it, vi } from 'vitest';
import { commitValueAt } from 'foottrace';
import { Agent, defineRAG, defineTool, isPaused, pauseHere } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/observe.js';
import type { TypedScope } from 'footprintjs';
import { memoryRecallInjections } from '../../../src/core/agent/memoryRecallInjections.js';
import { loadRelevant } from '../../../src/memory/embedding/loadRelevant.js';
import { loadRecent } from '../../../src/memory/stages/loadRecent.js';
import { filterByDecay } from '../../../src/memory/stages/filterByDecay.js';
import { formatDefault } from '../../../src/memory/stages/formatDefault.js';
import type { MemoryState } from '../../../src/memory/stages/types.js';
import { InMemoryStore } from '../../../src/memory/store/InMemoryStore.js';
import { readMemoryList, readMemorySearch } from '../../../src/memory/store/readOutcome.js';
import { bindWriteOptions } from '../../../src/memory/store/writeOptions.js';

const identity = { conversationId: 'docs' };
const passages = [
  {
    id: 'a',
    value: {
      role: 'user',
      content: 'café 🐾',
      metadata: { docUri: 'private/uri', heading: 'Private heading', page: 5 },
    },
    updatedAt: 1,
    lastAccessedAt: 0,
  },
  {
    id: 'b',
    value: { role: 'user', content: '𐐷 火', metadata: { heading: 'Second heading' } },
    updatedAt: 2,
    lastAccessedAt: 10_000,
  },
] as const;

function state(signal?: AbortSignal): TypedScope<MemoryState> {
  return {
    identity,
    turnNumber: 7,
    $getEnv: () => ({ signal }),
  } as unknown as TypedScope<MemoryState>;
}

describe('retrieval read outcomes', () => {
  it('selects structured search once and distinguishes a timeout from a successful empty read', async () => {
    const search = vi.fn(async () => []);
    const searchWithOutcome = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'timeout' })
      .mockResolvedValueOnce({ ok: true, value: [] });
    const store = Object.assign(new InMemoryStore(), {
      ranksBy: 'server-text' as const,
      supportsVectorSearch: false as const,
      search,
      searchWithOutcome,
    });
    const load = loadRelevant({ store, queryFrom: () => 'query' });
    const timedOut = state();
    const empty = state();
    await load(timedOut);
    await load(empty);
    expect(search).not.toHaveBeenCalled();
    expect(searchWithOutcome.mock.contexts).toEqual([store, store]);
    expect(searchWithOutcome).toHaveBeenCalledWith(identity, [], {
      k: expect.any(Number),
      text: 'query',
    });
    expect(timedOut.recallOutcomes).toEqual([
      expect.objectContaining({ kind: 'timeout', turnNumber: 7, admittedCount: 0 }),
    ]);
    expect(timedOut.recallOutcomes?.[0]).not.toHaveProperty('candidateCount');
    expect(empty.recallOutcomes).toEqual([
      expect.objectContaining({ kind: 'ok', candidateCount: 0, admittedCount: 0 }),
    ]);
  });

  it('preserves the bound namespace, pagination options and method receiver', async () => {
    const search = vi.fn();
    const list = vi.fn();
    const searchWithOutcome = vi.fn().mockResolvedValue({ ok: false, code: 'timeout' });
    const listWithOutcome = vi.fn().mockResolvedValue({ ok: true, value: { entries: [] } });
    const store = Object.assign(new InMemoryStore(), {
      writeOptions: ['namespaceScope'] as const,
      search,
      list,
      searchWithOutcome,
      listWithOutcome,
    });
    const bound = bindWriteOptions(store, {
      namespaceScope: ({ conversationId }) => ({ account: conversationId }),
    });
    await expect(readMemorySearch(bound, identity, [1], { k: 2, text: 'q' })).resolves.toEqual({
      ok: false,
      code: 'timeout',
    });
    await readMemoryList(bound, identity, { cursor: 'next', limit: 2, tiers: ['hot'] });
    expect(searchWithOutcome).toHaveBeenCalledExactlyOnceWith(identity, [1], {
      k: 2,
      text: 'q',
      namespaceScope: { account: 'docs' },
    });
    expect(listWithOutcome).toHaveBeenCalledExactlyOnceWith(identity, {
      cursor: 'next',
      limit: 2,
      tiers: ['hot'],
    });
    expect(searchWithOutcome.mock.contexts).toEqual([store]);
    expect(listWithOutcome.mock.contexts).toEqual([store]);
    expect(search).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('keeps scoreless IDs in store order without assigning scores or testing a floor', async () => {
    const store = Object.assign(new InMemoryStore(), {
      ranksBy: 'server-text' as const,
      supportsVectorSearch: false as const,
      searchWithOutcome: vi
        .fn()
        .mockResolvedValue({ ok: true, value: passages.map((entry) => ({ entry })) }),
    });
    const scope = state();
    await loadRelevant({ store, queryFrom: () => 'query', k: 1, minScore: 0.9 })(scope);
    expect(scope.retrieved?.candidates).toBeUndefined();
    expect(scope.recallOutcomes?.[0]).toMatchObject({
      candidateCount: 2,
      admittedCount: 1,
      exclusions: { 'over-max-entries': 1 },
      candidates: [
        { id: 'a', order: 1 },
        { id: 'b', order: 2, reason: 'over-max-entries' },
      ],
    });
    expect(scope.recallOutcomes?.[0]).not.toHaveProperty('floor');
    expect(scope.recallOutcomes?.[0]?.candidates?.[0]).not.toHaveProperty('score');
  });

  it('lets cancellation win over a structured timeout and preserves thrown failures', async () => {
    const controller = new AbortController();
    const abort = new Error('caller stopped');
    const unknown = new Error('authorization failed');
    const store = Object.assign(new InMemoryStore(), {
      ranksBy: 'server-text' as const,
      supportsVectorSearch: false as const,
      searchWithOutcome: vi
        .fn()
        .mockImplementationOnce(async () => {
          controller.abort(abort);
          return { ok: false, code: 'timeout' };
        })
        .mockRejectedValueOnce(unknown),
    });
    const load = loadRelevant({ store, queryFrom: () => 'query' });
    await expect(load(state(controller.signal))).rejects.toBe(abort);
    await expect(load(state())).rejects.toBe(unknown);
  });

  it('records only applied decay and skips a disabled recent read', async () => {
    const list = vi.fn();
    const listWithOutcome = vi.fn().mockResolvedValue({ ok: true, value: { entries: passages } });
    const store = Object.assign(new InMemoryStore(), { list, listWithOutcome });
    await loadRecent({ store, count: 0 })(state());
    expect(listWithOutcome).not.toHaveBeenCalled();
    const scope = state();
    await loadRecent({ store, count: 2 })(scope);
    await filterByDecay({ halfLifeMs: 100, minScore: 0.5, now: () => 10_000 })(scope);
    expect(list).not.toHaveBeenCalled();
    expect(listWithOutcome).toHaveBeenCalledOnce();
    expect(scope.recallOutcomes?.[0]).toMatchObject({
      candidateCount: 2,
      admittedCount: 1,
      exclusions: { decayed: 1 },
      candidates: [
        { id: 'a', order: 1, reason: 'decayed', floor: 0.5 },
        { id: 'b', order: 2 },
      ],
    });
  });

  it('replays UTF-16 chunk ranges with the same formatted bytes and no duplicate text or coordinates', async () => {
    const store = Object.assign(new InMemoryStore(), {
      ranksBy: 'server-text' as const,
      supportsVectorSearch: false as const,
      searchWithOutcome: vi
        .fn()
        .mockResolvedValue({ ok: true, value: passages.map((entry) => ({ entry, score: 0.9 })) }),
    });
    const recall = async (recording?: 'ids-only') => {
      const scope = state();
      await loadRelevant({ store, queryFrom: () => 'query', ...(recording && { recording }) })(
        scope,
      );
      const initial = JSON.stringify(scope.retrieved);
      scope.selected = [...scope.loaded].reverse();
      await formatDefault({ flavor: 'rag', header: 'préface 🐾', footer: '𐐷 tail' })(scope);
      const parent = structuredClone({
        memoryInjection_docs: scope.formatted,
        retrievalEvidence_docs: scope.retrieved,
      });
      return {
        scope,
        initial,
        injected: memoryRecallInjections(parent, [{ id: 'docs', flavor: 'rag' }]),
      };
    };
    const full = await recall();
    const ids = await recall('ids-only');
    expect(ids.scope.formatted).toEqual(full.scope.formatted);
    expect(ids.injected.map((item) => [item.id, item.retrieval, item.inject])).toEqual(
      full.injected.map((item) => [item.id, item.retrieval, item.inject]),
    );
    expect(ids.injected).toHaveLength(2);
    for (const evidence of [ids.initial, JSON.stringify(ids.scope.retrieved)]) {
      for (const forbidden of [
        'private/uri',
        'Private heading',
        'café',
        '🐾',
        'promptFragment',
        'page',
      ]) {
        expect(evidence).not.toContain(forbidden);
      }
    }
  });
});

it('keeps native and exported retrieval evidence text-free and rebuilds the request on resume', async () => {
  const retrieved = 'agentfootprint.memory.retrieved';
  const attached = 'agentfootprint.memory.attached';
  const inspect = defineTool({
    name: 'confirm_recall',
    description: 'Pause after recalling the two passages.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      pauseHere({});
      return 'confirmed';
    },
  });
  const store = Object.assign(new InMemoryStore(), {
    ranksBy: 'server-text' as const,
    supportsVectorSearch: false as const,
    searchWithOutcome: vi.fn().mockResolvedValue({
      ok: true,
      value: passages.map((entry, i) => ({ entry, score: 0.9 - i * 0.1 })),
    }),
  });

  async function run(recording?: 'ids-only', hideIds = false) {
    const prompts: (string | undefined)[] = [];
    const live: unknown[] = [];
    const agent = Agent.create({
      provider: mock({
        respond: (request) => {
          prompts.push(request.systemPrompt);
          return prompts.length === 1
            ? { content: '', toolCalls: [{ id: 'confirm', name: 'confirm_recall', args: {} }] }
            : { content: 'done', toolCalls: [] };
        },
      }),
      model: 'mock',
      ...(hideIds && {
        redact: {
          keys: [
            'retrieved',
            'recallOutcomes',
            'retrievalEvidence_docs',
            'memoryRecallOutcomes_docs',
          ],
          emitPatterns: [/^agentfootprint\.memory\.(?:attached|retrieved)$/],
        },
      }),
    })
      .rag(defineRAG({ id: 'docs', store, ...(recording && { recording }) }))
      .tool(inspect)
      .build();
    agent.on(retrieved, (event) => live.push(event.payload));
    agent.on(attached, (event) => live.push(event.payload));
    const capture = recordRun(agent);
    const paused = await agent.run({ message: 'recall passages' });
    if (!isPaused(paused)) throw new Error('Expected a native pause after recall');
    const saved = JSON.parse(JSON.stringify(capture.toRecording())) as {
      events: { type: string; payload: unknown }[];
      snapshot: {
        sharedState: Record<string, unknown>;
        commitLog: unknown[];
        subflowResults: Record<
          string,
          {
            treeContext: {
              globalContext: Record<string, unknown>;
              history: unknown[];
            };
          }
        >;
      };
    };
    const beforeResume = agent.getSnapshot()?.sharedState.systemPromptInjections as
      | readonly { sourceId?: string; retrievalScore?: number; rankPosition?: number }[]
      | undefined;
    await expect(
      agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), 'approved'),
    ).resolves.toBe('done');
    const afterResume = agent.getSnapshot()?.sharedState
      .systemPromptInjections as typeof beforeResume;
    const identities = (items: typeof beforeResume) =>
      items
        ?.filter((item) => item.sourceId?.startsWith('memory:docs#'))
        .map(({ sourceId, retrievalScore, rankPosition }) => ({
          sourceId,
          retrievalScore,
          rankPosition,
        }));
    return {
      prompts,
      live,
      saved,
      before: identities(beforeResume),
      after: identities(afterResume),
    };
  }

  const full = await run();
  const ids = await run('ids-only');
  expect(ids.prompts).toEqual(full.prompts);
  expect(ids.prompts).toHaveLength(2);
  expect(ids.prompts[1]).toContain('café 🐾');
  expect(ids.before).toHaveLength(2);
  expect(ids.before).toEqual(full.before);
  expect(ids.after).toEqual(full.after);
  const child = ids.saved.snapshot.subflowResults['sf-memory-read-docs'].treeContext;
  const keptState = [
    ids.saved.snapshot.sharedState.retrievalEvidence_docs,
    child.globalContext.retrieved,
    ...child.history.map((_, i) => commitValueAt(child.history as never, i, 'retrieved')),
  ];
  const eventCopies = [
    ...ids.live,
    ...ids.saved.events
      .filter((event) => event.type === retrieved || event.type === attached)
      .map((event) => event.payload),
  ];
  expect(keptState[0]).toMatchObject({ recording: 'ids-only' });
  expect(eventCopies).toContainEqual(
    expect.objectContaining({ memoryId: 'a', contentSummary: '[REDACTED]' }),
  );
  for (const item of [...keptState, ...eventCopies].filter((value) => value !== undefined)) {
    for (const forbidden of ['private/uri', 'Private heading', 'café', '🐾', 'promptFragment']) {
      expect(JSON.stringify(item)).not.toContain(forbidden);
    }
  }

  const stronger = await run('ids-only', true);
  expect(stronger.prompts).toEqual(ids.prompts);
  expect(stronger.saved.snapshot.sharedState.retrievalEvidence_docs).toMatchObject({
    candidates: 'REDACTED',
    promptRanges: 'REDACTED',
  });
  expect(
    stronger.saved.snapshot.subflowResults['sf-memory-read-docs'].treeContext.globalContext
      .retrieved,
  ).toBe('REDACTED');
  for (const payload of stronger.live) expect(payload).toBe('[REDACTED]');
});

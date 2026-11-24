import { FlowChartExecutor, flowChart, type TypedScope } from 'footprintjs';
import { describe, expect, it, vi } from 'vitest';

import { loadRelevant } from '../../../src/memory/embedding/loadRelevant.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import { filterByDecay } from '../../../src/memory/stages/filterByDecay.js';
import { loadRecent } from '../../../src/memory/stages/loadRecent.js';
import { pickByBudget } from '../../../src/memory/stages/pickByBudget.js';
import type { MemoryState } from '../../../src/memory/stages/types.js';
import { InMemoryStore } from '../../../src/memory/store/InMemoryStore.js';
import type { LLMMessage } from '../../../src/provider-contract/types.js';

const now = 20_000;

function entry(id: string, age: number): MemoryEntry<LLMMessage> {
  const timestamp = now - age;
  return {
    id,
    value: { role: 'user', content: id },
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAccessedAt: timestamp,
    accessCount: 0,
  };
}

async function runDecay(
  load: (scope: TypedScope<MemoryState>) => Promise<void>,
  maxEntries?: number,
): Promise<MemoryState> {
  const stages = flowChart<MemoryState>(
    'Seed',
    (scope) => {
      scope.identity = { conversationId: 'decay' };
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4_000;
    },
    'seed',
  )
    .addFunction('Load', load, 'load')
    .addFunction(
      'Decay',
      filterByDecay({ halfLifeMs: 1_000, minScore: 0.5, now: () => now }),
      'decay',
    );
  const executor = new FlowChartExecutor(pickByBudget({ maxEntries })(stages).build());
  await executor.run();
  return executor.getSnapshot()?.sharedState as MemoryState;
}

describe('decay in a native FootPrint chart', () => {
  it.each([
    { name: 'partial', entries: [entry('fresh', 0), entry('stale', 2_000)], selected: ['fresh'] },
    { name: 'complete', entries: [entry('old', 3_000), entry('stale', 2_000)], selected: [] },
  ])('retains proved counts after $name decay of a recent read', async ({ entries, selected }) => {
    const store = Object.assign(new InMemoryStore(), {
      listWithOutcome: vi.fn().mockResolvedValue({ ok: true, value: { entries } }),
    });
    const state = await runDecay(loadRecent({ store, count: 2 }));

    expect(state.loaded.map(({ id }) => id)).toEqual(selected);
    expect(state.selected.map(({ id }) => id)).toEqual(selected);
    const [outcome] = state.recallOutcomes ?? [];
    expect(outcome).toMatchObject({
      kind: 'ok',
      candidateCount: 2,
      admittedCount: selected.length,
      complete: true,
    });
    expect(outcome?.exclusions).toEqual({ decayed: 2 - selected.length });
    expect(outcome?.candidates?.filter(({ admitted }) => admitted).map(({ id }) => id)).toEqual(
      selected,
    );
  });

  it.each([
    { mode: 'full', age: 0, admittedCount: 1 },
    { mode: 'ids-only', age: 0, admittedCount: 1 },
    { mode: 'full', age: 2_000, admittedCount: 0 },
    { mode: 'ids-only', age: 2_000, admittedCount: 0 },
  ] as const)(
    'keeps duplicate IDs ambiguous with $admittedCount survivors in $mode recording',
    async ({ mode, age, admittedCount }) => {
      const store = Object.assign(new InMemoryStore(), {
        ranksBy: 'server-text' as const,
        supportsVectorSearch: false as const,
        searchWithOutcome: vi.fn().mockResolvedValue({
          ok: true,
          value: [
            { entry: entry('same', 3_000), score: 0.9 },
            { entry: entry('same', age), score: 0.8 },
          ],
        }),
      });
      const recording = mode === 'ids-only' ? { recording: 'ids-only' as const } : {};
      const state = await runDecay(
        loadRelevant({ store, k: 2, minScore: 0.5, queryFrom: () => 'policy', ...recording }),
      );

      const rejectedCount = 2 - admittedCount;
      expect(state.selected.map(({ updatedAt }) => updatedAt)).toEqual(admittedCount ? [now] : []);
      expect(state.retrieved).toMatchObject({
        ...recording,
        candidateIdsAmbiguous: true,
        consideredCount: 2,
        admittedCount,
        rejectedCount,
        candidatesComplete: false,
      });
      expect(state.retrieved).not.toHaveProperty('candidates');

      const [outcome] = state.recallOutcomes ?? [];
      expect(outcome).toMatchObject({
        kind: 'ok',
        candidateIdsAmbiguous: true,
        candidateCount: 2,
        admittedCount,
        complete: true,
        candidatesComplete: false,
      });
      expect(outcome?.exclusions).toEqual({ decayed: rejectedCount });
      expect(outcome).not.toHaveProperty('candidates');
    },
  );

  it.each(['full', 'ids-only'] as const)(
    'reconciles selection with %s candidate evidence and keeps proved reject reasons',
    async (mode) => {
      const entries = [
        { entry: entry('stale', 2_000), score: 0.9 },
        { entry: entry('fresh', 100), score: 0.8 },
        { entry: entry('newest', 0), score: 0.7 },
        { entry: entry('below-floor', 0), score: 0.1 },
      ];
      const store = Object.assign(new InMemoryStore(), {
        ranksBy: 'server-text' as const,
        supportsVectorSearch: false as const,
        searchWithOutcome: vi.fn().mockResolvedValue({ ok: true, value: entries }),
      });
      const recording = mode === 'ids-only' ? { recording: 'ids-only' as const } : {};
      const state = await runDecay(
        loadRelevant({ store, k: 3, minScore: 0.5, queryFrom: () => 'policy', ...recording }),
        1,
      );

      expect(state.selected.map(({ id }) => id)).toEqual(['newest']);
      expect(state.retrieved).toMatchObject({
        ...recording,
        consideredCount: 4,
        admittedCount: 1,
        rejectedCount: 3,
        candidates: [
          { id: 'stale', admitted: false, reason: 'decayed', score: 0.9 },
          { id: 'fresh', admitted: false, reason: 'over-max-entries' },
          { id: 'newest', admitted: true },
          { id: 'below-floor', admitted: false, reason: 'below-threshold' },
        ],
      });
      expect(state.recallOutcomes?.[0]).toMatchObject({
        candidateCount: 4,
        admittedCount: 1,
        complete: true,
      });
      expect(state.recallOutcomes?.[0]?.exclusions).toEqual({
        'below-threshold': 1,
        decayed: 1,
        'over-max-entries': 1,
      });
      expect(state.recallOutcomes?.[0]?.candidates).toMatchObject([
        { id: 'stale', admitted: false, reason: 'decayed', score: 0.25, floor: 0.5 },
        { id: 'fresh', admitted: false, reason: 'over-max-entries' },
        { id: 'newest', admitted: true },
        { id: 'below-floor', admitted: false, reason: 'below-threshold' },
      ]);
    },
  );
});

/**
 * extractBeats stage — 5-pattern tests.
 *
 * Verifies the write-side stage that turns scope.newMessages into
 * MemoryEntry<NarrativeBeat>[] via a configured extractor.
 *
 * Tiers:
 *   - unit:     extractor called with correct args; entries built correctly
 *   - boundary: empty newMessages → empty newBeats; extractor returns []
 *   - scenario: tier + ttl + custom idFrom applied to all entries
 *   - property: entries are MemoryEntry-shaped (version, timestamps, etc.)
 *   - security: AbortSignal passed through; empty beats skipped cleanly
 */
import { describe, expect, it, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { extractBeats, heuristicExtractor } from '../../../src/memory/beats';
import type { BeatExtractor, ExtractBeatsState, NarrativeBeat } from '../../../src/memory/beats';
import type { Message } from '../../../src/types/messages';

const ID = { tenant: 't1', conversationId: 'c1' };

function makeScope(partial?: Partial<ExtractBeatsState>): ExtractBeatsState {
  return {
    identity: ID,
    turnNumber: 1,
    contextTokensRemaining: 4000,
    loaded: [],
    selected: [],
    formatted: [],
    newMessages: [],
    ...partial,
  };
}

async function runStage(
  config: Parameters<typeof extractBeats>[0],
  seed: Partial<ExtractBeatsState>,
): Promise<ExtractBeatsState> {
  const state = makeScope(seed);
  const chart = flowChart<ExtractBeatsState>(
    'Seed',
    (scope) => {
      scope.identity = state.identity;
      scope.turnNumber = state.turnNumber;
      scope.contextTokensRemaining = state.contextTokensRemaining;
      scope.loaded = state.loaded;
      scope.selected = state.selected;
      scope.formatted = state.formatted;
      scope.newMessages = state.newMessages;
    },
    'seed',
  )
    .addFunction('Extract', extractBeats(config), 'extract-beats')
    .build();
  const executor = new FlowChartExecutor(chart);
  await executor.run();
  return (executor.getSnapshot()?.sharedState ?? {}) as ExtractBeatsState;
}

const user = (content: string): Message => ({ role: 'user', content });

// ── Unit ────────────────────────────────────────────────────

describe('extractBeats — unit', () => {
  it('calls the extractor with turnNumber + newMessages', async () => {
    const spy: BeatExtractor = {
      extract: vi.fn(async () => [{ summary: 's', importance: 0.5, refs: [] } as NarrativeBeat]),
    };
    await runStage(
      { extractor: spy },
      {
        turnNumber: 7,
        newMessages: [user('hi')],
      },
    );
    const call = (spy.extract as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.turnNumber).toBe(7);
    expect(call.messages).toHaveLength(1);
  });

  it('writes MemoryEntry-wrapped beats to scope.newBeats', async () => {
    const state = await runStage(
      { extractor: heuristicExtractor() },
      { newMessages: [user('my name is Alice')], turnNumber: 1 },
    );
    expect(state.newBeats).toHaveLength(1);
    const entry = state.newBeats![0];
    expect(entry.id).toBe('beat-1-0');
    expect(entry.value.summary).toContain('Alice');
    expect(entry.value.category).toBe('identity');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('extractBeats — boundary', () => {
  it('empty newMessages → empty newBeats, extractor NOT called', async () => {
    const spy: BeatExtractor = { extract: vi.fn(async () => []) };
    const state = await runStage({ extractor: spy }, { newMessages: [] });
    expect(state.newBeats).toEqual([]);
    expect(spy.extract).not.toHaveBeenCalled();
  });

  it('extractor returning [] → empty newBeats (no entries built)', async () => {
    const empty: BeatExtractor = { extract: async () => [] };
    const state = await runStage({ extractor: empty }, { newMessages: [user('x')] });
    expect(state.newBeats).toEqual([]);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('extractBeats — scenario', () => {
  it('tier + ttlMs + custom idFrom all applied to every entry', async () => {
    const extractor: BeatExtractor = {
      extract: async () => [
        { summary: 'a', importance: 0.5, refs: [] },
        { summary: 'b', importance: 0.5, refs: [] },
      ],
    };
    const now = Date.now();
    const state = await runStage(
      {
        extractor,
        tier: 'hot',
        ttlMs: 60_000,
        idFrom: (turn, i) => `custom-${turn}-${i}`,
      },
      { newMessages: [user('x')], turnNumber: 3 },
    );
    for (const entry of state.newBeats!) {
      expect(entry.tier).toBe('hot');
      expect(entry.ttl).toBeGreaterThanOrEqual(now + 60_000 - 5000);
      expect(entry.id.startsWith('custom-3-')).toBe(true);
    }
  });
});

// ── Property ────────────────────────────────────────────────

describe('extractBeats — property', () => {
  it('every produced entry has all required MemoryEntry fields', async () => {
    const state = await runStage(
      { extractor: heuristicExtractor() },
      { newMessages: [user('hi'), user('there')], turnNumber: 1 },
    );
    for (const entry of state.newBeats!) {
      expect(typeof entry.id).toBe('string');
      expect(entry.value).toBeDefined();
      expect(entry.version).toBe(1);
      expect(typeof entry.createdAt).toBe('number');
      expect(typeof entry.updatedAt).toBe('number');
      expect(typeof entry.lastAccessedAt).toBe('number');
      expect(entry.accessCount).toBe(0);
      expect(entry.source).toBeDefined();
      expect(entry.source!.turn).toBe(1);
    }
  });

  it('entry ids are stable across re-runs of the same turn (idempotent)', async () => {
    const extractor: BeatExtractor = {
      extract: async () => [{ summary: 'x', importance: 0.5, refs: [] }],
    };
    const state1 = await runStage(
      { extractor },
      {
        newMessages: [user('x')],
        turnNumber: 5,
      },
    );
    const state2 = await runStage(
      { extractor },
      {
        newMessages: [user('x')],
        turnNumber: 5,
      },
    );
    expect(state1.newBeats![0].id).toBe(state2.newBeats![0].id);
  });
});

// ── Security ────────────────────────────────────────────────

describe('extractBeats — security', () => {
  it('AbortSignal from env flows through to the extractor', async () => {
    const spy: BeatExtractor = { extract: vi.fn(async () => []) };
    const controller = new AbortController();
    const chart = flowChart<ExtractBeatsState>(
      'Seed',
      (scope) => {
        scope.identity = ID;
        scope.turnNumber = 1;
        scope.contextTokensRemaining = 4000;
        scope.loaded = [];
        scope.selected = [];
        scope.formatted = [];
        scope.newMessages = [user('x')];
      },
      'seed',
    )
      .addFunction('Extract', extractBeats({ extractor: spy }), 'extract-beats')
      .build();
    const executor = new FlowChartExecutor(chart);
    await executor.run({ env: { signal: controller.signal } });
    const call = (spy.extract as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.signal).toBe(controller.signal);
  });

  it('extractor throwing propagates (fail-loud)', async () => {
    const bad: BeatExtractor = {
      extract: async () => {
        throw new Error('extractor blew up');
      },
    };
    await expect(runStage({ extractor: bad }, { newMessages: [user('x')] })).rejects.toThrow(
      'extractor blew up',
    );
  });
});

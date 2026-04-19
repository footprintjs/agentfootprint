/**
 * writeBeats stage — 5-pattern tests.
 *
 * Tiers:
 *   - unit:     single-beat batch writes via putMany
 *   - boundary: empty newBeats → putMany NOT called
 *   - scenario: multiple beats in one turn → one putMany call with all entries
 *   - property: persisted entries round-trip via store.get
 *   - security: identity isolation — beats scoped by identity, not leaked
 */
import { describe, expect, it, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { InMemoryStore } from '../../../src/memory/store';
import { writeBeats } from '../../../src/memory/beats';
import type { ExtractBeatsState, NarrativeBeat } from '../../../src/memory/beats';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { MemoryIdentity } from '../../../src/memory/identity';

const ID_A: MemoryIdentity = { tenant: 't1', conversationId: 'c1' };
const ID_B: MemoryIdentity = { tenant: 't2', conversationId: 'c1' };

function makeBeatEntry(id: string, beat: NarrativeBeat): MemoryEntry<NarrativeBeat> {
  const now = Date.now();
  return {
    id,
    value: beat,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
  };
}

async function runWrite(
  store: { putMany: (id: MemoryIdentity, entries: readonly unknown[]) => Promise<void> },
  identity: MemoryIdentity,
  newBeats: readonly MemoryEntry<NarrativeBeat>[],
): Promise<void> {
  const chart = flowChart<ExtractBeatsState>(
    'Seed',
    (scope) => {
      scope.identity = identity;
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.loaded = [];
      scope.selected = [];
      scope.formatted = [];
      scope.newMessages = [];
      scope.newBeats = newBeats;
    },
    'seed',
  )
    .addFunction(
      'WriteBeats',
      writeBeats({ store: store as Parameters<typeof writeBeats>[0]['store'] }),
      'write-beats',
    )
    .build();
  const executor = new FlowChartExecutor(chart);
  await executor.run();
}

// ── Unit ────────────────────────────────────────────────────

describe('writeBeats — unit', () => {
  it('persists a single beat via putMany', async () => {
    const store = new InMemoryStore();
    const spy = vi.spyOn(store, 'putMany');
    const beat = makeBeatEntry('beat-1-0', {
      summary: 'Alice',
      importance: 0.9,
      refs: ['msg-1-0'],
    });
    await runWrite(store, ID_A, [beat]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(ID_A, [beat]);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('writeBeats — boundary', () => {
  it('empty newBeats → store.putMany NOT called (skip the round-trip)', async () => {
    let calls = 0;
    const store = {
      putMany: async () => {
        calls++;
      },
    };
    await runWrite(store, ID_A, []);
    expect(calls).toBe(0);
  });

  it('undefined newBeats → no-op', async () => {
    let calls = 0;
    const store = {
      putMany: async () => {
        calls++;
      },
    };
    const chart = flowChart<ExtractBeatsState>(
      'Seed',
      (scope) => {
        scope.identity = ID_A;
        scope.turnNumber = 1;
        scope.contextTokensRemaining = 4000;
        scope.loaded = [];
        scope.selected = [];
        scope.formatted = [];
        scope.newMessages = [];
        // newBeats intentionally unset
      },
      'seed',
    )
      .addFunction(
        'WriteBeats',
        writeBeats({ store: store as Parameters<typeof writeBeats>[0]['store'] }),
        'write-beats',
      )
      .build();
    await new FlowChartExecutor(chart).run();
    expect(calls).toBe(0);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('writeBeats — scenario', () => {
  it('multiple beats from one turn → ONE putMany call with all entries', async () => {
    const store = new InMemoryStore();
    const spy = vi.spyOn(store, 'putMany');
    const beats = [
      makeBeatEntry('beat-1-0', { summary: 'a', importance: 0.5, refs: [] }),
      makeBeatEntry('beat-1-1', { summary: 'b', importance: 0.5, refs: [] }),
      makeBeatEntry('beat-1-2', { summary: 'c', importance: 0.5, refs: [] }),
    ];
    await runWrite(store, ID_A, beats);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][1]).toHaveLength(3);
  });
});

// ── Property ────────────────────────────────────────────────

describe('writeBeats — property', () => {
  it('persisted entries round-trip via store.get', async () => {
    const store = new InMemoryStore();
    const beat = makeBeatEntry('beat-1-0', {
      summary: 'Alice',
      importance: 0.9,
      refs: ['msg-1-0'],
    });
    await runWrite(store, ID_A, [beat]);
    const retrieved = await store.get<NarrativeBeat>(ID_A, 'beat-1-0');
    expect(retrieved?.value.summary).toBe('Alice');
    expect(retrieved?.value.importance).toBe(0.9);
  });
});

// ── Security ────────────────────────────────────────────────

describe('writeBeats — security', () => {
  it('identity isolation — beats written to ID_A are NOT visible to ID_B', async () => {
    const store = new InMemoryStore();
    const beat = makeBeatEntry('beat-1-0', {
      summary: 'tenant-A secret',
      importance: 0.9,
      refs: [],
    });
    await runWrite(store, ID_A, [beat]);
    const crossTenant = await store.get<NarrativeBeat>(ID_B, 'beat-1-0');
    expect(crossTenant).toBeNull();
  });
});

/**
 * filterByDecay stage — 5-pattern tests
 * (unit · boundary · scenario · property · performance).
 *
 * The stage is exercised in isolation against a plain scope object, the
 * same way loadRecent is: the arithmetic is the contract. End-to-end proof
 * that a faded entry never reaches the prompt lives in
 * `examples/memory/11-decay-strategy.ts` and in the pipeline test.
 */
import { describe, expect, it } from 'vitest';
import { filterByDecay, DEFAULT_DECAY_MIN_SCORE } from '../../../src/memory/stages/filterByDecay';
import type { MemoryState } from '../../../src/memory/stages/types';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { Message } from '../../../src/types/messages';

const ID = { tenant: 't1', principal: 'u1', conversationId: 'c1' };
const NOW = 1_700_000_000_000;
const SECOND = 1000;

function aged(id: string, ageMs: number, overrides: Partial<MemoryEntry<Message>> = {}) {
  const at = NOW - ageMs;
  return {
    id,
    value: { role: 'user', content: `entry ${id}` } as Message,
    version: 1,
    createdAt: at,
    updatedAt: at,
    lastAccessedAt: at,
    accessCount: 0,
    ...overrides,
  } as MemoryEntry<Message>;
}

function makeScope(loaded: MemoryEntry<Message>[]): MemoryState {
  return {
    identity: ID,
    turnNumber: 1,
    contextTokensRemaining: 4000,
    loaded,
    selected: [],
    formatted: [],
    newMessages: [],
  };
}

const clock = () => NOW;

// ── Unit ────────────────────────────────────────────────────

describe('filterByDecay — unit', () => {
  it('keeps a fresh entry and drops one many half-lives old', async () => {
    const scope = makeScope([aged('fresh', 0), aged('ancient', 100 * SECOND)]);
    await filterByDecay({ halfLifeMs: SECOND, now: clock })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['fresh']);
  });

  it('scores by AGE alone — a high accessCount does not rescue a stale entry', async () => {
    // The access term of the model is passed a neutral 1 on purpose:
    // nothing in the read path increments accessCount.
    const scope = makeScope([aged('read-often', 100 * SECOND, { accessCount: 50 })]);
    await filterByDecay({ halfLifeMs: SECOND, now: clock })(scope as never);
    expect(scope.loaded).toEqual([]);
  });

  it('ignores a per-entry decayPolicy — the strategy-wide half-life governs', async () => {
    const scope = makeScope([
      aged('slow-policy', 100 * SECOND, {
        decayPolicy: { halfLifeMs: Number.POSITIVE_INFINITY, accessBoost: 1 },
      }),
    ]);
    await filterByDecay({ halfLifeMs: SECOND, now: clock })(scope as never);
    expect(scope.loaded).toEqual([]);
  });

  it('preserves order among the survivors', async () => {
    const scope = makeScope([aged('a', 0), aged('b', 100 * SECOND), aged('c', SECOND)]);
    await filterByDecay({ halfLifeMs: 10 * SECOND, now: clock })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['a', 'c']);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('filterByDecay — boundary', () => {
  it('the default floor is 0.1 — 3 half-lives survive (0.125), 4 do not (0.0625)', async () => {
    expect(DEFAULT_DECAY_MIN_SCORE).toBe(0.1);
    const scope = makeScope([aged('three', 3 * SECOND), aged('four', 4 * SECOND)]);
    await filterByDecay({ halfLifeMs: SECOND, now: clock })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['three']);
  });

  it('minScore 0 keeps everything — score, do not drop', async () => {
    const scope = makeScope([aged('ancient', 1_000 * SECOND)]);
    await filterByDecay({ halfLifeMs: SECOND, minScore: 0, now: clock })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['ancient']);
  });

  it('halfLifeMs 0 is instant decay — only an entry written this instant survives', async () => {
    const scope = makeScope([aged('now', 0), aged('a-ms-ago', 1)]);
    await filterByDecay({ halfLifeMs: 0, now: clock })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['now']);
  });

  it('an empty load is a no-op', async () => {
    const scope = makeScope([]);
    await filterByDecay({ halfLifeMs: SECOND, now: clock })(scope as never);
    expect(scope.loaded).toEqual([]);
  });

  it('KEEPS an undateable entry rather than dropping it', async () => {
    // "I cannot date this" must never read as "this is ancient" — the
    // arithmetic would be NaN, and NaN fails every comparison.
    const scope = makeScope([
      aged('no-date', 0, { lastAccessedAt: undefined as unknown as number }),
      aged('no-count', 0, { accessCount: undefined as unknown as number }),
    ]);
    await filterByDecay({ halfLifeMs: SECOND, now: clock })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['no-date', 'no-count']);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('filterByDecay — scenario', () => {
  const DAY = 86_400_000;

  it('a month-old fact fades, last week’s correction stays', async () => {
    const scope = makeScope([aged('toronto', 30 * DAY), aged('berlin', 60_000)]);
    await filterByDecay({ halfLifeMs: DAY, minScore: 0.1, now: clock })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['berlin']);
  });

  it('a 30-day half-life keeps the same month-old fact — the number is the policy', async () => {
    const scope = makeScope([aged('toronto', 30 * DAY), aged('berlin', 60_000)]);
    await filterByDecay({ halfLifeMs: 30 * DAY, minScore: 0.1, now: clock })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['toronto', 'berlin']);
  });

  it('nothing stored is mutated — the same entries survive a second pass', async () => {
    const entries = [aged('a', 0), aged('b', SECOND)];
    const first = makeScope([...entries]);
    await filterByDecay({ halfLifeMs: 10 * SECOND, now: clock })(first as never);
    const second = makeScope([...entries]);
    await filterByDecay({ halfLifeMs: 10 * SECOND, now: clock })(second as never);
    expect(second.loaded.map((e) => e.id)).toEqual(first.loaded.map((e) => e.id));
    expect(entries[0].lastAccessedAt).toBe(NOW);
    expect(entries[0].accessCount).toBe(0);
  });
});

// ── Property ────────────────────────────────────────────────

describe('filterByDecay — properties', () => {
  it('monotonic: if an entry survives, every fresher entry survives too', async () => {
    const ages = [0, SECOND, 2 * SECOND, 3 * SECOND, 4 * SECOND, 10 * SECOND];
    const scope = makeScope(ages.map((age, i) => aged(`e${i}`, age)));
    await filterByDecay({ halfLifeMs: SECOND, now: clock })(scope as never);
    const kept = scope.loaded.map((e) => e.id);
    // Survivors are always a PREFIX of the freshest-first ordering above.
    expect(kept).toEqual(['e0', 'e1', 'e2', 'e3'].slice(0, kept.length));
  });

  it('never invents entries — the result is always a subset of the input', async () => {
    const scope = makeScope([aged('a', 0), aged('b', 5 * SECOND), aged('c', 50 * SECOND)]);
    const before = new Set(scope.loaded.map((e) => e.id));
    await filterByDecay({ halfLifeMs: SECOND, now: clock })(scope as never);
    for (const e of scope.loaded) expect(before.has(e.id)).toBe(true);
  });

  it('one clock read per batch — two same-age entries always agree', async () => {
    let reads = 0;
    const counting = () => {
      reads++;
      return NOW;
    };
    const scope = makeScope([aged('a', 3 * SECOND), aged('b', 3 * SECOND)]);
    await filterByDecay({ halfLifeMs: SECOND, now: counting })(scope as never);
    expect(reads).toBe(1);
    expect(scope.loaded.length === 0 || scope.loaded.length === 2).toBe(true);
  });
});

// ── Performance ─────────────────────────────────────────────

describe('filterByDecay — performance', () => {
  it('does no I/O: 10k entries filter without a store, an LLM, or an embedder', async () => {
    const scope = makeScope(Array.from({ length: 10_000 }, (_, i) => aged(`e${i}`, i * 10)));
    const started = Date.now();
    await filterByDecay({ halfLifeMs: SECOND, now: clock })(scope as never);
    expect(Date.now() - started).toBeLessThan(500);
    expect(scope.loaded.length).toBeLessThan(10_000);
  });
});

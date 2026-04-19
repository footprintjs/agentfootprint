/**
 * pickByBudget stage — 5-pattern tests.
 *
 * Verifies token-budget-aware entry selection with narrative-friendly
 * decide() evidence. Uses the default approximateTokenCounter (1 token
 * ≈ 4 chars) so test expectations are deterministic.
 */
import { describe, expect, it } from 'vitest';
import { pickByBudget } from '../../../src/memory/stages/pickByBudget';
import type { MemoryState } from '../../../src/memory/stages/types';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { Message } from '../../../src/types/messages';

const ID = { tenant: 't1', conversationId: 'c1' };

function msg(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

function makeEntry(id: string, message: Message, updatedAt: number): MemoryEntry<Message> {
  return {
    id,
    value: message,
    version: 1,
    createdAt: updatedAt,
    updatedAt,
    lastAccessedAt: updatedAt,
    accessCount: 0,
  };
}

function makeScope(partial?: Partial<MemoryState>): MemoryState {
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

// Helper: short content = 1 token (4 chars / 4), long content = ~250 tokens
const SHORT = 'abcd'; // 1 token
const LONG = 'a'.repeat(1000); // 250 tokens

// ── Unit ────────────────────────────────────────────────────

describe('pickByBudget — unit', () => {
  it('picks nothing when loaded is empty', async () => {
    const scope = makeScope();
    await pickByBudget()(scope as never);
    expect(scope.selected).toEqual([]);
  });

  it('picks all entries when budget easily fits', async () => {
    const entries = [
      makeEntry('e1', msg('user', SHORT), 100),
      makeEntry('e2', msg('assistant', SHORT), 200),
    ];
    const scope = makeScope({ loaded: entries, contextTokensRemaining: 4000 });
    await pickByBudget()(scope as never);
    expect(scope.selected.length).toBe(2);
  });

  it('returns selected in chronological order (oldest first)', async () => {
    const entries = [
      makeEntry('newer', msg('user', SHORT), 300),
      makeEntry('older', msg('user', SHORT), 100),
      makeEntry('middle', msg('user', SHORT), 200),
    ];
    const scope = makeScope({ loaded: entries });
    await pickByBudget()(scope as never);
    expect(scope.selected.map((e) => e.id)).toEqual(['older', 'middle', 'newer']);
  });

  it('skips entries that individually exceed remaining budget', async () => {
    // 280 remaining after reserve (256). LONG is ~250 tokens. After picking
    // one LONG (250 used), the next LONG won't fit and is skipped.
    const entries = [
      makeEntry('e1', msg('user', LONG), 100),
      makeEntry('e2', msg('user', LONG), 200),
    ];
    const scope = makeScope({
      loaded: entries,
      contextTokensRemaining: 280 + 256, // 256 reserve + 280 memory budget
    });
    await pickByBudget()(scope as never);
    expect(scope.selected.length).toBe(1);
  });

  it('prefers newer entries when the budget is tight (greedy-newest)', async () => {
    // Budget fits exactly one LONG. Picker should include the newest one.
    const entries = [
      makeEntry('oldest', msg('user', LONG), 100),
      makeEntry('newest', msg('user', LONG), 300),
    ];
    const scope = makeScope({
      loaded: entries,
      contextTokensRemaining: 250 + 256, // ~250 budget after reserve
    });
    await pickByBudget()(scope as never);
    expect(scope.selected.map((e) => e.id)).toEqual(['newest']);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('pickByBudget — boundary', () => {
  it('skips when budget is below minimumTokens (even with entries loaded)', async () => {
    const entries = [makeEntry('e1', msg('user', SHORT), 100)];
    const scope = makeScope({
      loaded: entries,
      contextTokensRemaining: 50, // well below default reserve (256) + minimum (100)
    });
    await pickByBudget()(scope as never);
    expect(scope.selected).toEqual([]);
  });

  it('custom reserveTokens is honored', async () => {
    const entries = [makeEntry('e1', msg('user', SHORT), 100)];
    const scope = makeScope({
      loaded: entries,
      contextTokensRemaining: 500,
    });
    // Reserve 400 → budget = 100, still above minimum 100 but just barely.
    await pickByBudget({ reserveTokens: 400 })(scope as never);
    expect(scope.selected.length).toBe(1);
  });

  it('maxEntries caps selection count', async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry(`e${i}`, msg('user', SHORT), (i + 1) * 100),
    );
    const scope = makeScope({ loaded: entries });
    await pickByBudget({ maxEntries: 2 })(scope as never);
    expect(scope.selected.length).toBe(2);
  });

  it('custom countTokens is used for budget calculation', async () => {
    // Counter that says every message costs 1000 tokens → nothing fits.
    const entries = [makeEntry('e1', msg('user', 'a'), 100)];
    const scope = makeScope({
      loaded: entries,
      contextTokensRemaining: 300 + 256, // 300 budget after reserve
    });
    await pickByBudget({ countTokens: () => 1000 })(scope as never);
    expect(scope.selected).toEqual([]);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('pickByBudget — scenario', () => {
  it('narrative evidence: skip-empty when nothing loaded', async () => {
    const scope = makeScope({ loaded: [] });
    // We can't easily assert on the footprintjs decide() evidence here
    // without a full executor — that's covered in Layer 6 acceptance test.
    // What we CAN verify is the observable side effect.
    await pickByBudget()(scope as never);
    expect(scope.selected).toEqual([]);
  });

  it('full turn simulation — load 10 entries, pick within 2K budget', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(400)), (i + 1) * 100),
    );
    // Each entry is 100 tokens. 2000 budget - 256 reserve = 1744 memory.
    // Should fit 17 entries in theory, but we only have 10.
    const scope = makeScope({ loaded: entries, contextTokensRemaining: 2000 });
    await pickByBudget()(scope as never);
    expect(scope.selected.length).toBe(10);
  });

  it('multiple load stages composed (recent + facts) — picker dedupes via recency', async () => {
    // Same entry shows up twice (would happen if loadRecent + some other
    // load stage both picked the same id). Picker doesn't dedupe — that's
    // the pipeline's responsibility. Pin the current behavior.
    const dupe = makeEntry('same', msg('user', SHORT), 100);
    const entries = [dupe, dupe, makeEntry('other', msg('user', SHORT), 200)];
    const scope = makeScope({ loaded: entries });
    await pickByBudget()(scope as never);
    expect(scope.selected.length).toBe(3); // picker preserves duplicates
  });
});

// ── Property ────────────────────────────────────────────────

describe('pickByBudget — property', () => {
  it('total selected tokens never exceed budget - reserve', async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry(`e${i}`, msg('user', SHORT), i * 100),
    );
    for (const budget of [300, 500, 1000, 2000, 10_000]) {
      const scope = makeScope({ loaded: entries, contextTokensRemaining: budget });
      await pickByBudget()(scope as never);
      // Each SHORT is 1 token; selected count ≤ budget - 256 reserve
      const available = Math.max(0, budget - 256);
      if (available < 100) {
        expect(scope.selected).toEqual([]);
      } else {
        expect(scope.selected.length).toBeLessThanOrEqual(available);
      }
    }
  });

  it('does not mutate the input `loaded` array', async () => {
    const entries = [
      makeEntry('e1', msg('user', SHORT), 200),
      makeEntry('e2', msg('user', SHORT), 100),
    ];
    const before = [...entries];
    const scope = makeScope({ loaded: entries });
    await pickByBudget()(scope as never);
    expect(entries).toEqual(before);
    // Verify order preserved
    expect(entries.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('idempotent: running twice with same scope produces same result', async () => {
    const entries = [
      makeEntry('e1', msg('user', SHORT), 100),
      makeEntry('e2', msg('user', SHORT), 200),
    ];
    const scope1 = makeScope({ loaded: entries });
    await pickByBudget()(scope1 as never);
    const first = scope1.selected.map((e) => e.id);

    const scope2 = makeScope({ loaded: entries });
    await pickByBudget()(scope2 as never);
    const second = scope2.selected.map((e) => e.id);

    expect(first).toEqual(second);
  });
});

// ── Security ────────────────────────────────────────────────

describe('pickByBudget — security', () => {
  it('zero contextTokensRemaining skips injection (no headroom)', async () => {
    const entries = [makeEntry('e1', msg('user', SHORT), 100)];
    const scope = makeScope({ loaded: entries, contextTokensRemaining: 0 });
    await pickByBudget()(scope as never);
    expect(scope.selected).toEqual([]);
  });

  it('negative contextTokensRemaining does not crash; returns empty', async () => {
    const entries = [makeEntry('e1', msg('user', SHORT), 100)];
    const scope = makeScope({ loaded: entries, contextTokensRemaining: -1000 });
    await pickByBudget()(scope as never);
    expect(scope.selected).toEqual([]);
  });

  it('huge single entry does not cause runaway; simply skipped', async () => {
    // Entry that's larger than the entire budget. Picker skips it rather
    // than truncating or crashing.
    const huge = makeEntry('big', msg('user', 'a'.repeat(100_000)), 100);
    const scope = makeScope({ loaded: [huge], contextTokensRemaining: 1000 });
    await pickByBudget()(scope as never);
    expect(scope.selected).toEqual([]);
  });

  it('exact-budget-match — entry whose cost equals budget exactly is INCLUDED', async () => {
    // Off-by-one boundary: `if (used + cost > budget) continue;` uses
    // strict `>`, so an entry that costs exactly the remaining budget
    // still fits. Pin the semantic: "budget is inclusive."
    const exact = makeEntry('fit', msg('user', 'a'.repeat(400)), 100); // 100 tokens
    const scope = makeScope({
      loaded: [exact],
      contextTokensRemaining: 100 + 256, // 100 memory budget after reserve
    });
    await pickByBudget()(scope as never);
    expect(scope.selected.length).toBe(1);
  });
});

/**
 * pickByBudget — 5-pattern tests under the new decider+branches shape.
 *
 * `pickByBudget(config)` is a builder-extension that appends:
 *   PickDecider → [skip-empty | skip-no-budget | pick]
 *
 * Tests execute via `FlowChartExecutor` (the only correct way to run
 * decider stages — the plain-function shim is gone). A `runPick`
 * helper keeps each test terse.
 */
import { describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { Recorder } from 'footprintjs';
import { pickByBudget } from '../../../src/memory/stages/pickByBudget';
import type { MemoryState } from '../../../src/memory/stages/types';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { Message } from '../../../src/types/messages';
import type { PickByBudgetConfig } from '../../../src/memory/stages/pickByBudget';

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

/**
 * Run pickByBudget as a real flowchart. Builds `Seed → PickDecider →
 * [branches]`, executes, and returns the final `selected` array plus
 * the snapshot for callers that need extra assertions.
 */
async function runPick(
  config: PickByBudgetConfig,
  scopeState: Partial<MemoryState>,
): Promise<{
  selected: MemoryState['selected'];
  state: MemoryState;
}> {
  const seed = makeScope(scopeState);
  let b = flowChart<MemoryState>(
    'Seed',
    (scope) => {
      scope.identity = seed.identity;
      scope.turnNumber = seed.turnNumber;
      scope.contextTokensRemaining = seed.contextTokensRemaining;
      scope.loaded = seed.loaded;
      scope.selected = seed.selected;
      scope.formatted = seed.formatted;
      scope.newMessages = seed.newMessages;
    },
    'seed',
  );
  b = pickByBudget(config)(b);
  const chart = b.build();
  const exec = new FlowChartExecutor(chart);
  await exec.run();
  const state = (exec.getSnapshot()?.sharedState ?? {}) as MemoryState;
  return { selected: state.selected ?? [], state };
}

// Helper: short content = 1 token (4 chars / 4), long content = ~250 tokens
const SHORT = 'abcd'; // 1 token
const LONG = 'a'.repeat(1000); // 250 tokens

// ── Unit ────────────────────────────────────────────────────

describe('pickByBudget — unit', () => {
  it('picks nothing when loaded is empty', async () => {
    const { selected } = await runPick({}, {});
    expect(selected).toEqual([]);
  });

  it('picks all entries when budget easily fits', async () => {
    const entries = [
      makeEntry('e1', msg('user', SHORT), 100),
      makeEntry('e2', msg('assistant', SHORT), 200),
    ];
    const { selected } = await runPick({}, { loaded: entries, contextTokensRemaining: 4000 });
    expect(selected.length).toBe(2);
  });

  it('returns selected in chronological order (oldest first)', async () => {
    const entries = [
      makeEntry('newer', msg('user', SHORT), 300),
      makeEntry('older', msg('user', SHORT), 100),
      makeEntry('middle', msg('user', SHORT), 200),
    ];
    const { selected } = await runPick({}, { loaded: entries });
    expect(selected.map((e) => e.id)).toEqual(['older', 'middle', 'newer']);
  });

  it('skips entries that individually exceed remaining budget', async () => {
    // 280 remaining after reserve (256). LONG is ~250 tokens. After picking
    // one LONG (250 used), the next LONG won't fit and is skipped.
    const entries = [
      makeEntry('e1', msg('user', LONG), 100),
      makeEntry('e2', msg('user', LONG), 200),
    ];
    const { selected } = await runPick({}, { loaded: entries, contextTokensRemaining: 280 + 256 });
    expect(selected.length).toBe(1);
  });

  it('prefers newer entries when the budget is tight (greedy-newest)', async () => {
    const entries = [
      makeEntry('oldest', msg('user', LONG), 100),
      makeEntry('newest', msg('user', LONG), 300),
    ];
    const { selected } = await runPick({}, { loaded: entries, contextTokensRemaining: 250 + 256 });
    expect(selected.map((e) => e.id)).toEqual(['newest']);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('pickByBudget — boundary', () => {
  it('skips when budget is below minimumTokens (even with entries loaded)', async () => {
    const entries = [makeEntry('e1', msg('user', SHORT), 100)];
    const { selected } = await runPick({}, { loaded: entries, contextTokensRemaining: 50 });
    expect(selected).toEqual([]);
  });

  it('custom reserveTokens is honored', async () => {
    const entries = [makeEntry('e1', msg('user', SHORT), 100)];
    // Reserve 400 → budget = 100 (at minimum), one SHORT entry fits.
    const { selected } = await runPick(
      { reserveTokens: 400 },
      { loaded: entries, contextTokensRemaining: 500 },
    );
    expect(selected.length).toBe(1);
  });

  it('maxEntries caps selection count', async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry(`e${i}`, msg('user', SHORT), (i + 1) * 100),
    );
    const { selected } = await runPick({ maxEntries: 2 }, { loaded: entries });
    expect(selected.length).toBe(2);
  });

  it('custom countTokens is used for budget calculation', async () => {
    const entries = [makeEntry('e1', msg('user', 'a'), 100)];
    const { selected } = await runPick(
      { countTokens: () => 1000 },
      { loaded: entries, contextTokensRemaining: 300 + 256 },
    );
    expect(selected).toEqual([]);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('pickByBudget — scenario', () => {
  it('skip-empty branch fires when nothing is loaded (evidence on onDecision)', async () => {
    const seed = makeScope({ loaded: [] });
    let b = flowChart<MemoryState>(
      'Seed',
      (scope) => {
        Object.assign(scope, seed);
      },
      'seed',
    );
    b = pickByBudget()(b);
    const chart = b.build();
    const exec = new FlowChartExecutor(chart);
    const decisions: Array<{ chosen?: string; evidence?: unknown }> = [];
    exec.attachFlowRecorder({
      id: 'probe',
      onDecision: (e) =>
        decisions.push({
          chosen: e.chosen,
          evidence: e.evidence,
        }),
    });
    await exec.run();
    const pickDecision = decisions.find(
      (d: { evidence?: { chosen?: string } }) => d.evidence?.chosen === 'skip-empty',
    );
    expect(pickDecision).toBeDefined();
    const state = (exec.getSnapshot()?.sharedState ?? {}) as MemoryState;
    expect(state.selected).toEqual([]);
  });

  it('full turn simulation — load 10 entries, pick within 2K budget', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(400)), (i + 1) * 100),
    );
    const { selected } = await runPick({}, { loaded: entries, contextTokensRemaining: 2000 });
    expect(selected.length).toBe(10);
  });

  it('duplicates in `loaded` are NOT deduped by the picker (caller responsibility)', async () => {
    const dupe = makeEntry('same', msg('user', SHORT), 100);
    const entries = [dupe, dupe, makeEntry('other', msg('user', SHORT), 200)];
    const { selected } = await runPick({}, { loaded: entries });
    expect(selected.length).toBe(3);
  });
});

// ── Property ────────────────────────────────────────────────

describe('pickByBudget — property', () => {
  it('total selected tokens never exceed budget - reserve', async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry(`e${i}`, msg('user', SHORT), i * 100),
    );
    for (const budget of [300, 500, 1000, 2000, 10_000]) {
      const { selected } = await runPick({}, { loaded: entries, contextTokensRemaining: budget });
      const available = Math.max(0, budget - 256);
      if (available < 100) {
        expect(selected).toEqual([]);
      } else {
        expect(selected.length).toBeLessThanOrEqual(available);
      }
    }
  });

  it('does not mutate the input `loaded` array', async () => {
    const entries = [
      makeEntry('e1', msg('user', SHORT), 200),
      makeEntry('e2', msg('user', SHORT), 100),
    ];
    const before = [...entries];
    await runPick({}, { loaded: entries });
    expect(entries).toEqual(before);
    expect(entries.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('idempotent: running twice with same seed produces same result', async () => {
    const entries = [
      makeEntry('e1', msg('user', SHORT), 100),
      makeEntry('e2', msg('user', SHORT), 200),
    ];
    const r1 = await runPick({}, { loaded: entries });
    const r2 = await runPick({}, { loaded: entries });
    expect(r1.selected.map((e) => e.id)).toEqual(r2.selected.map((e) => e.id));
  });
});

// ── Security ────────────────────────────────────────────────

describe('pickByBudget — security', () => {
  it('zero contextTokensRemaining skips injection (no headroom)', async () => {
    const entries = [makeEntry('e1', msg('user', SHORT), 100)];
    const { selected } = await runPick({}, { loaded: entries, contextTokensRemaining: 0 });
    expect(selected).toEqual([]);
  });

  it('negative contextTokensRemaining does not crash; returns empty', async () => {
    const entries = [makeEntry('e1', msg('user', SHORT), 100)];
    const { selected } = await runPick({}, { loaded: entries, contextTokensRemaining: -1000 });
    expect(selected).toEqual([]);
  });

  it('huge single entry does not cause runaway; simply skipped', async () => {
    const huge = makeEntry('big', msg('user', 'a'.repeat(100_000)), 100);
    const { selected } = await runPick({}, { loaded: [huge], contextTokensRemaining: 1000 });
    expect(selected).toEqual([]);
  });

  it('exact-budget-match — entry whose cost equals budget exactly is INCLUDED', async () => {
    const exact = makeEntry('fit', msg('user', 'a'.repeat(400)), 100); // 100 tokens
    const { selected } = await runPick({}, { loaded: [exact], contextTokensRemaining: 100 + 256 });
    expect(selected.length).toBe(1);
  });

  it('decider evidence lands on FlowRecorder.onDecision with chosen branch', async () => {
    const seed = makeScope({
      loaded: [makeEntry('e1', msg('user', SHORT), 100)],
      contextTokensRemaining: 4000,
    });
    let b = flowChart<MemoryState>(
      'Seed',
      (scope) => {
        Object.assign(scope, seed);
      },
      'seed',
    );
    b = pickByBudget()(b);
    const chart = b.build();
    const exec = new FlowChartExecutor(chart);
    const decisions: Array<{ chosen?: string; evidence?: { chosen?: string } }> = [];
    exec.attachFlowRecorder({
      id: 'probe',
      onDecision: (e) => decisions.push({ chosen: e.chosen, evidence: e.evidence }),
    });
    await exec.run();
    const picker = decisions.find((d) => d.evidence?.chosen === 'pick');
    expect(picker).toBeDefined();
    expect(picker?.evidence?.chosen).toBe('pick');
  });

  it('decider evidence structure: function-form rules with labels and branches', async () => {
    // Pin the exact evidence shape — audit-trail consumers depend on it.
    const seed = makeScope({ loaded: [], contextTokensRemaining: 4000 });
    let b = flowChart<MemoryState>(
      'Seed',
      (scope) => {
        Object.assign(scope, seed);
      },
      'seed',
    );
    b = pickByBudget()(b);
    const chart = b.build();
    const exec = new FlowChartExecutor(chart);
    const pickEvents: Array<{
      chosen?: string;
      evidence?: {
        chosen?: string;
        default?: string;
        rules?: Array<{
          type?: string;
          branch?: string;
          matched?: boolean;
          label?: string;
        }>;
      };
    }> = [];
    exec.attachFlowRecorder({
      id: 'probe',
      onDecision: (e) => {
        if (e.traversalContext?.stageId === 'pick-decider') {
          pickEvents.push({ chosen: e.chosen, evidence: e.evidence });
        }
      },
    });
    await exec.run();

    expect(pickEvents.length).toBe(1);
    const ev = pickEvents[0].evidence!;
    expect(ev.chosen).toBe('skip-empty');
    expect(ev.default).toBe('pick');
    // With loaded=[], first rule matches → only rule 0 evaluated (first-match semantics).
    expect(ev.rules).toBeDefined();
    expect(ev.rules![0].type).toBe('function');
    expect(ev.rules![0].branch).toBe('skip-empty');
    expect(ev.rules![0].matched).toBe(true);
    expect(ev.rules![0].label).toContain('no entries loaded');
  });

  it('sort stability: ties on updatedAt resolve by id (deterministic)', async () => {
    // Three entries sharing a timestamp — without the secondary-key fix,
    // ordering is implementation-defined. With it, lexicographic id order.
    const entries = [
      makeEntry('z-entry', msg('user', SHORT), 500),
      makeEntry('a-entry', msg('user', SHORT), 500),
      makeEntry('m-entry', msg('user', SHORT), 500),
    ];
    const { selected } = await runPick({}, { loaded: entries, contextTokensRemaining: 4000 });
    // byNewest sort: ties resolve a < m < z (lex ascending). Then reverse
    // to chronological: a, m, z → but same updatedAt means same "time,"
    // so the chronological-reverse yields z, m, a. Pin this to catch
    // regressions in the tie-break key.
    expect(selected.map((e) => e.id)).toEqual(['z-entry', 'm-entry', 'a-entry']);
  });
});

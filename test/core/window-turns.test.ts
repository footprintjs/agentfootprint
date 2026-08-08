/**
 * window/turns — the pure half of every strategy: where a turn boundary is,
 * which turns may leave, and which span a removal takes.
 *
 * These are the rules the whole family's safety rests on — shared by
 * compaction and both drop strategies — so they are tested without a
 * provider, a chart or a clock in the way. The wired behaviour lives in
 * `agent-compaction.test.ts` and `agent-window-strategies.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { LLMMessage } from '../../src/adapters/types.js';
import {
  answeredCallIds,
  planRemoval,
  refusalFor,
  segmentTurns,
  windowChars,
  type RemovalGuards,
  type Turn,
} from '../../src/core/agent/window/turns.js';
import { buildSummaryMessage } from '../../src/core/agent/window/summarize.js';
import { summarizeOldest } from '../../src/core/agent/window/strategies/summarizeOldest.js';
import { removalFacts } from '../../src/core/agent/window/removal.js';
import type { LLMProvider } from '../../src/adapters/types.js';
import type { CompactionRecord } from '../../src/core/agent/window/types.js';
import * as publicApi from '../../src/index.js';

// ─── Helpers ──────────────────────────────────────────────────────

const user = (content: string): LLMMessage => ({ role: 'user', content });
const assistant = (content: string, calls: string[] = []): LLMMessage => ({
  role: 'assistant',
  content,
  ...(calls.length > 0 && {
    toolCalls: calls.map((id) => ({ id, name: 'look', args: {} })),
  }),
});
const toolResult = (id: string, content = 'ok'): LLMMessage => ({
  role: 'tool',
  content,
  toolCallId: id,
  toolName: 'look',
});

/** A resolved 3-iteration ReAct conversation. */
function resolvedWindow(): LLMMessage[] {
  return [
    user('do the thing'),
    assistant('', ['c1']),
    toolResult('c1'),
    assistant('', ['c2']),
    toolResult('c2'),
    assistant('', ['c3']),
    toolResult('c3'),
  ];
}

const ctxFor = (history: readonly LLMMessage[], extra: Partial<RemovalGuards> = {}) =>
  ({ answeredCallIds: answeredCallIds(history), ...extra } as RemovalGuards);

const never = (): boolean => false;

// ─── Unit — segmentation ──────────────────────────────────────────

describe('segmentTurns — unit', () => {
  it('groups each tool result with the assistant turn that requested it', () => {
    const turns = segmentTurns(resolvedWindow());
    expect(turns.map((t) => t.length)).toEqual([1, 2, 2, 2]);
    expect(turns.map((t) => t.start)).toEqual([0, 1, 3, 5]);
    expect(turns.map((t) => t.messages[0]!.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'assistant',
    ]);
  });

  it('starts a new turn at every non-tool message', () => {
    const turns = segmentTurns([user('a'), user('b'), assistant('c')]);
    expect(turns).toHaveLength(3);
  });

  it('gives a leading tool message its own turn rather than dropping it', () => {
    const turns = segmentTurns([toolResult('orphan'), user('a')]);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.messages[0]!.role).toBe('tool');
  });

  it('is total: an empty window segments to no turns', () => {
    expect(segmentTurns([])).toEqual([]);
  });
});

// ─── Unit — foldability ───────────────────────────────────────────

describe('refusalFor — unit', () => {
  it('lets a fully resolved assistant+tool turn fold', () => {
    const history = resolvedWindow();
    const turns = segmentTurns(history);
    expect(refusalFor(turns[1]!, ctxFor(history))).toBeUndefined();
  });

  it('refuses a turn whose tool call has no result — the answer may still arrive', () => {
    const history = [user('go'), assistant('', ['c1'])];
    const turns = segmentTurns(history);
    expect(refusalFor(turns[1]!, ctxFor(history))).toBe('unresolved-tool-call');
  });

  it('refuses the turn holding the paused tool call, by that name', () => {
    const history = [user('go'), assistant('', ['c1', 'c2']), toolResult('c1')];
    const turns = segmentTurns(history);
    expect(refusalFor(turns[1]!, ctxFor(history, { pausedToolCallId: 'c2' }))).toBe('paused-tool');
  });

  it('names a pending check-in differently from a plain pause', () => {
    const history = [user('go'), assistant('', ['c1'])];
    const turns = segmentTurns(history);
    expect(
      refusalFor(turns[1]!, ctxFor(history, { pausedToolCallId: 'c1', pausedCheckIn: true })),
    ).toBe('pending-check-in');
  });

  it('never folds the system envelope', () => {
    const history: LLMMessage[] = [{ role: 'system', content: 'you are a bot' }, user('go')];
    const turns = segmentTurns(history);
    expect(refusalFor(turns[0]!, ctxFor(history))).toBe('system-envelope');
  });
});

// ─── Scenario — the fold span ─────────────────────────────────────

describe('planRemoval — scenario', () => {
  it('takes the oldest candidates and keeps the last K turns', () => {
    const history = resolvedWindow();
    const plan = planRemoval(segmentTurns(history), 2, ctxFor(history), never);
    expect([plan.from, plan.to]).toEqual([0, 1]);
    expect(plan.refusals.filter((r) => r.reason === 'inside-keep-window')).toHaveLength(2);
  });

  it('steps OVER an unfoldable oldest turn and folds the next oldest instead', () => {
    // Turn 1 has a dangling call; turns 2 and 3 are clean.
    const history = [
      user('go'),
      assistant('', ['dangling']),
      assistant('', ['c2']),
      toolResult('c2'),
      assistant('', ['c3']),
      toolResult('c3'),
      assistant('', ['c4']),
      toolResult('c4'),
    ];
    const plan = planRemoval(segmentTurns(history), 1, ctxFor(history), never);
    // Turn 0 (user) folds, turn 1 refuses and ENDS the span.
    expect([plan.from, plan.to]).toEqual([0, 0]);
    expect(plan.refusals.map((r) => r.reason)).toContain('unresolved-tool-call');
  });

  it('an unfoldable turn ENDS the span, so survivors never get reordered', () => {
    const history = [
      user('go'),
      assistant('', ['c1']),
      toolResult('c1'),
      assistant('', ['dangling']),
      assistant('', ['c3']),
      toolResult('c3'),
      assistant('', ['c4']),
      toolResult('c4'),
    ];
    const plan = planRemoval(segmentTurns(history), 1, ctxFor(history), never);
    expect([plan.from, plan.to]).toEqual([0, 1]);
  });

  it('folds nothing when every candidate refuses', () => {
    // Three turns, keepRecentTurns 2 → exactly one candidate, and it dangles.
    const history = [
      assistant('', ['dangling']),
      assistant('', ['c2']),
      toolResult('c2'),
      assistant('', ['c3']),
      toolResult('c3'),
    ];
    const plan = planRemoval(segmentTurns(history), 2, ctxFor(history), never);
    expect(plan.from).toBe(-1);
    expect(plan.refusals.map((r) => r.reason)).toContain('unresolved-tool-call');
  });

  it('folds nothing when keepRecentTurns covers the whole window', () => {
    const history = resolvedWindow();
    const plan = planRemoval(segmentTurns(history), 99, ctxFor(history), never);
    expect(plan.from).toBe(-1);
  });

  it('refuses to re-summarize a lone existing summary', () => {
    const history = [
      buildSummaryMessage('prior summary', { foldedMessageCount: 4, iteration: 2, model: 'm' }),
      assistant('', ['c1']),
      toolResult('c1'),
    ];
    const plan = planRemoval(segmentTurns(history), 1, ctxFor(history), (t) => t.index === 0);
    expect(plan.from).toBe(-1);
    expect(plan.refusals.map((r) => r.reason)).toContain('only-existing-summary');
  });

  it('folds an existing summary again once a real turn joins it', () => {
    const history = [
      buildSummaryMessage('prior summary', { foldedMessageCount: 4, iteration: 2, model: 'm' }),
      assistant('', ['c1']),
      toolResult('c1'),
      assistant('', ['c2']),
      toolResult('c2'),
    ];
    const plan = planRemoval(segmentTurns(history), 1, ctxFor(history), (t) => t.index === 0);
    expect([plan.from, plan.to]).toEqual([0, 1]);
  });
});

// ─── Property — invariants over generated windows ─────────────────

describe('planRemoval — property', () => {
  it('the span never reaches into the keep window, for any K and any length', () => {
    for (let turnCount = 1; turnCount <= 12; turnCount++) {
      const history: LLMMessage[] = [user('go')];
      for (let i = 1; i < turnCount; i++) {
        history.push(assistant('', [`c${i}`]), toolResult(`c${i}`));
      }
      const turns = segmentTurns(history);
      for (let keep = 1; keep <= 8; keep++) {
        const plan = planRemoval(turns, keep, ctxFor(history), never);
        if (plan.from === -1) continue;
        expect(plan.to).toBeLessThan(Math.max(0, turns.length - keep));
      }
    }
  });

  it('a folded span is always tool-pair complete — no result is orphaned', () => {
    const history = resolvedWindow();
    const turns = segmentTurns(history);
    const plan = planRemoval(turns, 1, ctxFor(history), never);
    const span = history.slice(
      turns[plan.from]!.start,
      turns[plan.to]!.start + turns[plan.to]!.length,
    );
    const idsRequested = new Set<string>();
    for (const m of span) for (const c of m.toolCalls ?? []) idsRequested.add(c.id);
    const idsAnswered = new Set(span.filter((m) => m.role === 'tool').map((m) => m.toolCallId!));
    expect([...idsRequested].sort()).toEqual([...idsAnswered].sort());
    // And the survivors carry no orphaned results either.
    const survivors = history.slice(turns[plan.to]!.start + turns[plan.to]!.length);
    for (const m of survivors.filter((x) => x.role === 'tool')) {
      const requestedBySurvivor = survivors.some((s) =>
        (s.toolCalls ?? []).some((c) => c.id === m.toolCallId),
      );
      expect(requestedBySurvivor).toBe(true);
    }
  });
});

// ─── Unit — measurement ───────────────────────────────────────────

describe('windowChars — unit', () => {
  it('sums content length exactly and is zero for an empty window', () => {
    expect(windowChars([])).toBe(0);
    expect(windowChars([user('abc'), assistant('de')])).toBe(5);
  });
});

// ─── Unit — the window strategy, with no chart in the way ─────────
//
// The stage does the wiring (read the meter, write the window, emit, record,
// cost); the strategy answers the one interesting question. That split is
// what makes this testable with nothing but data — and since 7.17 it is what
// a consumer's own strategy plugs into.

describe('summarizeOldest — unit', () => {
  const okSummarizer: LLMProvider = {
    name: 'sum',
    complete: async () => ({
      content: 'S',
      toolCalls: [],
      usage: { input: 7, output: 3 },
      stopReason: 'stop',
    }),
  };

  const inputFor = (history: readonly LLMMessage[], measuredInput = 900) => {
    const turns = segmentTurns(history);
    const guards = ctxFor(history);
    const origins = history.map((_, i) => ({ stageId: `writer#${i}`, bornAtMs: 1000 }));
    return {
      history,
      turns,
      measured: { input: measuredInput, output: 5 },
      iteration: 3,
      agentModel: 'main',
      providerName: 'mock',
      signal: undefined,
      now: () => 1500,
      planRemoval: (keep: number, isExistingSummary?: (turn: Turn) => boolean) =>
        planRemoval(turns, keep, guards, isExistingSummary),
      removalFacts: (indices: readonly number[], atMs: number) =>
        removalFacts(origins, indices, atMs),
    };
  };

  /** A window whose turns are long enough that folding them actually helps. */
  function bigWindow(): LLMMessage[] {
    return [
      user('go '.repeat(200)),
      assistant('', ['c1']),
      toolResult('c1', 'x'.repeat(600)),
      assistant('', ['c2']),
      toolResult('c2', 'y'.repeat(600)),
      assistant('', ['c3']),
      toolResult('c3', 'z'.repeat(600)),
    ];
  }

  it('returns a smaller window, the stages it folded, and honest evictions', async () => {
    const history = bigWindow();
    const strategy = summarizeOldest({
      thresholdTokens: 100,
      keepRecentTurns: 1,
      summarizer: okSummarizer,
      model: 'cheap',
    });
    const result = (await strategy.plan(inputFor(history)))!;

    expect(result.window).toBeDefined();
    expect(result.budgetPressure?.planAction).toBe('summarize');
    expect(result.record.strategy).toBe('summarize-oldest');
    expect(result.record.windowCharsAfter).toBeLessThan(result.record.windowCharsBefore);
    expect(result.record.removedStageIds).toEqual([
      'writer#0',
      'writer#1',
      'writer#2',
      'writer#3',
      'writer#4',
    ]);
    // 9.0.0 — `removedStageIds` is the only name. The 7.16 spelling
    // (`foldedStageIds`) was published beside it from 7.17 and removed here:
    // it is the FAMILY field on `WindowRecord`, and only one of the three
    // shipped strategies folds anything, so a fold-flavoured alias made the
    // other two read like they were missing a field.
    expect(Object.hasOwn(result.record, 'foldedStageIds')).toBe(false);
    expect(Object.hasOwn(result.record, 'foldedMessageCount')).toBe(false);
    expect((result.record as CompactionRecord).summarizerTokens).toEqual({ input: 7, output: 3 });
    // survivalMs is measured, not invented: born at 1000, folded at 1500.
    expect(result.evictions.every((e) => e.survivalMs === 500)).toBe(true);
    expect(result.spend).toEqual({ model: 'cheap', usage: { input: 7, output: 3 } });
  });

  it('does not engage before the first call, or under budget', async () => {
    const strategy = summarizeOldest({
      thresholdTokens: 100,
      summarizer: okSummarizer,
      model: 'summarizer-model',
    });
    const history = bigWindow();
    expect(await strategy.plan({ ...inputFor(history), measured: undefined })).toBeUndefined();
    expect(await strategy.plan(inputFor(history, 50))).toBeUndefined();
  });

  it('changes nothing and names the reason when the summarizer throws', async () => {
    const broken: LLMProvider = {
      name: 'broken',
      complete: async () => {
        throw new Error('down');
      },
    };
    const history = bigWindow();
    const strategy = summarizeOldest({
      thresholdTokens: 100,
      keepRecentTurns: 1,
      summarizer: broken,
      model: 'summarizer-model',
    });
    const result = (await strategy.plan(inputFor(history)))!;

    expect(result.window).toBeUndefined();
    expect(result.budgetPressure?.planAction).toBe('none');
    expect(result.record.windowCharsAfter).toBe(result.record.windowCharsBefore);
    expect(result.record.refusals.map((r) => r.reason)).toContain('summarizer-failed');
    expect(result.warning).toMatch(/summarizer threw/);
  });

  it('always explains itself: every engaged path returns a record', async () => {
    const history = bigWindow();
    const strategy = summarizeOldest({
      thresholdTokens: 100,
      keepRecentTurns: 99,
      summarizer: okSummarizer,
      model: 'summarizer-model',
    });
    const result = (await strategy.plan(inputFor(history)))!;
    expect((result.record as CompactionRecord).overBudget).toBe(true);
    expect(result.record.removedMessageCount).toBe(0);
    expect(result.record.refusals.length).toBeGreaterThan(0);
  });

  it('is PUBLIC — the strategy seam ships as of 7.17', () => {
    const surface = Object.keys(publicApi);
    expect(surface).toContain('summarizeOldest');
    expect(surface).toContain('slidingWindow');
    expect(surface).toContain('tokenBudget');
    expect(surface).toContain('CompactionUnmeasurableError');
    // Types are erased at runtime; the type-level surface is pinned in
    // test/type-regressions/window-strategy.ts.
  });
});

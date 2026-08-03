/**
 * compaction/turns — the pure half of the fold: where a turn boundary is,
 * which turns may fold, and which span a fold takes.
 *
 * These are the rules the whole feature's safety rests on, so they are tested
 * without a provider, a chart or a clock in the way. The wired behaviour lives
 * in `agent-compaction.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { LLMMessage } from '../../src/adapters/types.js';
import {
  answeredCallIds,
  planFold,
  refusalFor,
  segmentTurns,
  windowChars,
  type FoldabilityContext,
} from '../../src/core/agent/compaction/turns.js';
import { buildSummaryMessage } from '../../src/core/agent/compaction/summarize.js';
import { summarizeOldestStrategy } from '../../src/core/agent/compaction/strategy.js';
import type { LLMProvider } from '../../src/adapters/types.js';
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

const ctxFor = (history: readonly LLMMessage[], extra: Partial<FoldabilityContext> = {}) =>
  ({ answeredCallIds: answeredCallIds(history), ...extra } as FoldabilityContext);

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

describe('planFold — scenario', () => {
  it('takes the oldest candidates and keeps the last K turns', () => {
    const history = resolvedWindow();
    const plan = planFold(segmentTurns(history), 2, ctxFor(history), never);
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
    const plan = planFold(segmentTurns(history), 1, ctxFor(history), never);
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
    const plan = planFold(segmentTurns(history), 1, ctxFor(history), never);
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
    const plan = planFold(segmentTurns(history), 2, ctxFor(history), never);
    expect(plan.from).toBe(-1);
    expect(plan.refusals.map((r) => r.reason)).toContain('unresolved-tool-call');
  });

  it('folds nothing when keepRecentTurns covers the whole window', () => {
    const history = resolvedWindow();
    const plan = planFold(segmentTurns(history), 99, ctxFor(history), never);
    expect(plan.from).toBe(-1);
  });

  it('refuses to re-summarize a lone existing summary', () => {
    const history = [
      buildSummaryMessage('prior summary', { foldedMessageCount: 4, iteration: 2, model: 'm' }),
      assistant('', ['c1']),
      toolResult('c1'),
    ];
    const plan = planFold(segmentTurns(history), 1, ctxFor(history), (t) => t.index === 0);
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
    const plan = planFold(segmentTurns(history), 1, ctxFor(history), (t) => t.index === 0);
    expect([plan.from, plan.to]).toEqual([0, 1]);
  });
});

// ─── Property — invariants over generated windows ─────────────────

describe('planFold — property', () => {
  it('the span never reaches into the keep window, for any K and any length', () => {
    for (let turnCount = 1; turnCount <= 12; turnCount++) {
      const history: LLMMessage[] = [user('go')];
      for (let i = 1; i < turnCount; i++) {
        history.push(assistant('', [`c${i}`]), toolResult(`c${i}`));
      }
      const turns = segmentTurns(history);
      for (let keep = 1; keep <= 8; keep++) {
        const plan = planFold(turns, keep, ctxFor(history), never);
        if (plan.from === -1) continue;
        expect(plan.to).toBeLessThan(Math.max(0, turns.length - keep));
      }
    }
  });

  it('a folded span is always tool-pair complete — no result is orphaned', () => {
    const history = resolvedWindow();
    const turns = segmentTurns(history);
    const plan = planFold(turns, 1, ctxFor(history), never);
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
// what makes this testable with nothing but data.

describe('summarizeOldestStrategy — unit', () => {
  const okSummarizer: LLMProvider = {
    name: 'sum',
    complete: async () => ({
      content: 'S',
      toolCalls: [],
      usage: { input: 7, output: 3 },
      stopReason: 'stop',
    }),
  };

  const inputFor = (history: readonly LLMMessage[], measuredTokens = 900) => ({
    history,
    turns: segmentTurns(history),
    origins: history.map((_, i) => ({ stageId: `writer#${i}`, bornAtMs: 1000 })),
    measuredTokens,
    foldability: ctxFor(history),
    iteration: 3,
    signal: undefined,
    now: () => 1500,
  });

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
    const strategy = summarizeOldestStrategy(
      { thresholdTokens: 100, keepRecentTurns: 1, summarizer: okSummarizer, model: 'cheap' },
      'main',
    );
    const result = await strategy.plan(inputFor(history));

    expect(result.window).toBeDefined();
    expect(result.planAction).toBe('summarize');
    expect(result.record.windowCharsAfter).toBeLessThan(result.record.windowCharsBefore);
    expect(result.record.foldedStageIds).toEqual([
      'writer#0',
      'writer#1',
      'writer#2',
      'writer#3',
      'writer#4',
    ]);
    expect(result.record.summarizerTokens).toEqual({ input: 7, output: 3 });
    // survivalMs is measured, not invented: born at 1000, folded at 1500.
    expect(result.evictions.every((e) => e.survivalMs === 500)).toBe(true);
    expect(result.spend).toEqual({ model: 'cheap', usage: { input: 7, output: 3 } });
  });

  it('changes nothing and names the reason when the summarizer throws', async () => {
    const broken: LLMProvider = {
      name: 'broken',
      complete: async () => {
        throw new Error('down');
      },
    };
    const history = bigWindow();
    const strategy = summarizeOldestStrategy(
      { thresholdTokens: 100, keepRecentTurns: 1, summarizer: broken, model: undefined },
      'main',
    );
    const result = await strategy.plan(inputFor(history));

    expect(result.window).toBeUndefined();
    expect(result.planAction).toBe('none');
    expect(result.record.windowCharsAfter).toBe(result.record.windowCharsBefore);
    expect(result.record.refusals.map((r) => r.reason)).toContain('summarizer-failed');
    expect(result.warning).toMatch(/summarizer threw/);
  });

  it('always explains itself: every path returns a record', async () => {
    const history = bigWindow();
    const strategy = summarizeOldestStrategy(
      { thresholdTokens: 100, keepRecentTurns: 99, summarizer: okSummarizer, model: undefined },
      'main',
    );
    const result = await strategy.plan(inputFor(history));
    expect(result.record.overBudget).toBe(true);
    expect(result.record.foldedMessageCount).toBe(0);
    expect(result.record.refusals.length).toBeGreaterThan(0);
  });

  it('is INTERNAL — the strategy seam is not on the public API yet', () => {
    const surface = Object.keys(publicApi);
    expect(surface).not.toContain('summarizeOldestStrategy');
    expect(surface).not.toContain('WindowStrategy');
    // What IS public is the option bag and the error.
    expect(surface).toContain('CompactionUnmeasurableError');
  });
});

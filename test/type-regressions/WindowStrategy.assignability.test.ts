/**
 * Compile-level regression test — 7.17 made the window-strategy seam PUBLIC.
 *
 * Three things have to stay true at the TYPE level, and none of them is
 * observable at runtime, so they are pinned by the real compiler here (this
 * file lives under ./tsconfig.json, run via `npm run test:types`, while its
 * name still matches `test/**\/*.test.ts` so `npm test` runs the assertions
 * too):
 *
 *   1. A consumer can WRITE a strategy against the exported types alone and
 *      hand it to `.window(...)`. If any part of the seam stops being
 *      exported, or the shape drifts, this stops compiling — which is the
 *      only way to notice, since a barrel omission is silent at runtime.
 *   2. `CompactionRecord` is still assignable to `WindowRecord`. The family
 *      record grew out of the shipped one; if they ever diverge, every
 *      consumer reading `scope.compactions` breaks.
 *   3. The 7.16 names still work. `FoldRefusal` / `FoldRefusalReason` are
 *      deprecated aliases, not removals, and code written against 7.16 must
 *      keep compiling unchanged.
 */
import { describe, expect, it } from 'vitest';
import type {
  CompactionRecord,
  CompactionRetention,
  FoldedConversation,
  FoldedSpan,
  FoldRefusal,
  FoldRefusalReason,
  RemovalPlan,
  SlidingWindowRecord,
  TokenBudgetRecord,
  Turn,
  WindowEviction,
  WindowRecord,
  WindowRefusal,
  WindowRefusalReason,
  WindowStrategy,
  WindowStrategyInput,
  WindowStrategyResult,
} from '../../src/index';
import {
  foldedMessages,
  foldedSpanFor,
  slidingWindow,
  summarizeOldest,
  tokenBudget,
} from '../../src/index';

/**
 * A third-party strategy, written using nothing but the public types: drop
 * every turn older than the keep window, once the window gets long.
 *
 * Note what it CANNOT do: it never sees the guards, only `planRemoval`'s
 * answer, so it cannot accidentally drop an unanswered tool call.
 */
function everyOtherTurn(keepRecentTurns: number): WindowStrategy {
  return {
    name: 'every-other-turn',
    async plan(input: WindowStrategyInput): Promise<WindowStrategyResult | undefined> {
      if (input.turns.length <= keepRecentTurns) return undefined;

      const plan: RemovalPlan = input.planRemoval(keepRecentTurns);
      const refusals: readonly WindowRefusal[] = plan.refusals;
      if (plan.from === -1) {
        const record: WindowRecord = {
          strategy: 'every-other-turn',
          iteration: input.iteration,
          removedStageIds: [],
          removedMessageCount: 0,
          windowCharsBefore: 0,
          windowCharsAfter: 0,
          refusals,
        };
        return { record, evictions: [] };
      }

      const first: Turn = input.turns[plan.from]!;
      const last: Turn = input.turns[plan.to]!;
      const start = first.start;
      const end = last.start + last.length;
      const indices = Array.from({ length: end - start }, (_, i) => start + i);
      const facts = input.removalFacts(indices, input.now());
      const evictions: readonly WindowEviction[] = facts.evictions;

      const record: WindowRecord = {
        strategy: 'every-other-turn',
        iteration: input.iteration,
        removedStageIds: facts.removedStageIds,
        removedMessageCount: indices.length,
        windowCharsBefore: 0,
        windowCharsAfter: 0,
        refusals,
      };
      return {
        window: [...input.history.slice(0, start), ...input.history.slice(end)],
        rebase: { headCount: start, keptTailCount: input.history.length - end },
        record,
        evictions,
      };
    },
  };
}

describe('the window-strategy seam is publicly writable (7.17)', () => {
  it('a consumer strategy satisfies WindowStrategy using exported types only', () => {
    const strategy: WindowStrategy = everyOtherTurn(4);
    expect(strategy.name).toBe('every-other-turn');
    expect(typeof strategy.plan).toBe('function');
  });

  it('every shipped factory returns a WindowStrategy', () => {
    const strategies: WindowStrategy[] = [
      slidingWindow({ keepRecentTurns: 4 }),
      tokenBudget({ thresholdTokens: 1000 }),
      summarizeOldest({
        thresholdTokens: 1000,
        summarizer: {
          name: 'x',
          complete: async () => ({
            content: '',
            toolCalls: [],
            usage: { input: 0, output: 0 },
            stopReason: 'stop',
          }),
        },
      }),
    ];
    expect(strategies.map((s) => s.name)).toEqual([
      'sliding-window',
      'token-budget',
      'summarize-oldest',
    ]);
  });

  it('every shipped record is assignable to the family record', () => {
    const compaction: CompactionRecord = {
      strategy: 'summarize-oldest',
      iteration: 1,
      measuredTokens: 10,
      thresholdTokens: 5,
      overBudget: true,
      removedStageIds: ['seed#0'],
      removedMessageCount: 2,
      foldedStageIds: ['seed#0'],
      foldedMessageCount: 2,
      windowCharsBefore: 100,
      windowCharsAfter: 50,
      summaryChars: 40,
      refusals: [],
    };
    const sliding: SlidingWindowRecord = {
      strategy: 'sliding-window',
      iteration: 1,
      keepRecentTurns: 4,
      removedStageIds: ['seed#0'],
      removedMessageCount: 2,
      windowCharsBefore: 100,
      windowCharsAfter: 50,
      turnsBefore: 6,
      turnsAfter: 4,
      refusals: [],
    };
    const budget: TokenBudgetRecord = {
      strategy: 'token-budget',
      iteration: 1,
      measuredTokens: 10,
      thresholdTokens: 5,
      overBudget: true,
      keepRecentTurns: 6,
      removedStageIds: ['seed#0'],
      removedMessageCount: 2,
      windowCharsBefore: 100,
      windowCharsAfter: 50,
      refusals: [],
    };

    const ledger: readonly WindowRecord[] = [compaction, sliding, budget];
    // The key `scope.compactions` holds all three; you narrow by `strategy`.
    expect(ledger.map((r) => r.strategy)).toEqual([
      'summarize-oldest',
      'sliding-window',
      'token-budget',
    ]);
    expect(ledger.every((r) => r.removedStageIds.length > 0)).toBe(true);
  });

  it('a consumer strategy can RETAIN what it removed, using exported types only', () => {
    // 8.2 made the durable half of the seam public too: a third-party strategy
    // that replaces messages with something standing for them can file the
    // spans, and the stage carries them onto the conversation. If `FoldedSpan`
    // or the `folded` field stops being exported, this stops compiling.
    const span: FoldedSpan = {
      summaryFingerprint: 'deadbeef',
      runId: 'run-1',
      iteration: 2,
      foldedAtMs: 1,
      model: 'm',
      messageCount: 2,
      removedStageIds: ['seed#0'],
      retained: 'conversation',
      messages: [{ role: 'user', content: 'hello' }],
    };
    const result: WindowStrategyResult = {
      record: {
        strategy: 'mine',
        iteration: 2,
        removedStageIds: ['seed#0'],
        removedMessageCount: 2,
        windowCharsBefore: 10,
        windowCharsAfter: 5,
        refusals: [],
      },
      evictions: [],
      folded: [span],
    };
    expect(result.folded?.[0]?.retained).toBe('conversation');

    // Both policies are namable, and the reader reads a bare conversation.
    const policies: CompactionRetention[] = ['conversation', 'discard'];
    const conversation: FoldedConversation = { folded: result.folded };
    expect(policies).toHaveLength(2);
    expect(foldedSpanFor(conversation, { role: 'user', content: 'nope' })).toBeUndefined();
    expect(foldedMessages(conversation).map((m) => m.content)).toEqual(['hello']);
  });

  it('the 7.16 refusal names still compile as aliases of the family names', () => {
    const reason: FoldRefusalReason = 'unresolved-tool-call';
    const asFamily: WindowRefusalReason = reason;
    const old: FoldRefusal = { reason, turnIndex: 0, messageIndex: 0 };
    const asNew: WindowRefusal = old;
    expect(asFamily).toBe('unresolved-tool-call');
    expect(asNew.turnIndex).toBe(0);
  });
});

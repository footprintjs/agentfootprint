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
 *   3. The 7.16 aliases are GONE (9.0.0). `FoldRefusal` / `FoldRefusalReason`
 *      were renamed to `WindowRefusal` / `WindowRefusalReason` in 7.17 —
 *      refusals are shared by every window strategy, and only one of them
 *      folds — and the old spellings shipped as deprecated aliases through
 *      8.x. So did the refusal-reason member `'summary-not-smaller'`, renamed
 *      `'replacement-not-smaller'` in 8.14.0 because the drop strategies
 *      reported it while having no summary at all. 9.0.0 removed all three,
 *      and their absence is pinned below at the type level — the only level
 *      where a resurrected alias would be visible.
 */
import { describe, expect, it } from 'vitest';
import type {
  CompactionRecord,
  CompactionRetention,
  FoldedConversation,
  FoldedSpan,
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

// The two 7.16 aliases are GONE from the root barrel (9.0.0), and these two
// suppressions ARE the assertion. `@ts-expect-error` fails the build when the
// line it guards has NO error — so if either name is ever re-exported, this
// file stops compiling and the resurrection has to be argued for. Type-only
// imports, erased at runtime; the array below just gives the test something
// to say out loud.
// @ts-expect-error FoldRefusal was renamed WindowRefusal in 7.17 and removed in 9.0.0
import type { FoldRefusal as _RemovedFoldRefusal } from '../../src/index';
// @ts-expect-error FoldRefusalReason was renamed WindowRefusalReason in 7.17 and removed in 9.0.0
import type { FoldRefusalReason as _RemovedFoldRefusalReason } from '../../src/index';

import {
  foldedMessages,
  foldedSpanFor,
  slidingWindow,
  summarizeOldest,
  tokenBudget,
} from '../../src/index';

/** Names the two `@ts-expect-error` imports above stand guard over. */
const REMOVED_IN_9 = ['FoldRefusal', 'FoldRefusalReason'] as const;

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
        // `model` is REQUIRED since 8.14.0 — omitting it no longer compiles,
        // which is the point: the old `?? agentModel` default either billed
        // the main model or shipped an unknown model id to another vendor.
        model: 'cheap',
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
      // 9.0.0 removed `foldedStageIds` / `foldedMessageCount`: the family
      // names below are the only spelling, on every strategy's record.
      removedStageIds: ['seed#0'],
      removedMessageCount: 2,
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

  it('the family refusal types are the only ones — the 7.16 aliases are gone (9.0.0)', () => {
    const reason: WindowRefusalReason = 'unresolved-tool-call';
    const refusal: WindowRefusal = { reason, turnIndex: 0, messageIndex: 0 };
    expect(reason).toBe('unresolved-tool-call');
    expect(refusal.turnIndex).toBe(0);

    // The absence of the two aliases is pinned by the `@ts-expect-error`
    // imports at the top of this file — see the note there.
    expect(REMOVED_IN_9).toEqual(['FoldRefusal', 'FoldRefusalReason']);
  });

  it("'summary-not-smaller' no longer narrows — 9.0.0 removed the 8.14.0 alias", () => {
    // No strategy ever wrote it after 8.14.0: `drop.ts` and
    // `summarizeOldest.ts` both emit `'replacement-not-smaller'`. The old
    // spelling claimed a SUMMARY the drop strategies never produce, so it
    // could not stay as a member of a union shared by all three.
    const renamed: WindowRefusalReason = 'replacement-not-smaller';
    expect(renamed).toBe('replacement-not-smaller');

    // @ts-expect-error 'summary-not-smaller' left WindowRefusalReason in 9.0.0
    const removed: WindowRefusalReason = 'summary-not-smaller';
    void removed;
  });
});

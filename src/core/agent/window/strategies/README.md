**Support** — three pure decisions: given the segmented turns and what the
provider counted, what should the window become.

## What it reads / what it writes
- Reads a `WindowStrategyInput` (turns, counts, options).
- Writes nothing: no scope, no events, no store. The duty to RECORD lives in the
  window stage, once, instead of once per strategy.
- One exception, stated because the role word would otherwise hide it:
  `drop.ts` · `fittingNotice` SELECTS which drop notice is served. It composes no words —
  `../notice.ts` owns every one of them — but it asks `buildDropNotice` twice,
  prefers the tool-names variant when it fits the span, falls back to the plain
  one, and returns `undefined` when neither fits. So this folder decides whether
  the model is told about the drop at all.

## The one law here
A strategy decides; it does not compose the words and it does not record. The
sentences belong to `../notice.ts`. Where a strategy chooses BETWEEN notices —
`drop.ts` only — it is making an attention-omission decision, and the note's law
says an attention omission must be VISIBLE: the drop count is the rung that is
never traded away, the tool names are the rung that is.

## A strategy never reads the ledger; the stage hands it what it may know

The findings ledger (`../../findings/`) is committed state, and a strategy
never touches scope — so a strategy learns a turn's standing the way it
learns what may leave: PRE-BOUND on its input. Since 9.102.0
`WindowStrategyInput.standingOf?: (turn) => Standing | undefined` is bound by
`../../stages/window.ts · buildWindowStage` from ONE read of
`scope.findingsLedger`, and only on an agent with `.findings()` — an unarmed
agent's strategy is handed the exact input object it always was. It is
OPTIONAL, so a strategy compiled before it existed keeps compiling
(`test/type-regressions/WindowStrategy.assignability.test.ts` pins that).

Why a strategy does not NEED it: 'facts last' is not a strategy. It is a
bounded hold in the refusal engine — a turn the model declared a `fact` is
refused by name as `'ledger-fact'`, up to `keepLedgerFacts`, with a stand-down
— and it arrives through `input.planRemoval(...)` under every strategy,
including one a consumer wrote, exactly as `'current-request'` and
`'last-tool-result'` do. No fourth strategy file was added; none of the three
shipped ones changed a byte; the contiguous span, `drop.ts` and the notice
ladder are untouched. The stage files what left and what was held
(`WindowRecord.droppedStandings`, `WindowRecord.ledgerFacts`) so a
consumer-written strategy's record carries them too.

What `standingOf` is FOR is a strategy that wants to ORDER or REPORT among the
turns the engine left removable — never to infer one: `undefined` means the
model said nothing, and a strategy that reads a result's text to guess a
standing has broken the ledger's first law. One example — a consumer strategy
that keeps the last N turns and names, in its own record, the standing of each
turn its span removed:

```ts
import type { Standing, WindowRecord, WindowStrategy } from 'agentfootprint';

interface StandingAwareRecord extends WindowRecord {
  readonly removedStandings: readonly (Standing | 'undeclared')[];
}

export function keepRecentNaming(keepRecentTurns: number): WindowStrategy {
  return {
    name: 'keep-recent-naming',
    async plan(input) {
      if (input.turns.length <= keepRecentTurns) return undefined;
      // The refusal engine has already held the request, the pins and the
      // declared facts — the span holds only what every rule let go.
      const plan = input.planRemoval(keepRecentTurns);
      if (plan.from < 0) return undefined;
      const removed = input.turns.slice(plan.from, plan.to + 1);
      const indices = removed.flatMap((t) => t.messages.map((_, i) => t.start + i));
      const facts = input.removalFacts(indices, input.now());
      // One contiguous span leaves, so the new window is head ++ tail — the
      // ONE seam the meter's rebase describes.
      const head = input.history.slice(0, removed[0]!.start);
      const tail = input.history.slice(removed[removed.length - 1]!.start + removed[removed.length - 1]!.length);
      const window = [...head, ...tail];
      const chars = (ms: readonly { content: string }[]) => ms.reduce((n, m) => n + m.content.length, 0);
      const record: StandingAwareRecord = {
        strategy: 'keep-recent-naming',
        iteration: input.iteration,
        removedStageIds: facts.removedStageIds,
        removedMessageCount: indices.length,
        windowCharsBefore: chars(input.history),
        windowCharsAfter: chars(window),
        refusals: plan.refusals,                       // 'ledger-fact' appears here when a fact was held
        // Present only under .findings(); absent means the model said nothing.
        removedStandings: removed.map((t) => input.standingOf?.(t) ?? 'undeclared'),
      };
      return {
        window,
        rebase: { headCount: head.length, keptTailCount: tail.length },
        record,
        evictions: facts.evictions,
      };
    },
  };
}
```

The stage still stamps `droppedObservations`, `droppedStandings`, `observations`
and `ledgerFacts` onto that record — a strategy that forgot to report is not a
strategy that hid something. Pinned by `test/core/window-ledger-fact.test.ts`
("stamped on a consumer-written strategy's record" and "the strategy is handed
`standingOf` under the arm — and the exact input it always was without").

## Files
- `drop.ts` — the mechanic both drop strategies share.
- `slidingWindow.ts` — keep the last N turns.
- `tokenBudget.ts` — compaction's trigger discipline, without the summarizer.
- `summarizeOldest.ts` — fold the oldest foldable turns into one summary.

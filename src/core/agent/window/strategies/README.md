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

## Files
- `drop.ts` — the mechanic both drop strategies share.
- `slidingWindow.ts` — keep the last N turns.
- `tokenBudget.ts` — compaction's trigger discipline, without the summarizer.
- `summarizeOldest.ts` — fold the oldest foldable turns into one summary.

**Mixed** — a narrowing of what the model is re-served each call, and a record
that says so.
Lens: `notice.ts` · `buildDropNotice` and `summarize.ts` ·
`buildSummaryMessage` — library-authored `role:'user'` turns that persist in
history — plus `currentRequest.ts` and `removal.ts`.
Trace: `types.ts` (`WindowRecord` / `CompactionRecord` / `droppedObservations`),
`folded.ts` (the door back to the originals).
Support: `turns.ts`, `toolNames.ts`, `options.ts`, `strategy.ts`, `errors.ts`,
`lastToolResult.ts`, `index.ts`.

## What it reads / what it writes
- Reads the window, the strategy's verdict, and the resolved retention policy.
- Writes the narrowed window plus the record of what left. A window strategy
  edits the WINDOW, never the LEDGER.

## The one law here
An attention omission must be VISIBLE: what left the window is said out loud,
in past tense, bound to the fold that removed it. What a role may not be told
about is a different question and is not decided here.

## Files
- `notice.ts` — the message a DROP leaves behind, and why it must exist.
- `summarize.ts` — the authored frame around an untrusted summary.
- `currentRequest.ts` — which message is the thing the run was asked to do.
- `turns.ts` — where a turn boundary is, and which turns may leave.
- `folded.ts` — join a summary back to what it stands for ("folded" here is
  compaction, not the Fold role).
- `removal.ts`, `toolNames.ts`, `lastToolResult.ts`, `options.ts`,
  `strategy.ts`, `types.ts`, `errors.ts`, `index.ts`.

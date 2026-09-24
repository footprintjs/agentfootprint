**Mixed** — a narrowing of what the model is re-served each call, and a record
that says so.
Lens: `notice.ts` · `buildDropNotice` and `summarize.ts` ·
`buildSummaryMessage` — library-authored `role:'user'` turns that persist in
history — plus `currentRequest.ts` and `removal.ts`.
Trace: `types.ts` (`WindowRecord` / `CompactionRecord` / `droppedObservations`
/ `droppedStandings`), `folded.ts` (the door back to the originals).
Support: `turns.ts`, `toolNames.ts`, `options.ts`, `strategy.ts`, `errors.ts`,
`lastToolResult.ts`, `ledgerFactPins.ts`, `index.ts`.

## What it reads / what it writes
- Reads the window, the strategy's verdict, and the resolved retention policy.
- Writes the narrowed window plus the record of what left. A window strategy
  edits the WINDOW, never the LEDGER.

## The one law here
An attention omission must be VISIBLE: what left the window is said out loud,
in past tense, bound to the fold that removed it. What a role may not be told
about is a different question and is not decided here.

## The fact hold (9.102.0): a declared fact stays, noise leaves first

Why: under `slidingWindow` the refusal engine saw a result the model had
declared a `fact` and a result it had declared `noise` as the same bytes, so
recency decided which left — measured on `bench/findings-context.mjs`, the
ledger piece carried every declared fact to the answer turn while the wire
carried two of six verbatim. The findings ledger (`../findings/`) already
says which is which, by the model's own hand, so the window reads THAT and
nothing else.

The law: **a turn whose result the model declared a `fact` is held beyond
`keepRecentTurns`, newest first, up to `keepLedgerFacts` (default 4 under
`.findings()` with a window strategy), and the record names the hold.** It is a
BOUNDED HOLD in the refusal engine — `ledgerFactPins.ts · ledgerFactPinsOf`
(the content-aware twin of `lastToolResult.ts · toolResultPinsOf`), admitted by
`turns.ts · planRemoval` against its own ceiling, refused by name as
`'ledger-fact'` — so every strategy, including one a consumer wrote, gets it
through `planRemoval` without knowing it exists. 'Noise first' then follows
with no second mechanism: `noise`, `ruled-out`, `open` and undeclared turns are
unpinned and leave oldest-first exactly as they always did, and a judged noise
turn that outlives a fact is a ticket on the wire (`../findings/serve.ts ·
collapseJudged`), so it costs bytes the wire no longer pays. No strategy file
was added and the contiguous span is untouched.

Four bounds, and none is optional — a fact hold never exists without its
ceiling and its stand-down:

- **By the model's claim only.** A Turn is the removal unit, so its standing
  is its most valuable result's (`ledgerFactPins.ts · turnStandingOf`, rank
  `fact > open > undeclared > ruled-out > noise`); a batch that answered one
  fact beside two noise results is one slot and the noise stays with it. The
  library never reads a result's text to second-guess a standing; a result
  the model never judged is undeclared and is NOT held.
- **The ceiling, spent newest first.** `turns.ts · spendCeiling` is the ONE
  spender for both pins: a pin already inside `keepRecentTurns` costs nothing
  (the free-pin law), the rest are admitted newest first up to the limit, and
  the remainder is `yielded` on the record. `0` / `false` switches the hold
  off and the window plans exactly as it did before the ledger existed.
- **Anchored.** Nothing at or before the current request is pinnable, so a
  new user turn releases the whole previous loop.
- **The stand-down.** `../stages/window.ts · pinIsBlocking` reads the last
  TWO records: when both removed nothing and both named only pins, the fact
  pins release for this visit and the record says so. The fact pin reads the
  whole pin FAMILY (`'last-tool-result'` and/or `'ledger-fact'`) because
  `turns.ts · refusalFor` names the recency pin first for a turn both hold —
  a fact stand-down that read only its own name would never see that turn
  blocking and the two pins would alternate under each other's name forever.
  The recency pin's own stand-down still reads only its own name, so its
  9.57.0 rule is unchanged.

Refusal order in `turns.ts · refusalFor`: current-request → system-envelope →
paused-tool / pending-check-in → unresolved-tool-call → last-tool-result →
`'ledger-fact'` — every reason before the two pins is a fact about the wire or
a human; the pins are policy and come last, so a held fact turn that also
holds the request reports the request.

One example — the record the fifth visit files when a declared fact is held
past the keep window and a noise turn leaves ahead of it. Generated, not
hand-written: an armed agent under `slidingWindow({ keepRecentTurns: 2 })`,
the mock declaring `c1` a fact and `c2` noise, as
`test/core/tools/reference/agent-findings-window.json` records it (keys
reordered here, values as recorded):

```ts
{
  strategy: 'sliding-window',
  iteration: 5,
  keepRecentTurns: 2,
  turnsBefore: 5,
  turnsAfter: 4,
  windowCharsBefore: 70,
  windowCharsAfter: 53,
  removedStageIds: ['tool-calls#42'],
  removedMessageCount: 2,
  refusals: [
    { reason: 'current-request',    turnIndex: 0, messageIndex: 0 },
    { reason: 'ledger-fact',        turnIndex: 1, messageIndex: 1 },  // ← c1, declared a fact, stays
    { reason: 'inside-keep-window', turnIndex: 3, messageIndex: 5 },
    { reason: 'inside-keep-window', turnIndex: 4, messageIndex: 7 },
  ],
  droppedObservations: ['alpha_tool'],                            // whose RESULTS left (tool names)
  droppedStandings: [{ toolCallId: 'c2', standing: 'noise' }],   // whose STANDING left — the model's claim
  ledgerFacts: {                                                  // what the hold kept, and what it cost
    pinned: [{ toolName: 'alpha_tool', turnIndex: 1, chars: 17 }],
    yielded: 0,
    limit: 4,
  },
}
```

Turn 2 (`c2`, noise) sat BETWEEN the held fact and the keep window and left
anyway: the span starts at the oldest removable turn, so a hold does not
shield what is younger than it. Two visits later the record's
`droppedStandings` is `[{ toolCallId: 'c5' }]` — no `standing`, because the
model never named `c5`: undeclared, filed as the absence it is.

`droppedStandings` is filed by the STAGE, so a consumer-written strategy's
record carries it too; `standing` absent there is undeclared, never a verdict
the library inferred. Both keys are armed-only and value-conditional: an agent
without `.findings()` files the exact record it always did, and its strategy is
handed the exact `WindowStrategyInput` it always was (`standingOf` is present
only under the arm). The words the model is told are unchanged — `notice.ts ·
buildDropNotice` names tools and counts, never a standing and never the
model's line.

Pinned by `test/core/window-ledger-fact.test.ts` (the pin, the ceiling, the
free pin, the stand-down family, thirty iterations under both drop strategies,
the unarmed byte identity); design: `docs/design/2026-09-findings-ledger.md`
§ Step 4.

## A settled message names no tool (9.113.0)

**A `role: 'tool'` message that carries `LLMMessage.notDispatched` is no tool's
result, so the window names no tool for it** (`toolNames.ts` ·
`toolNameOfMessage`).

Why: when a batch of calls pauses, the resume answers each call after the
paused one with the library's fixed sentence and never runs it
(`../stages/toolCalls.ts` · "── The batch settlement (9.113.0)"). The message
has a `role: 'tool'` and a `toolName`. Named as that tool's latest result, it
moved the last-tool-result pin off the tool's real, earlier result and onto
the sentence, so the evidence the pin exists to keep could leave (the
measured failure in `lastToolResult.ts`). Every reader of the name inherits
the answer from the one helper: the pin, the drop notice and
`WindowRecord.droppedObservations`, and the dangling-reference check in
`../stages/callLLM.ts`. That check names the frame from the committed history
the stage already read at its top, because the wire has lost the marker —
never from a second read, which would add a narrative step to every run it
checks. A run with no settled message names exactly what it named before.

A settled message has no STANDING either: a turn's standing is its most
valuable RESULT's, and `ledgerFactPins.ts` · `turnStandingOf` and
`ledgerFactPinsOf` skip it by `../findings/offer.ts` · `isResultMessage` — so a
batch whose results the model judged all noise still reads `noise` through
`WindowStrategyInput.standingOf`, and a `fact` the model filed on the settled
id (`unknownId`) holds nothing.

```ts
// whats_here ran once (a1); later the batch [collect_input, whats_here]
// paused on collect_input, and the resume SETTLED whats_here (c2).
toolResultPinsOf(segmentTurns(history), history, anchor); // messageIndex, chars omitted
// → [{ toolName: 'collect_input', turnIndex: 2 }, { toolName: 'whats_here', turnIndex: 1 }]
//   whats_here's pin stays on turn 1, the real result. The settled c2 would
//   have taken it: [{ toolName: 'whats_here', turnIndex: 2 }].
```

Pinned by `test/core/window-last-tool-result.test.ts`,
`test/core/window-drop-observations.test.ts`,
`test/core/window-ledger-fact-pins.test.ts`,
`test/integrity/danglingReference.test.ts` (the narrative too) and, end to
end, `test/core/scenario/batch-pause-settlement.test.ts`.

## Files
- `notice.ts` — the message a DROP leaves behind, and why it must exist.
- `summarize.ts` — the authored frame around an untrusted summary.
- `currentRequest.ts` — which message is the thing the run was asked to do.
- `turns.ts` — where a turn boundary is, and which turns may leave.
- `lastToolResult.ts` — the content-blind pin: each tool's latest result.
- `ledgerFactPins.ts` — the content-aware pin: the turns the model declared
  facts, by its own ledger; `turnStandingOf` gives a Turn one standing.
- `folded.ts` — join a summary back to what it stands for ("folded" here is
  compaction, not the Fold role).
- `removal.ts`, `toolNames.ts`, `options.ts`, `strategy.ts`, `types.ts`,
  `errors.ts`, `index.ts`.

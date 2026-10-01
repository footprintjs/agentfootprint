**Mixed** — what the run can still prove it read, and the sentences that carry
the verdict back.
Fold: `evidenceIndex.ts` (the corpus, the exempt corpus, the turn stamp, the
carriers), `normalize.ts`, `extract.ts`, `types.ts`. One fold, asked at two
moments and never stored: `../stages/route.ts` · `judgeEvidence` at the
answer (handed to `gate.ts` as a parameter), and since 9.110.0
`../stages/toolCalls.ts` · `towersFor` at dispatch, under `.findings()`
beside the gate only, for the contingent check's second moment.
Lens: `recovery.ts` · `buildEvidenceRecovery` — request-only system context for
the revision. `gate.ts` · `buildEvidenceCorrection` remains a legacy compatibility
helper; runtime repair no longer adds its synthetic conversation turns.
Not model-facing: `gate.ts` · `evidenceRefusalSentence`, `errors.ts` (the caller reads them).

# `evidence/` — names and numbers must come from a tool result

`.namesAndNumbersFromEvidence()` (9.35.0). Every number, identifier and name in
the model's final answer has to appear in a tool result the run actually read.
One that does not was **typed rather than read**.

## What it is not

**A fabrication detector, not a correctness judge.** It catches invented
values. It cannot catch a false claim assembled from real values — *"fc1/3 is
healthy"* when the data says the port is down uses entirely grounded tokens and
passes without a murmur. A reader who takes this for a hallucination check will
trust it for the one thing it provably cannot do, which is why the option is
not called `groundedness` and not called `hallucination`.

The check is lexical. It does not prove that a question was interpreted
correctly, a tool argument came from the user, or a claim follows from the
evidence. A guessed argument echoed in a tool result can satisfy token
membership. Recovery guidance does not close those gaps.

## The one non-negotiable property

**The check is deterministic.** Set membership over normalized tokens: no
second model, no embedding, no judge. The library's thesis is that structure
lets a smaller model perform like a bigger one, so a guard that needed a bigger
model to police the small one would invert the value proposition and would fail
exactly where the small model is deployed. That constraint is why the extractor
looks the way it does, and it is stated again at the top of `gate.ts`.

## Files

| file | one job |
|---|---|
| `types.ts` | the public vocabulary: posture, shape, options, verdict |
| `normalize.ts` | one spelling per value, on BOTH sides (`41,200` ≡ `41200`). The other spellings of a date or clock time are NOT here: since time step T7 they are asked of `core/time/forms.ts` · `timeFormsOf` (its `said` list, by the exempt corpus only) |
| `extract.ts` | which tokens in an answer are DATA — the conservative rule |
| `evidenceIndex.ts` | the structural walk of tool results, and the exempt corpus; `readResult` is the ONE reading of a result |
| `servedJson.ts` | a served result that is NOT one JSON value, read by the JSON grammar: its leading value(s) — the tool's JSON before a framework note (a step banner, an effect note, the repeated-call note), an MCP text result's several blocks — and the text after them, and the complete leaves of JSON cut short (a capped result's `head`, a tool that truncated its own output) — never the token the cut falls inside — plus, when the cut falls inside a string, that string's whole words up to its last space, read as text (the word the cut may have split is left out: `mo` may be `more`). Read whole as text, `{"id":4417}` tokenises to `:4417`: every number and boolean the tool returned read as absent, a false flag at the gate and a false `not-in-result` in the inputs layer. Text that opens with a bracket and is not JSON stays text |
| `resultCarries.ts` | one result, read the index's way (`evidenceIndex.ts` · `readResult`), asked for one value (`resultReader`, `resultCarries`) — the inputs layer's declared-sources check asks whether a result carries the value the model says it took from it; loaded with that layer, never on a plain agent's graph |
| `figures.ts` | the figures dial (`figures: true`): which numbers the answer writes wearing a unit (`figureNumbersOf`), the results' numbers folded for the derivation question (`figureBasisOf`), and the question itself (`explainFigure`) — a closed set of derivations, at the answer's own precision. Loaded through `import()` by Route under the dial only (`stages/route.ts` · `loadFigures`; pinned off the root graph by `test/lib/trace-toolpack/browserGraph.test.ts`) |
| `answerCarriers.ts` | which of THIS turn's results the answer's values were read from (`answerCarriersOf`) — identities and counts, the whole list or none; rides `evidence_checked` as `carriedBy` |
| `gate.ts` | resolve options, judge an answer, write the sentences |
| `recovery.ts` | resolve bounded recovery guidance and compose the internal repair instruction |
| `errors.ts` | `UnsupportedValuesError` — the `rails` refusal at the boundary |
| `index.ts` | the door: what the main barrel publishes |

The token-checking functions are pure. Recovery may call the configured
synchronous guidance callback. The moving parts live in
`../stages/route.ts` (the judge, at the same seam `outputSchema` uses) and
`../stages/evidenceRecheck.ts` (the `guard` branch).

## The postures

Same three words as the skill-graph routing dial, a **separate** option:
routing authority and evidence discipline are different decisions.

| posture | what happens |
|---|---|
| `assist` (default) | record and flag; the answer goes out unchanged |
| `guard` | name the values back to the model, ONE revision, then flag |
| `rails` | the same one revision, then refuse: `run()` raises |

Every judgement lands on the emit channel as
`agentfootprint.agent.evidence_checked`, whatever the posture — that is where
per-attempt facts belong. Only the terminal verdict is committed
(`unsupportedValues`), because the boundary has to read it.

## Recovery guidance (9.96.0)

An unsupported draft under `guard` or `rails` gets the existing single revision.
Its correction now arrives in request-only system context: the rejected draft
is quoted as untrusted data, and no synthetic assistant/user turns are added
to conversation history. The legacy `buildEvidenceCorrection` export remains
available, but the runtime uses the new recovery delivery.

Use `recoveryInstruction` to teach what to do when the missing evidence cannot
be fetched:

```typescript
agent.namesAndNumbersFromEvidence({
  posture: 'rails',
  recoveryInstruction:
    'If required date or scope details are missing, ask the user for them. ' +
    'Do not suggest guessed years, timezones, identifiers or example values.',
});
```

The option accepts a string or synchronous
`(context: EvidenceRecoveryContext) => string | undefined`. The detached,
frozen context includes `kind: 'evidence'`, `attempt: 1`, `iteration`,
`originalRequest`, `rejectedDraft`, `unsupported`, and optional `stagedRefs`
and `spenderTools`. Treat draft values as untrusted data, not instructions.
Return `undefined` when no extra guidance is needed. Text is limited to 4,000
UTF-16 code units (`string.length`); invalid returns or thenables fail, and a
thrown callback error propagates. Do not perform asynchronous work here.
The complete recovery instruction, including the quoted draft, is refused
above 1,000,000 UTF-16 code units rather than truncated.

Custom guidance cannot replace the core recovery frame, change the checker,
or grant another revision. It is used only when the evidence gate requests a
repair; it does not validate tool arguments before execution or guarantee that
the model will ask a useful question. `assist` continues to record and flag
without requesting a repair.

This option does not withhold streamed draft tokens. Internal authorship of
the recovery instruction is not proof that a user never saw the rejected draft.

Run the [mock example](../../../../examples/features/69-evidence-repair.ts)
to inspect the guidance actually served and the resulting clarification.

## Figures — a number wearing a unit, and the arithmetic over the results (`figures: true`)

**The law: under the figures dial, a number wearing a unit of measure is data
whatever its length, and a number no result carried is flagged only after the
library has asked whether it is a declared derivation of the numbers the
results DO carry — and the flag says it matched neither.** Off (the default)
the gate is byte-identical.

Why: "how full is the cluster?" over a capacity result whose pool rows say
61.1% / 435.5 TB usable and 57.7% / 1,090.8 TB usable. A small model answered
"53.2% used, 6.3 TB free", and on a second run "64.5% used, 24.8 TB usable" —
figures in no row and derived from none, the kind someone provisions against.
The gate passed both CLEAN: each has fewer than `minDigits` digits, so the
extractor read it as prose, like "3 issues". And the honest answer to the same
question — "1,526.3 TB usable in total" — is a SUM, in no row, so the gate
flagged it as invented. One rule failed in both directions.

| the answer writes | off | on |
|---|---|---|
| `53.2%`, `6.3 TB`, `24.8TB`, `7 ms` (a number + `FIGURE_UNITS`) | prose (under `minDigits`) | a candidate, shape `figure` |
| `3 issues`, `24 hours`, `OneFS 9.5`, `1.5x` | prose | prose — no unit of measure |
| a number no result carried that is a rounding, unit conversion (÷1000^k, ÷1024^k), column sum (all rows, or the rows sharing one text value), like-unit ratio ×100 or difference of column sums, or a complement (100 − a `*pct` field or a ratio) of numbers the results carry | flagged (≥ `minDigits` digits) or prose | **computed** — `EvidenceVerdict.computed` / `evidence_checked.computed`, with `derivation` and `from` |
| a number that is none of those | flagged, or prose | **unsupported** — flagged, and the sentences say it matched no value and no derivation |

Comparisons are at the answer's own precision: `61%` is 61.1 rounded, `61.0%`
is not. Under `guard`/`rails` the revision request also carries the library's
conclusion as its LAST line (`figures.ts` · `figuresConclusionLine`,
request-only, rebuilt by `servedAt`, reason `'evidence-conclusion'`): which
numbers matched no value and no derivation, and to say plainly when no result
shows the figure asked for. Under the answer layer an unsupported figure folds
to "not sure" (`value-unsupported`), the reason it always had.

```ts
const agent = Agent.create({ provider, model })
  .tool(capacityTool) // rows: [{ pool, total_tb, used_tb, used_pct, usable_tb }, …]
  .namesAndNumbersFromEvidence({ posture: 'guard', figures: true })
  .build();

agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => {
  payload.unsupported; // "53.2% used, 6.3 TB free" → [{ value: '53.2', shape: 'figure' }, { value: '6.3', … }]
  payload.computed;    // "1,526.3 TB usable in total" →
                       // [{ value: '1526.3', shape: 'number', derivation: 'column-sum', from: 'sum of rows[].usable_tb' }]
});
```

What it is not: proof the arithmetic answered the question ("59.2% used" is
accepted as a ratio of two columns whichever pool the person asked about), and
not open-ended — an average, a product or a two-step derivation is not
reconstructed and is flagged. Every derivation is a window an invented number
can fall through by coincidence, so the set is closed and the window is the
answer's precision: ±0.5 for a whole number, ±0.05 for one decimal. Pinned by
`test/core/agent/evidence/figures.test.ts`.

## Why `guard` is a Route branch and not a loop of its own

It is a sibling of the `output-retry` branch, built the same way, carrying the
same `{ loopTo }`: a correction is not a special mode, it is one more ordinary
turn of the ReAct loop. So the revision gets its own `iteration_start` /
`llm_start` bracket and its own `cost.tick`, and the tools are still on the
wire — the model can go and FETCH the value it guessed at. One revision per
turn, latched, because a model that cannot ground a value on its second try
will not ground it on its fifth.

## The extractor, in one paragraph

A token is data only if it contains a digit AND is distinctive: an identifier
(digits mixed with letters or `: _ - / .`, ≥4 chars) or a number of ≥4 digits.
Prose wearing a number is excluded — `32G`, `47th`, `48-port` and `$20/month`
are judged on their number alone, and `24/7` is a ratio. Values the user
supplied (their message, the conversation, the system prompt and skill bodies)
are exempt without being declared. Declared `shapes` are tested first and win.

The bias is deliberate: a missed fabrication is a miss, a false accusation
costs a real turn and can refuse a good answer. See `extract.ts` for the
justification of each clause, and
`test/core/agent/evidence-false-positives.test.ts` for the measured rate on
realistic SAN answers.

## What the corpus actually reaches, and WHEN it was read (9.83.0)

The evidence corpus is every `role: 'tool'` turn in `scope.history` **as it
stands at judgement**. Not "the whole conversation": `.window()` /
`.compaction()` / `tokenBudget` rewrite `scope.history` in place, so on those
agents this is the LIVE WINDOW and a result the window has dropped is not in it.

Until 9.83.0 the gate's two sentences — the correction sent to the model and
the warning printed to an operator — both said the flagged values *"appear in
no tool result FROM THIS TURN"*. The index has never been turn-scoped, so the
library was asserting a boundary it did not measure. Both now say what the check
really reaches ("no tool result this run read"), which is also the stronger
claim.

The boundary itself is now measurable rather than asserted: every indexed form
carries the turn that last served it, and
`AgentOptions.noticePriorTurnEvidence` (default OFF) reports the answer that is
grounded entirely in earlier turns as a `prior-turn-evidence` advisory at the
claim seam. It reports; it never revises or refuses — that stays `posture`'s
decision. See `src/integrity/prior-turn-evidence/README.md`.

## Which result carried a value — the carriers map (9.110.0)

`EvidenceCorpus.carriers` sits beside `values`: for every indexed form,
the `toolCallId`s of THIS turn's `role: 'tool'` messages that carried it,
in wire order, each id once. Written by the same walk at the same leaf —
`values` says WHEN a value was last read, `carriers` says FROM WHERE — so
there is no second pass and no second budget: a form the token ceiling
refused has no carrier either. Two bounds, both stated on the entry:

- **This turn only.** The carriers of an earlier turn are dropped at each
  user-turn boundary (a value read four turns ago keeps its turn stamp and
  loses its carriers), so the map answers about the turn being judged.
- **At most `MAX_CARRIERS` (8) per value, then `truncated: true`.** A value
  nine results carried is a common value; the reader that needs "every
  carrier" (`../findings/contingent.ts`) treats a cut list as not judged
  rather than reading a verdict off a prefix.

- **Nothing past the token ceiling.** When `MAX_INDEX_TOKENS` is exhausted
  (`truncated: true`) the results after the cut carried nothing into the
  index, carriers included, so a reader that needs every carrier
  (`../findings/contingent.ts`) files nothing from such a corpus — the same
  flag under which the gate downgrades itself to record-only.

`checkAnswer` hands the values a result DID carry back on the verdict as
`EvidenceVerdict.grounded` — each candidate the corpus holds with the exact
spellings it was looked up under, exempt values left out, unclipped — the
answer-moment input of the contingent check; at dispatch
`groundedArgumentValues` reads the same rule over a call's string leaves. The
exempt corpus never files a carrier — an exemption names no result.

## Which results the answer cited — `carriedBy` (the answer's own carriers)

**The law: a host shows an answer's data from what the answer cites, and the
library says what it cites.** A turn can fetch a result and then answer from
something else — an earlier turn's rows, a computation over them, a sibling
call. A host that puts every fetched result under the answer presents the one
it cited nothing from as if the answer stood on it (a field report: a
follow-up fetched a second, wider rowset, answered from a computation over the
first, and both landed under the answer as "its data"). Only the library can
say which is which — the extractor, the spellings and the carriers are here —
so it does, on the verdict, as identities and counts:

- **On the verdicts of an answer that ships** (`grounded`, `flagged`,
  `refused`), `evidence_checked.carriedBy` lists each `role: 'tool'` result
  of THIS turn that carried at least one of the answer's grounded values:
  `values` (how many) and `only` (how many no other result of this turn
  carried). Never on `revision-asked` — a draft is not the answer.
- **Not listed ⇒ the answer cites nothing from it.** A fact about tokens,
  never about meaning: an answer that states no value ("one host was slow")
  can rest on a result it cites nothing from, so a host says "cites nothing
  from it", never "unused". `[]` is a fact too; `lookedUp` says whether the
  answer stated any value at all.
- **The whole list or none.** Absent when the index hit its token ceiling or
  one value was carried by more results than `MAX_CARRIERS` — a result past a
  cut is invisible, and "not listed" read off a prefix would be a false
  denial (`findings/contingent.ts` keeps the same law).
- **This turn only**, like the carriers map: a value taken from an earlier
  turn's result names no carrier.

```ts
agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => {
  if (payload.carriedBy === undefined || payload.action === 'revision-asked') return;
  const cited = new Set(payload.carriedBy.map((c) => c.toolCallId));
  // A dataset minted by call `toolCallId` (its `origin.toolCallId`) that is not
  // in `cited` carried none of the names and numbers this answer states.
  markDatasets((toolCallId) => (cited.has(toolCallId) ? 'cited' : 'cites-nothing'));
});
```

Pinned by `test/core/agent/evidence-carried-by.test.ts`.

## A compaction summary exempts nothing by itself

**A summary frame's TEXT never enters the exempt corpus. The frame carries
the forms its folded person/app turns exempted (`LLMMessage.foldedExempt`),
and only those.** One rule, one owner: `evidenceIndex.ts` ·
`addHistoryExempt`, asked by `exemptFromRun` (the corpus) and by
`exemptLineageOf` (the fold, `../window/strategies/summarizeOldest.ts`), so
what a turn exempted before a fold and what its summary carries after one
cannot disagree.

Why: `../window/summarize.ts` · `buildSummaryMessage` puts the summarizer's
text in a `role: 'user'` message. `lib/saidByPerson.ts` · `isSaidByPerson`
already said it was nobody's, but the exempt corpus excluded only the two
correction frames — so every value in the summary, invented ones included,
was exempt, and the gate skipped the names-and-numbers check for an answer
that repeated it. The contingent check (`../findings/contingent.ts`) skips
exempt values the same way, so a summary that echoed a value from a result
the model had declared open, noise or ruled-out waved it past that check too.

```ts
const summary = buildSummaryMessage('Synthetic audit example: invented-987654.', {
  foldedMessageCount: 2, iteration: 3, model: 'audit-mock', retain: 'conversation',
});
exemptFromRun({ history: [summary] }).has('invented-987654'); // false — was true

// A faithful fold: the person's value rides the lineage, read off the ORIGINAL.
const folded = [{ role: 'user', content: 'Check array ARR-2291.' }];
const frame = buildSummaryMessage('The user asked about ARR-2291.', {
  foldedMessageCount: 1, iteration: 3, model: 'm', retain: 'conversation',
  foldedExempt: exemptLineageOf(folded),
});
exemptFromRun({ history: [frame] }).has(normalizeToken('ARR-2291')); // true
```

What each check reads AFTER a fold:

| Input | Source after the fold |
|---|---|
| exempt corpus | the current request, the live user/system turns (corrections and summary TEXT excluded), the live typed-ask answers, every summary's `foldedExempt`, the system-prompt injections, declared defaults, answered values — each text with its date and clock-time spellings |
| evidence corpus (gate) | the `role: 'tool'` messages still in the window — a folded result is gone, exactly as a dropped one is; the pins (`keepLastToolResults`, the ledger-fact pin) decide which results stay |
| carriers + standing (contingent) | carriers from this turn's live tool messages; standing from `scope.findingsLedger`, which compaction never touches — a folded result keeps its standing under its `toolCallId`, and a value whose only carrier was folded has no carrier, so it files no contingent row and is judged by the gate as ungrounded unless exempt |

So a summarized tool value keeps its tool source — it is never promoted to
"supplied" by being repeated in a summary — and is judged against what the
window still holds.

- **`retain: 'conversation'`** — the lineage rides the summary; the verbatim
  originals ride the checkpoint's `FoldedSpan.messages` as before. The corpus
  reads the lineage, never the originals, so both policies take one path.
- **`retain: 'discard'`** — the originals are not kept, but the lineage (lookup
  forms, not messages) still rides the summary, so a person's value stays
  exempt on the next turn instead of reading as invented.
- **A restored summary** (a checkpoint, a stored conversation) carries the
  lineage it was folded with; a nested fold unions the lineage of any summary
  inside its span. A summary frame WITHOUT one — hand-built, or folded before
  the field existed — exempts nothing: a value it names is checked like any
  other (the narrow direction `isSaidByPerson` already takes).
- Correction frames (`[evidence check`, `[schema check`) stay excluded, and
  an agent that never folds builds exactly the corpus it always did.

Pinned by `test/core/agent/evidence/summary-exemption.test.ts`.

## The person's typed answer, and how they spell a date or a time

**A typed ask's answer is the person's words, and a date or clock time the
person (or the app) wrote is exempt in its other spellings. Nothing else is
widened: a value is exempt only when it IS, or respells, something the person
or the app said.** One owner each: `evidenceIndex.ts` · `typedAskAnswerOf`
(read by `addHistoryExempt`, so the corpus and a fold's lineage take it the
same way) and `core/time/forms.ts` · `timeFormsOf`'s `said` list for a text
(read through `evidenceIndex.ts` · `addExempt`, the exempt corpus's one text
door — until time step T7 this was a table private to this folder,
its `dateAndClockForms` in `normalize.ts`; the job moved, the cases did not).

Why: a person asked "what clients connected to SHISOLPLPAP006 during 10/09/26
8 Am to 8:40 AM PST" and answered the app's typed ask (`requestInput`) with
Date `2026-10-09`. The answer said "8:00 to 8:40 AM … 2026" and was marked
"2 values not traced" — `8:00` and `2026`, both the person's. Three gaps:

1. The typed answer lands as a `role: 'tool'` message (`input_received`), so
   it was read as a tool OBSERVATION, never as the person's words — windowed
   like a result, absent from a fold's lineage, and indexed as the token
   `2026-10-09`, which never matches `2026`.
2. Nothing indexed a date's components.
3. Nothing read `8 Am` (two tokens: `8`, `am`) as the `8:00` an answer writes.

The rules, each a SPELLING and never a reading:

| the person wrote | also exempt | never |
|---|---|---|
| a typed-ask field they answered (`origins[field] === 'response'`) | the value, its tokens, and its spellings below | a field the asking tool supplied (`'declaration'`) — it stays the tool's words, in the evidence corpus; a field the redaction rules hid (it reads as its placeholder) |
| an ISO date `2026-10-09` | `2026`, `10`, `9` | `10/09/2026` or `09/10/2026` — slash order is a locale, and picking one is reading the date |
| `8 Am`, `8:40 AM`, `8pm`, `8:40 p.m.` | `8:00` `08:00` `8:00am` · `8:40` `08:40` · `20:00` `8:00pm` · `20:40` `8:40pm` | a pm reading as its am twin (`8:40 p.m.` never exempts `08:40`) |
| `20:00`, `08:40` | `8:00` `8:00pm` · `8:40` `8:40am` | — the bound: `8:00 PM` tokenizes to `8:00`, so `20:00` also exempts an answer's `8:00`, the same hour on a 12-hour dial |
| `2h`, `90 min` | nothing — a duration is not a time of day (design Q39) | |

The tool-evidence index is NEVER widened by these forms: a tool's timestamp
`2026-10-09` does not ground an answer's year `2026` — that stays the gate's
question. A corpus with no date or clock time in it is byte-for-byte the one
it always was.

```ts
timeFormsOf({ text: 'what connected 8 Am to 8:40 AM PST' }).said;
// ['8:00', '08:00', '8:00am', '8:40', '08:40', '8:40am']
timeFormsOf({ text: '2026-10-09' }).said; // ['2026', '10', '9']
timeFormsOf({ text: 'took 2h' }).said;    // []

// The answer to a typed ask, as `Agent.resume` lands it:
const answered = {
  role: 'tool', toolCallId: 'c1',
  content: JSON.stringify({
    status: 'input_received', requestId: 'r1',
    values: { date: '2026-10-09' }, origins: { date: 'response' },
  }),
};
exemptFromRun({ history: [answered] }).has('2026'); // true — the year of their date
exemptFromRun({ history: [answered] }).has('2031'); // false — nobody said it
```

Pinned by `test/core/agent/evidence/person-values-normalized.test.ts` (the
field case end to end, an invented `9:15` and year still flagged, redaction,
the fold's lineage, byte identity).

## Evidence lineage at grain — the person's time parts and the library's spellings (time step T7)

**Under `.time()` beside the inputs layer, the gate tells THREE lineages of a
time value apart: the person's (exempt), the library's (`derived-from-reading`
— never invented, never known), and nobody's (flagged). It keeps no time table
of its own: it asks `core/time/forms.ts` · `timeFormsOf`, the one owner of
which spelling of a time is whose (time design § 9.5).**

Why: every reading of chat time words is confirmed by the person (TQ29), so an
answer about "8 AM to 8:40 AM PST" writes spellings the person never typed —
`08:41` (the end of the said minute), `-07:00`, `PDT`, `15:00Z`, the epoch the
call ran with, the served time line's values. Flagging them is a false "not
traced"; exempting them would let the model's echo of LIBRARY text pass as the
person's words. Neither is true, so the record says which.

| the value in the answer | lineage | the gate | the standing |
|---|---|---|---|
| a part the person WROTE, at the grain they wrote it (`8:00` for "8 AM", `08:40`, `2026-10-09` for a confirmed `10/09/26`), or any part of a window they typed in the ask or set in a UI | said | exempt (`exemptFromRun`'s `timeSaid`) | nothing fires |
| an implied year, the abbreviation in effect, an offset, the end-of-grain minute, a UTC or epoch spelling, a look-back's duration, a value the library filled from the window, a value of the served time line, any part of a `model` reading | `derived-from-reading` | not flagged: `EvidenceVerdict.derived`, filed as ONE `time-derived` row per judged answer that stands (`core/time/rows.ts`) | `derived-from-reading` — "not sure", never "known" |
| anything else (`09:15` nobody read, `2031`) | none | flagged, as always | `value-unsupported` |

The order is exempt → the tools' results → derived: a value a tool returned is
grounded whatever the library also spelled. The turn's lineage is read by ONE
reader, `stages/timeLineage.ts` · `timeLineageOf` (the confirmed windows through
`forms.ts` · `turnFormsWindowsOf`, which re-resolves a confirmed `rule`
reading's recorded parses with the recorded clock — never the reader — to name
the parts the person wrote); `answeredValuesOf` stops exempting a value the
library converted from a window the person settled (`isWindowFillRow`). With
no `time-answer` row (no reader, or nothing confirmed) the answered values are
what they always were, and without `.time()` the gate is handed no lineage at
all: its verdict, its events and its rows are byte-for-byte the ones before.

```ts
const { said, derived } = timeFormsOf({
  window: {
    source: 'answered', answer: 'confirmed', zone: 'America/Los_Angeles',
    range: { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' },
    reading: { said: ['year', 'month', 'day', 'hour', 'minute', 'meridiem', 'zone'],
               grain: 'minute', notes: [{ kind: 'end-of-grain' }] },
  },
});
said.includes('08:40');    // true  — the person's "8:40 AM"
derived.includes('08:41'); // true  — the end of that minute is the library's
derived.includes('PDT');   // true  — they said PST
```

Pinned by `test/core/time/forms.test.ts` (the lists, the text rule equal to
the retired table over seeded texts, the reader over a ledger, the row, the
fold) and `test/core/time/lineage-run.test.ts` (the field run end to end; an
invented time and year still flagged; byte identity without `.time()`).

## A glued-unit number is met on the lookup side only (9.110.0)

The extractor judges an answer's `1007us` on its digits (the value `1007`);
the index keeps a text result's `1007us` as `1007us`. They meet because the
CANDIDATE remembers the glued token it came from (`Candidate.token`) and
`extract.ts · candidateForms` looks it up under both spellings — the value's
`lookupForms` plus the token's. The index is never widened to do it: a
result carrying `latency 2024ms` does not ground an answer's prose year
`2024` (that candidate came from a bare token and asks for `2024` alone),
and an answer spelling the reading with the unit apart (`1,007 us`) asks for
`1007` alone. `test/core/agent/evidence-extractor.test.ts` pins both
directions.

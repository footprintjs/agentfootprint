# Take 3 of the demo video — three findings, the first wrong layer of each

**Status: fixed on `fix/take3-findings` (agentfootprint, agentfootprint-lens).** The run: an app on
agentfootprint 9.134.4 + lens 0.72.0, two questions to a PowerScale triage agent under
`.time({ zone: 'America/Los_Angeles' })`, both paused on the time ask and resumed. Each finding
was walked layer by layer — record → derivation / fold → what is served to the model and when →
phrasing → view — and fixed at the first layer that was wrong. No prompt text was added and no
string of the demo is special-cased. Code is cited as `file · symbol`.

## 1. A source's held span, converted by the model

**Seen.** The person asked about "yesterday morning". The answer said the store's samples cover
"October 1, 9:22 AM–5:02 PM Pacific"; the real span is 16:22–17:02 UTC, 9:22–10:02 AM PDT. The
evidence gate then flagged `9:22`, `4:22` and `5:02` ("3 values not traced").

| layer | what it held | right? |
|---|---|---|
| tool | `absent({ period: { queried, held, read_at } })`, every instant `…Z`; `try_instead` names the same instants with `Z` | yes — a zoned instant is unambiguous; zone conversion is not the tool's job |
| record | the `period` row, verdict `not-held` (`results/subflow.ts` · `checkPeriods`) | yes |
| served | the result with `period.verdict: 'not-held'` and the static clause "…the time the store does hold is `period.held`"; the served time line said nothing (`timeLimitFacts.ts` · `carriesCheckLine` passes only `differs` / `shifted` / `beyondRetention`) | **no** — the library knew the person's zone and served only UTC instants, leaving the arithmetic to the model |
| gate | `timeFormsOf` spelled no held span, so a correct `9:22` was "not traced" | no (follows from the above) |

**Fix — served, and the spellings that follow from it.** Under `.time()` a `not-held` /
`partly-held` row carries `held { queried, held }` (`results/subflow.ts` · `heldSpanOf`, the
declared period the verdict came from); the served time line (model audience only) states it in
the person's zone through the one renderer the person's `Period:` line uses (`timeLimits.ts` ·
`heldLine`, `arguments/serve.ts` · `timeLimitsSentence`): "What the sources hold is not all of
the time asked about — pscale_client_health asked about 2026-09-30 06:00:00–11:59:50
America/Los_Angeles (UTC-07:00); its source holds 2026-10-01 09:22:44.300–10:02:44.300
America/Los_Angeles (UTC-07:00), which covers none of that time. So the answer to the person states what each
source holds and claims nothing about the time it does not hold." The derived-spellings owner
lists exactly those spellings (`core/time/forms.ts` · `timeFormsOf`, its `held` source, read by
`stages/timeLineage.ts`), so a model repeating them is filed `time-derived`, and `5:02` is still
flagged. The tool's text is left as written: it says `Z`, and the library stays the one owner of
zone conversion. Both helpers live in modules loaded through `import()` under the arm (the
results layer's `subflow.ts`, `timeLimits.ts`), so a plain agent — and the docs site's demo —
carries only the row's type and its checkpoint test. Test: `test/core/time/held-span-run.test.ts`.

## 2. A resumed answer said its routing was "not in this record"

**Seen.** In plain words, on an answer that continued after the time ask: "The routing happened
before the pause and is not in this record"; Anything wrong listed decided-delivered as
unreachable and named the routing among what "cannot be told here"; TONE: UNKNOWN.

**Is the verdict in the record? Yes.** RouteTurn (`stages/routeTurn.ts`) commits `turnRoute`
(`by`, `from`, `to`, the rule's witness, the offered menu) and the scorer's `entryScores` /
`entryScorer` to the committed state BEFORE the loop. A resumed leg's recording carries the state
the run paused with (`snapshot.initialState`) and the committed state after it, which keeps the
verdict unchanged (RouteTurn does not re-run on resume). Only the `skill.turn_routed` EVENT
belongs to the paused leg, whose events no recording carries (a paused run mints none). The
first wrong layer was the account's fold (`lib/answer-account/facts/understood.ts`), which read
the event alone.

**Decision: read it — one reader — and carry nothing new.** `understood.ts` · `routingVerdictOf`
is the one reader of the verdict: the event when this leg has one, else the verdict the paused
state holds (present in `initialState`, equal in `sharedState`, where the pointers land; "show
me" allow-lists the same leaves `turn_routed` shows). The lines carry the "before the pause —
read from the state this record holds" chip, and check 1 (decided-delivered) runs from this leg's
compositions. The checkpoint is NOT widened: what the account needs of the routing is already
in the state, and a second copy (an event summary written into the paused state) would be a
second owner of facts the event owns. What the state does not carry is said where it matters:
the decider's model (`understood.decider.noModel`), whether the verdict was decisive (absent from
the fact), what was in front of the model before the pause and whether a call then failed or was
refused — `wrong.beforePause.held.events`, which no longer names the routing.
`understood.resumed` / `unreachable.decided` / `wrong.beforePause.held` remain only for a record
whose state holds no verdict either. If those last two facts must become accountable, the
library-correct carrier is the paused leg's own recording (minted at the pause and linked from
the resumed one), not a summary in state — recorded here as the follow-up, not built.

**The tone.** With the routing read, the pause no longer forces "unknown". Two causes remained in
the field run, neither about the pause: the library's own `present` call returned a receipt
whose shape the empty-results check could not read — now left out of that check when the record
shows it presenting (`artifacts.presented`; `signals.ts` · `runChecks`) — and the app's field tool
keeps its rows under `result.rows`, which only the app can declare (`rowsAt: 'rows'`). Test:
`test/lib/answer-account/paused-leg-routing.test.ts` (real paused-and-resumed routed runs: an
intent verdict, the field's menu verdict, the whole take-3 shape whose tone is `ok` with the
app's declaration and `unknown` — said, never guessed — without it). Template set 9.

## 3. "You asked" showed two pairs of quotation marks

**Seen.** `“"what clients …"”`. The stored message has no marks (`turn_start.userPrompt`,
`userMessage`); the account template owns one pair (`asked@1` is `“{{question:quote}}”`, and the
plain `text` projection relies on it). The lens drew the `quote` part as a `<q>` element, which
the browser renders with its own marks — and HTML says quotation marks must not appear around a
`q` at all. First wrong layer: the view. Fix in agentfootprint-lens: a quote part is a
`<span class="lens-plain-quote">` in `<PlainWords>` and `<AnswerReportPrint>`.

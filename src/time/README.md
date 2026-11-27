**Support** — the time layer's one owner of every time grammar: instants, durations, zones and ranges. It decides nothing about what the model may see; the folders that read time ask it instead of keeping their own grammar.

# `time/` — one owner for time

**The law.** Time has one grammar, and it lives here: no other file parses an instant, a
duration or a zone, or splits or joins a range.

The one grammar prevents result, argument and dataset time readers from drifting. The
design is [docs/design/time/](../../docs/design/time/README.md). See [clock dispatch cost](clock-cost.md).

It is a leaf: it imports nothing outside itself, and `readers/` imports only the port (pinned by
`test/time/byte-identity-rows.test.ts` and `english-reader.test.ts`).

| File | Owns |
|---|---|
| `instant.ts` | the one instant parser, `instantOf(value, profile)`, with two named profiles: `lenient` (RFC 3339 as a foreign minter may write it — a period a result declares) and `strict` (upper-case `T`/`Z`, no leap second — a value the library sends to a tool). Plus `compareInstants`, `shiftInstant`, `spellInstant`, `toUtc` |
| `duration.ts` | the one duration grammar `^[1-9][0-9]*[smhdw]$`, no digit cap, with a unit set named per use (`LOOKBACK_UNITS` = `mhdw`, `AXIS_UNITS` = `smhdw`); `durationMs`, `spellDuration` (the smallest exact spelling) |
| `zone.ts` | IANA zone names through `Intl` (an abbreviation such as `PST` and a bare offset are refused, although `Intl` takes them), `offsetAt`, `wallAt`, and wall time → instant under Temporal's four DST words (`readWall`, `wallToInstant`); the tz database's own answer to "which ONE zone does this place name" (`zoneOfPlace`: `London` → `Europe/London`, `India` → none) and the `Etc` zone of a whole-hour offset (`fixedOffsetZone`); one `Intl` reading per (zone, instant), memoised and bounded — the cost is pinned as a count, not a duration, by the performance case of `test/time/resolve.test.ts` |
| `axis.ts` + [`axis/`](axis/README.md) | a dataset's declared time axis (`DatasetTimeAxis`, moved from `artifacts/timeAxis.ts`; `artifacts/index.ts` re-exports it): the one judge `timeAxisIssues` (the interval is a duration under `AXIS_UNITS`, the zone a zone name), `readTimeAxis`, `describeTimeAxis`, and the read-side view `normaliseInstants` — UTC instants at one precision, sorted, with every unplaced value counted (`naive`, `dstAmbiguous`, `dstGap`, `unreadable`, `missing`) |
| `range.ts` | `TimeRange` (half-open `[from, to)`), its two spellings (`parseRange` / `spellRange` — the ISO 8601 interval `from/to` and the joined `from..to`; `splitRange` is the format check), one conversion per boundary a range crosses (`fromInclusive` / `toInclusive`, `boundInto` / `boundFrom`, `lookbackRange` / `lookbackOf`), `reachMs` (first instant to last — the length `maxRange` is held against), `covers`, `overlaps`, `roundOutward` |
| `clock.ts` | the run clock (§ 4): `TimeClock { now, nowSource, zone, zoneSource }`; the two inputs read or refused by name — the run's `time: { now, zone, window }` (`readRunTime`) and the builder's `.time({ zone })` (`readTimeOptions`); `draftClock` (the run's zone wins, the builder's is a fallback, with neither the zone is unknown: `zoneSource: 'unknown'`, spelled in `UNKNOWN_ZONE_SPELLING`), `completeClock` (`now` is the app's, else the turn's start: `nowSource: 'default'`; an unknown zone takes one the person answered earlier: `'answered'`), `clockChange` (what a resume passed that differs from the kept clock) |
| `reader.ts` | the `TimeReader` port (`id`, `version`, `locale`, `kind: 'rule' \| 'model'`, `read`) and its result, `TimeParts` — zone-less parts, never instants; `readerIssue` (the builder's check) and `checkReading` (a quote must be a verbatim substring of the text; parts well formed; a `leftover` only beside parses, each token in the text; `confirm: true` only beside parses — the reader does not vouch the form; a refused mention keeps no text) |
| `resolveRecord.ts` | what the resolver writes down, split out for the synchronous doors: the candidate and choice shapes, `DEFAULT_TIME_POLICY` and `readPolicy` (read at `.time()`, with the optional `abbreviations` map), `widenedGrain` (the one answer to "was this window's END widened?") and `shownGrain` (the grain a confirmation label shows the end at), and the checkpoint door's checks for a recorded candidate and choice (`candidateIsWellFormed`, `choiceIsWellFormed`) — `resolve.ts` re-exports them |
| `resolve.ts` + `resolve/` | small calendar/zone/lookback units; complete interval boundaries govern agreement; parts + clock + policy → every candidate window (`resolveMention`: date orders, am/pm, the year, both instants of a DST overlap or gap, a day word, a look-back, a range read to the end of its grain except an o'clock end, a bare first side taking the second's meridiem, two bare sides sharing one, a said IANA zone or offset, a place named with `time` the tz database names once, an abbreviation only through the app's map and then read both as its zone and as its letters — any other zone token is asked), and `chooseReading` (`only` · `policy` · `open` with its questions · `none`); the v1 `TimePolicy` (`dateOrder`, `year`, both `'ask'` by default; `abbreviations`, absent by default — no map ships); the checks for a recorded candidate and choice |
| `readers/english.ts` | the library's careful English reader, `englishTimeReader()` (§ 5.3, step T6b): a `kind: 'rule'` TOKENIZER over the v1 phrases — ISO dates and instants, numeric dates (`10/09/26`, the order undecided), dates with a named month (`11 September`, `Sept 29` — the year the policy's when not written), clock times (a bare hour only as a range's first side), a range of two (a day word may come first: `today between 1 pm and 2 pm`), a zone written after them or after a day word (IANA, `UTC-07:00`, a place named with `time` such as `London time`, a closed list of abbreviations — as written), an ISO time marked a 24-hour clock (`clock: '24h'`), today / yesterday / tomorrow, "last 40 minutes" and the compact `last 24h` — and ONE `unreadable` mention, quoting the whole phrase, for every other time phrase it recognises (parts of a day, night words, calendar spans, week days and a month named alone, "ago", spans in words, a look-ahead, a compact unit it does not read, an ordinal day, and any v1 phrase a modifier such as "since" or "around" changes, and a bare first side the grammar does not read, `8 to 9:30`). It only PROPOSES: nothing it reads is ever filed as the person's words (the owner's decision "Always confirm", TQ29 — the law is the library's, `rowsBuild.ts` · `timeReadingRows`); every reading is offered through the time ask pre-filled with its window and zone, and only the person's answer settles it ([`readers/README.md`](readers/README.md)). Its word tables live in the sealed `readers/english/` units; it imports only the port |
| `periodForm.ts` | a tool's period forms AS DECLARED, split out for the synchronous doors (`defineTool({ period })`, the time answer's check, the checkpoint door's refusal codes): the shapes, the sugar, each form's own rules, a declared value's spelling, `periodFactProblem` and `TIME_REFUSALS`, and the one owner of a form's own `maxRange` (`formMaxRange`; `formFacts` — the facts a window sent in one form is judged against; `toolFacts` — the facts before a form is chosen, `maxRange` the widest any form reads) — `convert.ts` re-exports every public name |
| `convert.ts` + [`convert/`](convert/README.md) | a tool's period FORMS (§ 7.1: `bounds` · `joined` · `object` · `day` · `lookback`, each bound `iso` · `epoch-ms` · `epoch-s` · `date` · `wall`) and the facts about its source (`PeriodFacts`); the sugar (`sugarForms` — today's `{ argument, spelling }`, `accepts`, `wall-range` + `zoneArgument`); one form's own rules (`formIssue`, `formArguments`, `parsesUnderForm`); the EXACT rows of § 7.2 (`convertExact`) and the inverse a binding reads (`readBack`, `sameRange`); the INEXACT rows (`convertWidened` — a range inside one day → that `day`, a range ending before now → the covering look-back; each with the range it reads and what it adds); `convertForTool` — the ONE answer to "can this tool read this window, and how" (a fact it breaks, else exact, else wider, else `multi-day`, else `no-form-holds`) that the fill, the time ask and the served line all ask; and the refusal tests (`spansDaysForDayOnly`, `wallGapArgument`); a range against the facts (`periodFactProblem`, `partlyBeyondRetention`, `TimeRefusal`) |
| `bind.ts` | which window a call carries (§ 5.6, § 7.3): the turn's windows read from the record (`turnWindowsOf` — a mention the person settled in the time ask, `answered`; a `model` reader's reading waiting for confirmation; the clock's `control` window — a `rule` reading the person has not answered settles nothing) and one call's decision (`callWindowOf`: `filled` — exactly, or widened · `bound` by quote or value · `model-chosen` · `model` · `unread` · `not-filled` · `refused` before dispatch on a fact, a multi-day range to a `day`-only tool, a window no form can read (`no-form-holds`), or a skipped wall time) |
| `windows.ts` | the turn's windows read from the record (`turnWindowsOf`, `pendingQuotesOf`, `readerWindowsOf` and their shapes); the one owner of "a time the person wrote that still waits on them" (`isOpenForPerson`: a reading to confirm, a zone to name, or words not read); the one input every door converts a window from (`windowToConvert`, with `offeredLookback`) — the record half of `bind.ts`, split out BY FILE because the Tools mount's synchronous `inputMapper` and the evidence gate's lineage read it; imports only the leaves and `rows.ts`; `bind.ts` re-exports every name |
| `drift.ts` | the clock at dispatch (§ 7.4): `driftAtDispatch` — a call that sent a look-back, dispatched more than the tool's step after the turn's `now`, is `redrawn` (the library's own fill, re-sent as the asked range in the tool's first absolute form) or `shifted` (the model's look-back, or no absolute form whose `maxRange` holds the range — runs as sent; beside a confirmed window the model's look-back is redrawn too); `coverAtDispatch` — a confirmed look-back in a length-only form is `covered`: lengthened to still reach the window's start from the dispatch moment, or not run |
| `wire.ts` | the JSON that crosses a transport (§ 7.5): `TimeContext` — `ctx.time` in process, the `tools/call` request's `_meta.agentfootprint.time` over MCP — versioned (`timeContextOf`, `readTimeContext`) |
| `check.ts` | the result checks (§ 9.2, § 9.4, § 9.6, step T8): `periodTimeCheck` — what one call READ (the result's declared `queried`, read back with the tool's step; else a widened fill's `sent`; else a look-back shifted by its drift; else the asked range) against what it ASKED (for a window the model chose, the person's window): `differs { missing, extra }`, `shifted`, `beyondRetention`, `partlyBeyondRetention`; a closed end read as open (1 ms) is no difference, and a look-back read moved LATER within the tool's step (§ 7.4's first row only — never earlier, never a bounds window, never with a recorded drift) is the asked range; `rangeDifference`; `clocksDiffer` over the wall-clock sources (a declared axis zone — never a period's offset) |
| `checkRecord.ts` | the record half of the result checks: the row's shapes (`PeriodDiffers`, `ReadSource`, `SourceClock`, `ClocksDiffer`), the checkpoint door's tests (`isPeriodDiffers`, `isShifted`) and the two clock reads (`distinctSources`, `clocksDiffer`) — split out BY FILE because `coverage/period.ts` · `periodRowIsWellFormed` is on every agent's graph; `check.ts` re-exports every name |
| `rows.ts` | the layer's nine ledger rows and the checkpoint door's test for each (`timeRowIsWellFormed`): `clock` (one per turn, filed by seed), `clock-on-resume` (a resume's differing `time`, recorded not applied), `call` (one per dispatched call, `dispatchedAt`, and `drift` when a look-back drifted), `time-reading` (one per mention the armed reader found, or one `mentions: 0` row; `rowsBuild.ts` · `rowsBuild.ts` · `timeReadingRows` builds them, `readingsOf` reads a turn's back), `call-window` (one per call to a tool whose period declares forms, filed by the inputs layer — `rowsBuild.ts` · `callWindowRow`, read back by `callWindowOfCall`), `time-answer` (one per mention the person settled in the time ask — the window, its zone, `how: 'confirmed' | 'edited'`; filed by the batch ask — `timeAnswerRow`, read back by `answersOf`), `time-derived` (one per judged answer that stands, filed by the Route decider when the evidence gate found values the library itself spelled from a reading — `timeDerivedRow`, step T7), `source-clock` (one per call and zone, filed by ToolCalls when a call mints a dataset whose declared axis names a zone — `sourceClockRow`, read back by `sourceClocksOf`, step T8); `clockOf` reads the latest turn's clock, `callRowOfCall` one call's `call` row |
| `reply.ts`, `replyForm.ts`, `replyRecord.ts` | one pure correction facade; the saved range/text association reader (`timeReplyPairs`, public on `agentfootprint/time` for a host); bounded decision/rule evidence in the existing time ledger, with no raw correction mirror |
| `rowsBuild.ts` | the BUILDERS of the first five rows (`clockRow`, `callRow`, `clockOnResumeRow`, `timeReadingRows`, `callWindowRow`) — split from `rows.ts` because `timeReadingRows` runs the resolver; never re-exported by `rows.ts` (the three later rows' builders are plain object literals and stay in `rows.ts`) |
| `forms.ts` | every spelling of a time the answer may write, split by WHO produced it (§ 9.5, step T7): `timeFormsOf({ text })` — the spellings of a date or clock time the person or the app wrote (`8 Am` → `8:00` `08:00` `8:00am`; `2026-10-09` → `2026` `10` `9`; never a slash date or a duration), all `said`; `timeFormsOf({ window })` — a recorded window's `said` parts at the grain they were written (a confirmed `rule` reading's written parts, re-resolved from the recorded parses and clock, never the reader; every part of a window typed in the ask or set in a UI) and its `derived` spellings (an implied year, the abbreviation in effect, offsets, UTC and epoch, the end-of-grain minute of a historical recording, a look-back's duration, and the window's length (`20-minute` for a new exact range from 6:25 to 6:45), whole-token spellings only; every part of a `model` reading, and of a PROPOSAL the time ask offers that the person has not answered); `timeFormsOf({ clock })` — the turn's clock at the minute it is served (G16), in the person's zone (UTC under an unknown zone), all `derived` — never another minute or its seconds; `timeFormsOf({ held })` — a source's held span as the served time line names it (take 3: a `period` row's `held`), each declared end's wall spellings in the person's zone (`9:22`, `09:22`, `9:22am`, `09:22:44`) and in UTC, the zone, its abbreviation and offset, all `derived`; `turnFormsWindowsOf` reads the latest turn's windows off the ledger. The evidence gate asks it and keeps no time table of its own |
| `textForms.ts` | the text rule of `forms.ts` (`timeFormsOfText` — the `said` spellings of the dates and clock times written in text) and the spelling parts both halves share — split out BY FILE because the evidence gate's exempt corpus runs on every gated agent; `forms.ts` (the window half, which re-resolves a reading) loads only under `.time()`, through `agent/stages/timeLineage.ts` |
| `present.ts` | time for a PERSON: `presentInstant`, `presentSpan` (two inclusive ends, as declared), `presentRange` (a half-open range with the end AS SAID — `[08:00, 08:41)` at minute grain shows `08:40`); locale-neutral with no locale, the zone always named, each end's offset when a span crosses a DST change; with a `locale` (the reader's) through `Intl` in that language, the zone's short name |
| `ask.ts` | the one time ask (§ 6): `TimeFormat` (`instant` · `time-range` · `zone`), `checkTimeAnswer` — the ONE judge of a time field's answer (strict instants with an offset, `from` before `to`, an IANA zone, under a known zone no wall time the clocks skip, and — handed a tool's facts and the clock — inside its `direction`, `retention` and `maxRange`) — refusals as codes with facts; the catalog's keys (`TIME_ASK_MESSAGE_KEYS`), `readTimeAskMessages` (the app's overrides), `refusalReason` (the re-ask's reason) |
| [`provenForms/`](provenForms/README.md) | the checked offline receipt and the finite, opt-in allowlist for a fresh native look-back |
| `readingAsk.ts` | `timeAskOf` — the field an `open` reading needs (the candidates as labelled choices, a zone asked as `format: 'zone'`, every reading offered to confirm with its zone named); split from `ask.ts` because its labels render through `present.ts` |

`tools/inputRequest.ts` asks `ask.ts`: a field's `format` is judged at definition (each choice, each
supplied value) and at the resume door (`applyInputResponse`, the person's answer — a refused one
comes back as the same ask with `refused` and `repeat`); `Agent.resume` hands it the paused turn's
clock zone and the app's `.time({ messages })`. The sentences live in `src/locales/timeAsk.ts`
(`defaultTimeAskMessages`), and `mcp/elicitation.ts` carries the ask over MCP.
Who asks it today: `coverage/period.ts` reads a declared period's instants through
`instant.ts` · `instantOf` in the lenient profile (`periodVerdict` is unchanged, inclusive at both
ends) and, under `.time()`, renders `periodLine` through `present.ts` in the run's zone — and,
since step T8, each result check's line (`periodCheckLine`) and the wall-clock sources
(`clockLines`), composed per turn by `coverage/timeLimits.ts` · `timeLimitLinesOf` for the limits
block AND for the model's served time line (`arguments/serve/clock.ts` · `timeLimitsSentence`, late, at
the decision point — a SHIFTED read reaches the model as the library's conclusion, `period.ts` ·
`shiftedConclusion`: "search_logs's look-back ran after the clock moved on, so its result does not
cover <the missed part, in the person's zone> of the person's window (…) … So the answer says that
search_logs's result does not cover <it>, and claims nothing about that time from it", while the
person's block keeps its two ranges) and a source that holds none or only part of the asked time
reaches it as what the call asked about and what the source holds, both in the person's zone
(`timeLimits.ts` · `heldLine`, off the `period` row's `held`; the person's `Period:` line already
prints both); the results layer (`results/subflow.ts` · `checkPeriods`, handed each call's
`call-window` and `call` rows by `honesty/resultsInput.ts` · `timeOfBatch`) asks `check.ts` ·
`periodTimeCheck` and files the answer on the call's `period` row, which the answer's standing folds
(`period-differs-from-asked`, `period-beyond-retention`); `stages/toolCalls/evidence/sourceClock.ts` files a
`source-clock` row when a dataset it mints declares an axis zone;
`Agent.run` / `Agent.resume` read the run's `time` through `clock.ts` (refusing a run with no zone
before the turn starts); `stages/timeLayer.ts` · `stampClock` files the turn's `clock` row;
`stages/timeLayer.ts` files each `call` row and, first thing in a resumed leg (either pause
shape: the `resume` door, or `execute` re-run after the argument ask's `interrupt()`),
`clock-on-resume`;
`stages/timeLayer.ts` · `readTimeWords` reads the person's message through the armed reader, right
after the clock, and files the `time-reading` rows.
`core/checkpointLedger.ts` · `ledgerRowIsWellFormed` routes time rows to `rows.ts`.
`tools/declare.ts` · `parsesUnderSpelling` reads a look-back through `duration.ts` and
an `iso-range` through `range.ts` · `splitRange` in the strict profile; `artifacts/minting.ts` ·
`prepareArtifact` and `artifacts/datasetResult.ts` · `stageDatasetArtifacts` judge a dataset's
axis through `axis.ts` · `timeAxisIssues`. From the package: `axis.ts` (through
`artifacts/index.ts`, where datasets live), and — since the run clock (step T3) — the clock's types
(`RunTime`, `TimeClock`, `TimeOptions`, `TimeRange`, and the three row types) from the main barrel;
since the reader (step T6a) also the port's types (`TimeReader`, `TimeParts`, `TimeReading`, …),
the resolver's (`TimeCandidate`, `ResolvedWindow`, `ReadingChoice`, `TimePolicy`, …) and
`TimeReadingRow`; since packet "gaps" the `TimeAnswerRow`, `TimeDerivedRow` and `SourceClockRow` types; since the ask (step T4) its types (`TimeFormat`, `TimeAnswerProblem`,
`TimeAskMessageKey`, `TimeAskMessages`) and the catalog `defaultTimeAskMessages` (also from
`agentfootprint/observe`, beside the other catalogs); since the English reader (step T6b)
`englishTimeReader` and `EnglishTimeReaderOptions`; the doors are `AgentBuilder.time`,
`run({ time })` and `InputField.format`. The grammar functions stay internal. One exception, by
the same law that keeps the run-time half off the default graph: the conversion an app needs
OUTSIDE a run ships through its own door, `agentfootprint/time` (`src/doors/time.ts`), never the
main barrel — on the main barrel it would put `convert.ts` on every consumer's synchronous graph.
The door leads with THE answer, `convertForTool` (with `ToolConversion` and `TimeRefusal`), and
the tool's declaration read the run's way: `sugarForms` (a `period`'s forms, `PeriodShapes`),
`granularityMsOf` (the clock's `granularityMs`) and `widestMsOf` (its `maxRange` in ms); time for a
person as the run writes it (`presentRange`) and the run's zone check (`isZoneName`); then the
steps alone — `convertExact`, `convertWidened` (asked only after `convertExact` finds nothing),
`periodFactProblem` — with `ConvertContext`, `WindowToConvert`, `Conversion`, `WidenedConversion`
and `PeriodFactProblem`. **The one-answer law: an app that previews what a tool would read, or
builds a call itself, asks `convertForTool` over the tool's own `period` — never a copy of the
conversion, nor of its order, nor of the duration grammar.** The steps alone do not see the
tool's facts: composed by hand they miss `maxRange` (a 1960m look-back the run refuses
`no-form-holds`), `multi-day` and `partlyBeyondRetention`. A copy drifts the first time the fill's
rules change, and the preview then shows a read the run will not send; the door is the same
function objects the run calls (pinned by identity in
`test/api-conformance/subpath-exports.test.ts`, and by value against a run — the read AND the
refusal — in `examples/features/85-time-widen-and-refuse.ts`).
Since step T6b the windows the person CONFIRMED (and a `model` reader's readings) are also
SERVED, with their source, and a mention still pending is served as NOT confirmed: the Tools mount
reads them off the ledger (`windows.ts` · `readerWindowsOf`, `pendingQuotesOf`), the slot's one
decoration site composes ONE late line (`arguments/serve/windows.ts` · `timeWindowsLine`) and `callLLM`
appends it last to the request, request-only — the conclusion at the decision point, never a
tool description; and a mention still open is ASKED through the batch
ask (`arguments/ask/fields.ts` · `planAskFields`'s window field, `stages/argumentAsk.ts` · `windowPlanOf`),
re-read after a zone answer with `resolve.ts` · `withZoneAnswered`.
Since step T7 the evidence gate asks `forms.ts` · `timeFormsOf` which spelling of a time is whose:
`evidence/evidenceIndex.ts` · `addExempt` takes its `said` list for every exempt text (the table
private to the gate, its `dateAndClockForms` in `normalize.ts`, is retired — its cases pass unchanged),
and under `.time()` `stages/timeLineage.ts` · `timeLineageOf` hands the gate the turn's windows' `said`
spellings (exempt) and `derived` ones (with the values the library filled from a window and the
served time line) — a value found only there files a `time-derived` row and folds
`derived-from-reading`, "not sure", never "known".

```ts
timeFormsOf({ text: 'what connected 8 Am to 8:40 AM PST' }).said;
// ['8:00', '08:00', '8:00am', '8:40', '08:40', '8:40am']
const { said, derived } = timeFormsOf({ window: confirmedFieldWindow });
said.includes('08:40') && !derived.includes('08:41') && derived.includes('PDT'); // true
```

**The clock law: a declared, recorded input, never a hidden read.** `.time()` arms it. The zone is
per run (`run({ time: { zone } })`), the builder's `.time({ zone })` a fallback, and with neither
the zone is UNKNOWN — never the server's zone, never a guess (G15; the unknown-zone law below).
`now` is the app's, else the turn's start, recorded
`nowSource: 'default'`. Seed files one `clock` row per turn, after the turn number is final; it is
never written again that turn. A resume that passes a different `time` keeps the frozen clock and
files `clock-on-resume { passed, kept }`. A turn `run()` did not start (the agent's chart mounted
in a composition, which passes no `time`) stamps the builder's fallback as a default, or an unknown
zone without one — the draft a `run()` read ends with that `run()`. The layer reads the wall clock at exactly two points, both
recorded: a default `now`, and each call's `dispatchedAt`. A zone is recorded as the app wrote it —
`Intl`'s canonical form can be an older link (`Asia/Kolkata` → `Asia/Calcutta`). The rows fire no
event (the record is the reader's).

**The unknown-zone law (G15): a zone nobody named is asked, never guessed.** An app deployed
without its zone setting can still arm `.time()`: with no run zone and no fallback the `clock` row
records `zoneSource: 'unknown'` and spells instants in UTC (`clock.ts` · `UNKNOWN_ZONE_SPELLING`).
Before, such a run was refused, so the app could not arm the layer at all and "Always confirm"
silently became "never confirm" — tools ran on their defaults. Now every reading of the person's
words that names no zone of its own waits on their zone (`resolve.ts` · `builtOf` → `needsZone`, a
look-back too): the time ask asks it FIRST ("Which time zone should I use for “yesterday”?", key
`ask.zone-unknown`; "use", as calendar words move the query), the words are then read in the zone they
answer (`arguments/ask/windowBinding/answer.ts` · `bindWindowAnswer`), and that zone holds for the turns after it — seed
stamps it with `zoneSource: 'answered'` (`rows.ts` · `answeredZoneOf`: a `time-answer` filed under
an unknown clock for a mention that named no zone). The turn the answer was given in keeps its
frozen clock. Wherever a time is shown while the zone is unknown it is in UTC and says why: the
run clock and the control window in the served line ("… UTC (the person's time zone is not
known)"), the limits lines (`coverage/timeLimits.ts` · `UNKNOWN_ZONE_LINE`), and the tool's
`ctx.time` (`wire.ts` · `TimeContext`, `zoneUnknown` — the zone is a spelling, never the person's).
No wall time is judged under it (`Agent` · `timeAnswerContextOf`). An app that passes a zone is
byte-identical.

```ts
const agent = Agent.create({ provider, model }).tools([clientActivity]).time({ reader: englishTimeReader() }).build();
await agent.run({ message: 'any client activity yesterday?' });
// paused: one field, format 'zone' — 'Which time zone should I use for “yesterday”?'
// resume { f1: 'America/Los_Angeles' } → paused: yesterday offered as 2026-10-08 in Los Angeles → confirm → runs
await agent.followUp('and the day before?'); // clock row: zone America/Los_Angeles, zoneSource 'answered'
```

**The clock-line law (G16): the model reads the date from the library.** Under `.time()` the turn's
clock is the FIRST sentence of the one served time line, on every request
(`arguments/serve/clock.ts` · `clockSentence`): "This turn's time: Friday 2026-10-09 08:40
America/Los_Angeles (UTC-07:00)." — the frozen clock to the minute, the weekday in the person's
zone (a model re-derives a weekday wrong), the zone named. Not "now": the clock is the turn's and
a resumed request is read later (the deictic-present rule of the model-facing checker). Apps used
to serve their own "application clock" block; with the layer armed the model had no date on any
turn. Cost, measured (chars ÷ 4, `test/time/clock-served.test.ts`): the sentence 19 tokens;
a request whose line says nothing else gains 73 (the opening that says who speaks is most of it).
Never without `.time()`; `reactMode: 'classic'` serves the line on its first request only (its
cached tools slot does not re-compose — the known limit).

**The reading law: a strategy tokenizes, the library resolves, the policy or the person
chooses.** The library reads a person's words only through a reader the app armed
(`.time({ reader })`, no default), and only the message a person wrote (`lib/saidByPerson.ts` ·
`isSaidByPerson`; a composed run's message is another runner's output and is never read). The
reader returns PARTS — `10/09/26` is three numbers, the order undecided — and a verbatim quote,
which is checked. `resolve.ts` writes every candidate the parts allow, each tagged with how it
read them; the policy (`dateOrder`, `year`) only removes readings, and a removal is recorded
(`choice.by: 'policy'`); a DST overlap or gap, a missing meridiem and a zone abbreviation are never
settled by the library (`open`). A zone the person named is never dropped and never replaced by
the app's: a place named with `time` becomes the tz database's ONE zone for it, an abbreviation
becomes a zone only through the app's `policy.abbreviations` — offered as its zone AND as its
letters' offset when the two disagree (`open: ['abbreviation', 'confirm']`) — and anything else is
asked; each such reading is noted `zone-read` with the words as written. The reader runs ONCE per message: seed files the rows, and a
resume or a `resumeOnError` retry of the same turn finds them and does not call it again — a
message with no mention files one `mentions: 0` row for exactly that reason. **No reading is ever
the person's words** (the owner's decision "Always confirm", TQ29): whatever the reader's kind,
its candidates are never `said`, and even a single window stays `open` with `confirm` until the
person answers in the time ask — the answer files a `time-answer` row (`confirmed` when they
picked the offered reading, `edited` when they wrote their own), the ONE door by which a window of
words becomes theirs. Each row records the reader's id, version, kind and locale and the tz
database version (`zone.ts` · `tzdataVersion`), because either can change between releases.

**The ask law: the library checks a time answer before the app sees it, and says why in words
the app can replace.** A `requestInput` field with a `format` is a time field; its answer is judged by
`checkTimeAnswer` at the resume door — the same judge that refused a malformed choice at definition.
A refused answer is not taken: the ask comes back with `refused: { answer, reason }` and
`repeat: { count }`, the field `missing` again, and nothing runs (no model call, no row: the run never
restarted). The reason is a catalog sentence, and only a check the app armed can produce one (a
`format`, or the DST check under `.time()`, which knows the person's zone). A reading's choices are
offered as labelled `enum` values in the reader's locale, free entry open unless `strict`; every
reading is offered as the library's reading to confirm, with its zone, never as the person's words.

**The period law: the library writes the person's window into a tool's own arguments only
exactly, and never over the model's.** A tool DECLARES every shape its period takes (`forms`, today's
`{ argument, spelling }` its shorthand) and facts about its source — never policy. Under `.time()`
the inputs layer (`arguments/resolve.ts` · `timeDecisionsOf`) asks `bind.ts` once per call: the
model left every period argument out and the turn holds exactly ONE window of the person's (a
mention they settled in the time ask, or the UI's `time.window` — two mentions fill nothing) → the window goes into the
first form that holds it exactly (`convertExact`: an epoch-seconds bound or a look-back's length
rounds OUTWARD, recorded `rounded`; a form that would widen, shift or drop part of it is never
chosen) and the arguments are filed as the person's (`answered` + `matched: 'mention'`; a `model`
reader's window as a reading, `said` + `reading: true`; a UI window as `app`, `appSource:
'time.window'`). A window the model sent runs as sent: bound to the person's window by the quote it
declared (then filed `answered` + `matched: 'mention'`) or by value, else recorded `model-chosen` beside the person's
— a drill-down and a comparison are normal work, and the standing reads "not sure". One
`call-window` row per call says which; `ctx.time` (`wire.ts`) hands the tool the range the call asks
for, read off that row, with the zone, the frozen `now` and the dispatch moment.

**The widening law: when no form holds the window exactly, read MORE and say so — never less,
never silently.** The fill takes the first exact form, else the first form that holds more
(`convertWidened`): a `day` for a range inside one day, the covering look-back from now for a
range that ended before now (never wider than the tool's `maxRange`). The `call-window` row
carries `sent` (what the tool reads) and `differs.extra` (what it adds) — or `trimmedByTool` when
the tool declares `filtersToAsked` — and the note tells the model the value reads a wider one.
Whether to widen is not the tool's to say; a tool declares only facts. **The refusal law: a call
the tool cannot honestly read is refused before it runs, with the reason.** A window outside the
tool's `direction`, wholly older than its `retention`, wider than its `maxRange`, spanning days
for a `day`-only tool, or a sent wall time the zone skips — filled or sent — files `how:
'refused'` and the model reads a past-tense sentence naming the declared fact
(`arguments/serve/refusals.ts` · `timeRefusal`); splitting a window into several calls is the model's
choice. A window only PARTLY older than `retention` runs, marked `partlyBeyondRetention`.
**A window of the person's that no form can read — not even wider — is refused, never left to
the tool's rule** (`no-form-holds`): a look-back ends at now, so a window still running is out of
its reach, and a covering look-back longer than `maxRange` is one the tool will not read.
**A form may declare its own `maxRange`** — the widest window THAT form reads (a tool caps its
bounds at `24h` while its look-back reads any length): it overrides the period's for that form
only (`periodForm.ts` · `formMaxRange`, the one owner). Before a form is chosen the tool is held to
the widest any form reads, none when one form has no cap (`toolFacts`); a window SENT in one form
is held to that form's (`formFacts`).

```ts
period: { forms: [{ kind: 'bounds', from, to, maxRange: '24h' }, { kind: 'lookback', argument: 'window', signed: false }] }
convertForTool({ range: last48h, lookback: '48h' }, forms, {}, ctx); // { conversion: { form: 1, values: { window: '2d' } } }
```

**`maxRange` is an inclusive ceiling on a window's REACH** — first instant to last (`range.ts` ·
`reachMs`, the one owner; `periodFactProblem` and `convertWidened` both ask it): the look-back
`[now − L, now]` reaches `L` (its half-open end `now + 1 ms` keeps now inside, it adds no reach),
the same instants spelled as bounds reach the same, so `24h` fits `maxRange: '24h'` and `1441m`
does not. The
tool's `assume: '1h'` would silently read a time nobody asked about. Every door asks the one owner,
`convert.ts` · `convertForTool`. The served line (under the reader) turns each refusal of a
person's window into the conclusion an answer states (`search_logs was not run for “yesterday”:
… So the answer tells the person that search_logs could not read that time, …`) and stops naming
that call as the next step — the T6b bench's future case asked the same refused call five times.
**The drift law: only the library's own fill is redrawn.** At dispatch
(`stages/timeLayer.ts` · `timeAtDispatch`) a look-back sent more than the tool's step (one
minute) after the turn's `now` — after a pause, or an app `now` far from the wall clock — is
re-sent as the asked range in the tool's first absolute form when the library wrote it; the
model's look-back, or one with no absolute form, runs as sent. The `call` row records
`drift: { byMs, outcome }`.

**The edge law: `resolve.ts` owns where a window ends.** A timestamp range ends at its
confirmed upper instant. “8:00 to 8:40” uses `[08:00, 08:40)`. A control window can pass
`end: 'inclusive'` to include the endpoint itself and `precision: 'minute'` when its ISO
input pads the confirmed minute with seconds. The clock or time-answer row stores the cutoff,
policy and precision together. Standalone times and whole calendar periods still use their grain.
Written into a tool's INCLUSIVE ISO end, a cutoff is the last instant inside on its grid — one
second before a whole-second cutoff, one millisecond before a millisecond one — and is read back
on the grid it was written at (never nanoseconds: tool parsers refuse them). An inclusive control
point therefore lands ON a grid second the tool reads whole: that fill is recorded as wider
(`sent`, `differs.extra`), not as exact.
Saved historical rows retain their stored bounds.

**Confirmed look-backs use absolute bounds.** The accepted window keeps the run's recorded
`time.now`. A tool with both duration and absolute forms receives the absolute range
regardless of form order. The existing period evidence distinguishes the requested bounds from a
wider or narrower read.

**A length-only source gets the covering look-back, measured at dispatch.** When no absolute
form holds a confirmed window — a look-back, or a closed past range with a recorded endpoint;
the tool declares only a length, or its absolute form's own `maxRange` is too small — the
widening law applies: read MORE and say so. A length is counted back by the SOURCE from its own clock when it is handed the call,
so the same length sent after a confirmation click would start later and lose the oldest part
of the window. The fill therefore holds the window's own length (`convert/covering.ts` ·
`sourceClockLookback`; the `call-window` row says `coversAtDispatch`, never `frozenLookback`),
and at dispatch the library replaces it with the smallest length in the form's units that still
reaches the window's start from that moment (`drift.ts` · `coverAtDispatch`): a two-hour look-back
handed over 61 seconds late is sent as `122m`. The `call` row records `drift: { outcome:
'covered', form, sent }` on every such call, the result check reads `sent` (a result's declared
`queried` still wins), and the note tells the model the value that ran, that it reads wider, and
that the source's clock decided the exact bounds. Nothing is shortened to fit: a window still
running at dispatch (a look-back ends at now) and a length past the form's `maxRange` do not run,
and the model reads why. The final arguments must still hold the library's own look-back and no
other period argument (`frozenDispatch.ts` · `coveringDispatchMatches`): a value a middleware
wrote is never replaced. Declaring bounds stays the exact answer; this is the honest one for a
source that cannot take them.

**The model's own look-back is the model's own window.** Beside a confirmed look-back, a call
that sends a length naming the SAME window is the library's fill (frozen bounds, or the covering
look-back above). A call whose forms all name one OTHER window — a longer look-back, or that
look-back and matching bounds — is recorded `model-chosen` beside the person's, exactly as a
different absolute range is: a drill-down, a baseline and a comparison are normal work, and the
standing reads "not sure". Beside ANY confirmed window (one with a recorded endpoint: a
look-back, a timestamp range, a UI control) it keeps the INTERVAL it named on the frozen clock:
when the clock moved past the tool's step and an absolute form's `maxRange` holds the interval,
the look-back is re-sent as those bounds (`drift: { outcome: 'redrawn' }` — the spelling
changes, never the window); otherwise it runs as sent and past the step is recorded `shifted`.
The same cap now guards the redraw of the library's own fill. Only a call whose own forms name
different windows does not run (`no-form-holds`): which one the tool would read is unknown. In this repository, the native clock and dispatch checks call
`rulerTool({ period })` from `test/time/fixtures/rulerTool.ts` through ordinary `Agent.run` and
`resume`.

```ts
resolveMention([{ rangeOf: [{ wall: { h: 8, meridiem: 'am' } }, { wall: { h: 9, meridiem: 'am' } }] }], clock, rule)
  .candidates[0].range; // { from: '…T08:00:00-07:00', to: '…T09:00:00-07:00' } — widenedGrain: undefined
resolveMention([{ wall: { h: 8, meridiem: 'am' }, zoneToken: 'PST' }], clock, rule, true, {
  ...DEFAULT_TIME_POLICY, abbreviations: { PST: { zone: 'America/Los_Angeles', offset: '-08:00' } },
}).candidates.map((c) => c.range.from); // ['…T08:00:00-07:00', '…T08:00:00-08:00'] — both offered
```

**The meridiem law: a range's sides share a meridiem unless one is said.** `resolve.ts` owns it
(`builtOfAll` over `forwardPairs`). A bare first side takes the second side's SAID meridiem ("8
to 9 PM" → 8 PM – 9 PM), falling back to the other only when that runs backwards ("11 to 1 PM" →
11 AM). Two sides that say none share one (G13): "September 29 8:45 to 8:55" is offered as 8:45–8:55
AM and 8:45–8:55 PM — never 8:45 AM – 8:55 PM, a twelve-hour window nobody said. The half-day is
crossed only when no shared reading runs forward, because the right side is earlier on the clock
face ("11 to 1", "11:15 to 12:30", "8 to 8"): then both crossings are offered — AM to PM the same
day, and PM to AM overnight, the right side read on the next day when its day is the left side's
(a right side with a date of its own is never moved). The same night holds for every spelling: a
range that runs forward on no one day — "11 PM to 1 AM", "23:00 to 1:00", "11 to 1 AM" — ends on
the next day when that night is at most the half-day it crosses ("11 PM to 1" is 1 AM, never 1 PM
the next day; "11 AM to 1 AM" and "8 AM to 8 AM" name no window). A range that runs forward on its
own day is never read overnight; every reading stays a proposal the person confirms.

```ts
const bare = (h: number, m?: number) => ({ wall: { h, ...(m !== undefined && { m }) } });
resolveMention([{ rangeOf: [bare(8, 45), bare(8, 55)] }], clock, rule).candidates.map((c) => c.range);
// [{ from: '…T08:45:00-07:00', to: '…T08:56:00-07:00' }, { from: '…T20:45:00-07:00', to: '…T20:56:00-07:00' }]
resolveMention([{ rangeOf: [bare(11), bare(1)] }], clock, rule).candidates.map((c) => c.range);
// [{ from: '2026-10-09T11:00:00-07:00', to: '2026-10-09T13:00:00-07:00' },
//  { from: '2026-10-09T23:00:00-07:00', to: '2026-10-10T01:00:00-07:00' }]
```

**The English law: read a small set carefully, and say "unreadable" for the rest — never a
part.** `englishTimeReader()` tokenizes; it never decides an order, maps `PST` or `London time`
to a zone, or refuses a future date. A phrase outside its v1 set is ONE `unreadable` mention quoting the whole phrase:
reading `yesterday` out of `yesterday morning` would silently widen what the person said, and
an unreadable mention still counts as a mention, so it fills nothing beside another — and, alone,
it is ASKED (the lazy-ask law): the person wrote a time, so no default stands in for it.

**The served-window law: the model is told each settled window of the person's words, in each
tool's own form, with its SOURCE (TQ13)** — and the window the person set in the app's time
control (`time.window`, `ReaderWindows.control`): "The window the person set in the app's time
control is … — <each tool's values>", under `.time()` with or without a reader, so an app never
writes its own prompt text for it. The control window is a fact about the person's TURN, not about
a tool (G14): it is served on EVERY request of the turn whether or not a served tool declares a
period, and whether or not the inputs layer is armed — with no tool that can take values, the
window alone ("The window the person set in the app's time control is 2026-10-09 08:00–08:39
America/Los_Angeles (UTC-07:00). An answer built on it states that window."), no values and no
permission to pass any. Never without `.time()`: `run({ time })` is refused there, and a turn with
no control window serves no line (`test/time/gaps-run.test.ts`, "G14"). The values are the ONE answer (`convert.ts` · `convertForTool`
over `windows.ts` · `windowToConvert`) the fill and the time ask's answer also use, so the value
served and the value a call is handed are one spelling. Under `.time({ reader })`, each tool that declares a
period carries ONE sentence after its description naming every window SETTLED this turn in that
tool's form — the exact conversion, else the wider one the fill would use, said so — and whose it
is: "(the window the person confirmed when asked what their words meant)", "(… gave when asked …)",
or, for a `model` reader, "(a reading of the person's words they have not confirmed, not their
words)". A proposal still open or an unreadable mention is not named; a turn with nothing settled
serves the bytes it always did. The known limit: `reactMode: 'classic'` caches its tools after the
first iteration, so a window confirmed mid-turn is not served there (the later call is still filled
from it — the fill reads the record).

**The lazy-ask law: ask about the person's words only when a tool needs them.** A call that
leaves its period out while the turn's ONE mention is still open — every reading is, until the
person answers — is not asked argument by argument, whatever the tool's own rule (a tool whose rule
ASSUMES its period is asked too: its default never stands in for words the person wrote,
`arguments/resolve.ts` · `verifyPlan`): the batch ask carries one window field
for every such call — the zone first when the person wrote an abbreviation (`format: 'zone'`),
then the readings as labelled `time-range` choices (a zone answer re-reads the mention in that zone;
one window binds it). Only readings every member tool can read are offered (its facts, and a form
that holds it — `convertForTool`); when a tool can read NO reading nothing is asked and the call is
refused (`bind.ts` · `callWindowOf`, § 6.3 — the row then carries no range). The chosen window goes
into each call's forms (exactly, else wider), filed `answered` with a `time-answer` row
(`confirmed` — the click on the pre-filled reading — or `edited`) and a second `call-window` row
for each call it filled — `filled`, `person.source: 'answered'`, with `sent` and `differs.extra`
when wider — so `ctx.time`, the clock at dispatch and the result checks read the window the asking
call really carries; the note says the value came from the window the person chose; later calls of
the turn are filled from it and the mention is not asked again. **A start and an end asked
separately are one window:** a pair that fits argument by argument but breaks the tool's
`direction`, `retention` or `maxRange` together is asked again naming the fact, then refused
(`arguments/ask/validation.ts` · `pairsBroken`) — with the reader or without. **Words the library holds
no reading of are asked too** (`windows.ts` · `isOpenForPerson`: a zone still to name, or words the
reader could not read): one window field — the zone first, or "Which time did you mean by …?"
with nothing pre-filled (`format: 'time-range'`) — judged at the door and converted into each
call's form like any answer, whatever the tool's own rule says (time follow-ups, packet "gaps":
`yesterday morning` to a tool that assumed `-30m` ran `-30m`; an ASK-rule tool's own format-less
ask handed a raw `a/b` to a tool that reads `a..b`). The served line leads with the library's conclusion and the one next step: "The library could
not read “yesterday morning”, so the next step is to call smb_records with window left out: that
call opens the library's own form … Do not ask about the time in the reply — the form asks it"
(`arguments/serve/windows.ts` · `unreadSentence`; measured by `bench/time/RULE-unread.md`). A turn with
no reader asks as it always did.

```ts
// 'any SMB on 10.0.0.1 yesterday morning?' — the model leaves `window` out (rule: assume '-30m'):
//   paused: { format: 'time-range', description: 'Which time did you mean by “yesterday morning”?' }
//   resume { f1: '2026-10-08T06:00:00-07:00/2026-10-08T12:00:00-07:00' }
//   → the tool runs { window: '2026-10-08T06:00:00-07:00..2026-10-08T11:59:59-07:00' } — never '-30m'
//   → { kind: 'time-answer', mention: 0, how: 'edited', … }
```

**The presentation law: a label is never data.** `present.ts` renders for a person — the typed
record keeps the instants. With no reader armed (a later step) the form is locale-neutral:
`2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)`.

**The axis law: a value with no known clock is never read as UTC.** `normaliseInstants` is a
read-side view: it reads the rows and never writes them. An ISO value with no offset under an
axis with no `zone` is counted (`status: 'naive-values'`), or the whole view is refused under
`{ naive: 'refuse' }`. Under a declared `zone`, values are wall times; in the hour the clocks go
back, the rows' order places a doubled wall time (the values before the wall clock steps back take
the earlier offset, the rest the later, each noted `{ kind: 'dst-overlap', resolvedBy: 'row-order'
}`), and a value the order cannot place — a lone `01:30`, rows not in time order — is counted
`dstAmbiguous`, like a naive one. A skipped wall time is counted `dstGap`.

## Example

See [worked examples of the time layer](examples.md).

## What a plain agent carries (the default graph)

The optional-family law of docs-next's site budget (`docs-next/scripts/check-site-budget.mjs`): an
agent that never arms `.time()` loads only what a SYNCHRONOUS door needs before any run starts —
`.time()`'s options (`clock.ts`), `defineTool({ period })` (`periodForm.ts`, through
`tools/declare.ts`), a time answer's check at the resume door (`ask.ts`, through
`tools/inputRequest.ts`) and the checkpoint door's row checks (`rows.ts`, `resolveRecord.ts`, with
the leaves `instant.ts`, `zone.ts`, `range.ts`, `duration.ts`, `reader.ts`). Everything the RUN does
under `.time()` loads through `import()` where the path is already async: seed and ToolCalls load
`agent/stages/timeLayer.ts` (the clock stamp, the reading of the person's words, the dispatch
moment, `clock-on-resume`), which brings `resolve.ts`, `convert.ts`, `drift.ts`, `wire.ts` and
`rowsBuild.ts`; prepareFinal's in-zone limits line loads `present.ts` and hands `coverage/period.ts`
a bound renderer (`bindPresentation`) — coverage never imports the renderer. A bundler places a
module on the synchronous graph when ANY synchronous module imports it, whatever the importer uses,
so the rule is by FILE: a synchronous door imports the split-out record half (`resolveRecord.ts`,
`periodForm.ts`, `rows.ts`, `checkRecord.ts`, `windows.ts`, `textForms.ts`), never the module that
re-exports it, and `rows.ts` does not re-export its builders. The later steps keep it the same way:
the Tools mount's `inputMapper` hands the served line the turn's windows (`windows.ts` ·
`readerWindowsOf`) and the limits as unrendered FACTS (`agent/coverage/timeLimitFacts.ts`), which
the slot renders under the arm (`agent/arguments/serve/clock.ts` · `timeLimitsLine`); prepareFinal loads
the limits composer (`agent/coverage/timeLimits.ts`) and Route the lineage reader
(`agent/stages/timeLineage.ts`, which brings `forms.ts`, `bind.ts` and the resolver) through
`import()`. Pinned by `test/trace-toolpack/browserGraph.test.ts` (the time layer's law).

```ts
// agent/stages/seed.ts · fileTime — a plain seed returns before the import and stays synchronous
if (deps.timeClock === undefined && deps.timeReader === undefined) return;
return import('./timeLayer.js').then((time) => {
  time.stampClock(scope, deps);
  return time.readTimeWords(scope, deps);
});
```

## What changed when the grammars moved here (the design's § 12.1)

| # | Behaviour | Now |
|---|---|---|
| a | an `iso-range` value naming a day past its month's end (`2026-02-30T08:00Z..…`) | **refused** — `Date.parse` used to roll it forward; a tool was sent an instant nobody asked for |
| b | an `iso-range` value at hour `24` | **refused**, the same reason |
| c | lower-case `t`/`z` or the leap second `:60` in an argument | still refused (the strict profile); still accepted in a declared period (the lenient profile) |
| d | a look-back with many digits (`1000000m`) | still accepted — no digit cap |
| e | a look-back in seconds (`30s`) | still refused unless the use names `s` in its unit set |
| d (axis, T2) | a dataset `interval` with more than six digits (`1000000m`) | **accepted** — the axis's shipped cap went with the merge |
| T2 | a dataset `zone` that `Intl` takes but is not an IANA name (`PST`, `EST`, `+05:30`, `utc`, `EST5EDT`) | **refused at mint**; a ticket minted earlier with one reads `malformed` |

## Partial tool bounds and pending person words

The core ask owner distinguishes ordinary endpoint completion from confirmation
of a person's time words. `core/agent/arguments/partialWindow.ts` classifies an
original partially specified bounds form using the existing declaration and
read-back owners. A readable complete alternative is not partial; ambiguous
partial forms refuse. `stages/toolCalls/batch/execute.ts` enters the shared ask owner even
when a default or kept answer leaves no ordinary question outstanding.

`stages/argumentAsk.ts` carries the original call and declaration in detached
batch-owned state. It completes ordinary fields, then uses an explicit native
`confirm-meaning` window role. That answer records one real `time-answer` without
filling the selected call's endpoints. All-missing members keep the existing
fill/conversion route. The canonical binder then compares actual materialized
arguments with the settled person window and appends the effective `call-window`
before execution. Complete model-selected scopes are retained. A zone answer
alone does not settle the words; invalid or mismatched native state cannot
dispatch the waiting partial call.

The native pause contract is deliberately breaking: save the exact writer
runtime/artifact and agent configuration and resume that pause on the same
configuration. Old ordinary partial pauses can be re-gated by the new reader;
new confirmation-only pauses are unsafe on the old reader, which may overwrite
the selected endpoints. There is no invented wire-version rejection. Host pause
routing and admission must prevent incompatible downgrade before adoption.

## Not covered yet

- A confirmed look-back, or a confirmed timestamp range that ended before the clock's `now`, on
  a tool with no absolute form is re-spelled from the dispatch clock (`coversAtDispatch`, above).
  A window written as a RANGE that ends exactly at `now` (a UI control's `to: now`, an edited
  answer) is still an exact look-back for a look-back form, in declared order: within the tool's
  step it runs as sent, past it the drift law redraws or records `shifted`. A whole
  calendar period (`yesterday`), which keeps its grain and records no endpoint, is not yet: its
  covering look-back is spelled at the turn's `now`; the person answers later, so it runs after
  the clock moved on and is recorded `shifted` (the result check then reads the front it missed). A start and end the person gave argument by argument are judged together, but
  their call's `call-window` row stays `not-filled` (`ctx.time.asked` is absent there). A turn with
  no time words does not carry the last window yet (`time-carried`, § 5.6).
- The result checks (T8) read what the record holds and nothing else: a call whose tool declares
  no forms has no asked range, so only its declared read is checked against `retention`; a
  typed answer (`.outputSchema()`) carries the checks on the `period` rows (`agent.findings()`),
  not in `answerCoverage`; § 9.1's `partly-future` is not checked. The paid bench of T8 (the false
  "not sure" rate on correct answers, TQ8) has not run.
- The English reader reads English digits only; words for numbers ("two hours"), a month named
  alone, week days and parts of the day read "unreadable" (and are asked, nothing pre-filled) until
  a bench shows people need them. Its word
  table is data inside `readers/english.ts`; a second language moves it beside `src/locales/`.
- Over MCP a time field with choices travels as the choices plus the free-entry properties (a
  person answers one or the other); MCP has no range, so a range is two `date-time` properties.
- v1 resolves a day word only (`today`, `yesterday`, `tomorrow`); a part of the day, a calendar
  week, month or year, and a window anchored on the previous one are named `unsupported`. A
  resumeOnError retry keeps the first attempt's reading, resolved against that attempt's clock.
- A clock is stamped once per RUN: `resumeOnError` and a continued conversation are new runs and
  stamp their own (a pause-and-resume is the one frozen case).
- The axis's `interval` is checked for shape only; nothing yet checks the rows' spacing against
  it, and the chart domain rule of the design's § 8 (one call's asked period) belongs to the
  consumers.
- A calendar day or week in a zone: `roundOutward` counts steps from the epoch in UTC.

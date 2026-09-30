# Time as one library layer

**Design and implementation plan, 2026-09-29. Nothing in it is built. Every question in § 14 is
open and carries a recommended answer; the owner decides.**

| Page | What it holds |
|---|---|
| [README.md](README.md) | this page: the problem, the model, the clock, the reader, the ask, tool capabilities, results and datasets, the checks, the consumers, the configuration, the contract, the plan, the questions |
| [research.md](research.md) | how 19 other systems handle time, with sources; what we borrow and what we avoid |

- Written against agentfootprint 9.127.0 (`c05834a1`) and the honesty design in
  [../honesty/](../honesty/README.md), whose laws this page keeps unless it says otherwise.
- Code is cited as `file · symbol`. Paths are under agentfootprint's `src/` unless they start with
  `host:` (the host app that field-tests the library), `viz:` (vizfootprint, the dashboard engine)
  or `lens:` (agentfootprint-lens). The agent loop's folders are written short: `coverage/`,
  `arguments/`, `evidence/`, `results/`, `assessment/` mean `src/core/agent/<folder>/`.
- **In flight** marks work on an unmerged branch: the declared time axis
  (`feat/dataset-time-axis`, `artifacts/timeAxis.ts`), the gate's person-values fix
  (`fix/person-values-normalized`), and the host's future-window and tool-capability fix.

## For the owner

1. **One layer, one owner.** Every time shape and every time grammar moves into one folder,
   `src/core/time/`. Today the library already has three grammars that disagree with each other
   (§ 1.3), and the host has four more.
2. **The clock is an input.** The app declares "now" and its zone once per turn; the library
   records it, freezes it across a pause, and never reads the wall clock for a time decision.
3. **The person's words are read by a strategy the app arms.** The library ships a careful English
   default and a port; the host's parser becomes one strategy among others. A strategy returns
   every reading it sees, never a pick. The library's policy — configuration, not code — collapses
   the readings or asks.
4. **One ask, one range, many spellings.** An ambiguous or future window becomes one typed ask with
   the readings as choices. A tool declares which spellings it accepts; the library converts the
   one resolved range into that spelling, and a conversion that cannot be exact is recorded
   ("wider than asked") or refused before the call.
5. **Results and datasets use the same instants.** A result's period (step 7b) and a dataset's
   time axis (in flight) share one instant rule and one duration grammar. The side panel, the
   answer's limits block, the metrics dashboard and vizfootprint read the same declaration, so
   nothing guesses which column is time.
6. **Off means byte-identical.** Nothing changes unless the app arms `.time()` or a tool declares a
   capability.
7. **One ruling is needed first: Q39.** "The library never parses '2h'" becomes two laws: the
   library never reads the **person's** words except through an armed strategy, and it reads and
   writes **author-declared machine spellings** through one grammar (§ 5.4, TQ1).

---

## 1. The problem

### 1.1 In the owner's words

> Time keeps breaking in pieces in a real app. We are building a library for everyone, not only
> for my friend.

The owner asked for **one** universal solution in the library, driven by configuration, with a
pluggable strategy where language or locale matters, and asked how it serves tool arguments,
reports, the side panel, vizfootprint and the metrics dashboard.

### 1.2 The seven field breaks

| # | What happened | Where it lives today | Owner today |
|---|---|---|---|
| 1 | The person's words ("10/09/26 8 AM to 8:40 AM PST", "yesterday morning") are read by app code | `host:be-server/timeContext.ts` (369 lines) · `prepareQueryWindow`, `finishQueryWindow`, `readClockRanges`, `numericReadings`, `zoneMismatch`; `host:be-server/queryWindowFlow.ts` (170 lines) · `createQueryWindowFlow` | the app, English and US only; arms for one source's tools only (a text match on that source's name) |
| 2 | A refused answer was re-asked in silence, in a loop | `core/inputRequest.ts` · `InputRefusal`, `InputRepeat` | **fixed** in 9.127.0 |
| 3 | A date in the future was accepted | in flight on the host · `timeContext.ts` · `FutureWindowError` | the app, one flow only; a model-chosen argument or a library ask is never checked |
| 4 | A tool that takes only a look-back (`window` pattern `^-?[0-9]+[smhdw]$`) was given an absolute window | `host:py-tools/server.py` · `_DUR`; in flight `host:be-server/windowCapability.ts` · `windowCapability` (probes the schema's `pattern` with sample strings), `coveringLookback` | the app, inferred by regex probing; the widening is unrecorded |
| 5 | Charts are not drawn as time series; the panel guesses the time column | `host:be-server/web/src/artifacts/autoSpec.ts` · `TIMESTAMP_FIELD`, `DATE_SHAPED`; `chartSelection.ts` · `formatBound` (UTC only) | the panel's guess; epoch seconds are never temporal |
| 6 | Sources on different clocks (UTC, UTC−7) are compared by eye | `host:py-tools/server.py` · `_epoch_str` (formats in the sidecar host's local zone and never names it); `viz:src/def/series.ts` · `SeriesPoint.t` (ISO strings compared lexicographically) | nobody |
| 7 | The evidence gate flags the person's own time values once normalised (8 AM → 8:00) | `evidence/extract.ts` · `classifyToken`; in flight `fix/person-values-normalized` | a clock-spelling table private to the gate |

Break 2 is closed. The other six have one cause: **time has no owner**. Each piece solves its own
slice with its own vocabulary, and nothing records what the others decided.

### 1.3 The library already disagrees with itself

Three time grammars live in the library today, written separately:

| Grammar | Where | Seconds unit | `2026-10-09t08:00z` (lowercase) | `2026-02-30T08:00Z` | `…T23:59:60Z` (leap second) |
|---|---|---|---|---|---|
| a result's instant | `coverage/period.ts` · `instantOf` | — | accepted | refused (day checked) | accepted (RFC 3339) |
| an `iso-range` argument | `arguments/declare.ts` · `ISO_INSTANT` + `Date.parse` | — | refused | **accepted** (`Date.parse` rolls it to 2 March) | refused (`Date.parse` → NaN) |
| a look-back | `arguments/declare.ts` · `LOOKBACK` | **no** (`[mhdw]`) | — | — | — |
| a dataset's interval (in flight) | `artifacts/timeAxis.ts` · `INTERVAL` | **yes** (`[smhdw]`) | — | — | — |

Measured on Node for this page. A tool whose argument spelling passes `declare.ts` can mint a
period `period.ts` refuses, and the reverse. This is the smallest proof of the design's first law:
two owners of one grammar drift.

### 1.4 What this page reverses

The honesty design ([../honesty/README.md](../honesty/README.md) § 3.2 (i)) said an absolute,
compound window — a date, a year, a zone, two bounds, a DST-safe conversion — "stays app code".
The owner's brief overturns that: the host's code is exactly what every other app would write
again. This page moves it into the library behind a strategy port, and keeps the part that truly
varies (reading one language's words) pluggable.

---

## 2. What other systems do

Full comparison with sources: [research.md](research.md).

| Borrow | From | Where it lands |
|---|---|---|
| Four kinds, never coerced: instant, zoned wall time, plain wall time, duration; only instants compare | TC39 Temporal, Apache Arrow, TimeML | § 3 |
| Resolution = f(text, anchor, zone, policy), all four recorded; the anchor is the **message's** time | Duckling, Rasa, TimeML | § 4, § 5 |
| Ambiguity returned as data, collapsed only by a declared policy; "ask" is a policy | Recognizers-Text, Temporal `reject`, dateparser `STRICT_PARSING` | § 5, § 6 |
| The policy vocabulary: date order, prefer past, required parts, zone | dateparser, chrono-node | § 11 |
| Grain, and said vs implied, per value | Duckling `grain`, chrono-node `isCertain` | § 3, § 9.5 |
| One range, many declared spellings, converted by the system | Grafana format modifiers; LangChain's failure without it | § 7 |
| Derived interval, and the clamp **reported** | Grafana, Datadog (which clamps silently) | § 7, § 8 |
| Explicit edges | Elasticsearch rounding, OpenTelemetry intervals | § 3.3 |
| A declared time column per dataset | Splunk `_time`, Vega-Lite `temporal`, OTel, Arrow | § 8 |
| IANA names, abbreviations only through a recorded map; offset **and** zone together | IANA, RFC 9557 | § 3, § 5 |

| Avoid | Seen in |
|---|---|
| A clock tool, with the model doing the arithmetic | Semantic Kernel `TimePlugin` |
| The model writing filter literals | LangChain, LlamaIndex |
| A format check taken as honesty (a valid `date-time` can be the wrong instant) | OpenAI, Anthropic, MCP |
| `values[0]` — taking the first reading | Recognizers-Text consumers, chrono-node's default |
| The browser or server zone as a silent default | Kibana (and its agent surface, kibana#290443), Grafana, Semantic Kernel |
| Silent coarsening | Datadog |
| Local-vs-UTC string parsing | Vega-Lite |

No agent framework surveyed records which reading was taken, what it was resolved against, or
whether the read matched the ask. That record is what this layer adds.

---

## 3. The canonical model — one owner

### 3.1 The folder

`src/core/time/` is a leaf: it imports nothing from the agent loop. `coverage/period.ts`,
`arguments/declare.ts`, `artifacts/timeAxis.ts` and `evidence/` import from it; none keeps its own
grammar.

| File | Owns |
|---|---|
| `instant.ts` | the one instant rule, moved from `coverage/period.ts` · `instantOf` unchanged (exact, no `Date.parse`), plus `compareInstants`, `toUtc` |
| `duration.ts` | the one duration grammar `^[1-9][0-9]{0,5}[smhdw]$`, `durationMs`, `spellDuration` (the smallest exact spelling) — merging `declare.ts` · `LOOKBACK` and the in-flight `timeAxis.ts` · `INTERVAL` |
| `zone.ts` | IANA validation and offset arithmetic through `Intl` (no dependency); wall time → instant with Temporal's four DST words |
| `range.ts` | `TimeRange`, edges, `covers`, `overlaps`, `roundOutward` |
| `clock.ts` | `TimeClock` (§ 4) |
| `axis.ts` | `DatasetTimeAxis` (§ 8), moved from the in-flight `artifacts/timeAxis.ts` |
| `reader.ts` | the `TimeReader` port and its result shape (§ 5) |
| `readers/english.ts` | the default strategy (§ 5.3) |
| `forms.ts` | every spelling the library can derive from one resolved window (§ 9.5) |
| `present.ts` | rendering for a person, in a named zone and locale, through `Intl.DateTimeFormat` |

### 3.2 The types

```ts
/** ISO 8601 instant WITH an offset — `coverage/period.ts` · `instantOf`'s rule. */
type InstantText = string;
/** An IANA zone name, checked through Intl. Never an abbreviation. */
type ZoneName = string;
/** The one duration grammar: `^[1-9][0-9]{0,5}[smhdw]$`. A machine spelling, never a person's words. */
type DurationText = string;
type Grain = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/** Half-open [from, to). The same `{ from, to }` as `DeclaredPeriod.queried`. */
interface TimeRange {
  readonly from: InstantText;
  readonly to: InstantText;
}

/** What was asked, before the clock is applied. */
type TimeWindow =
  | { readonly kind: 'range'; readonly range: TimeRange }
  | { readonly kind: 'lookback'; readonly duration: DurationText }; // always "until the clock's now"

/** A window read from words or answered in an ask, resolved against the clock. */
interface ResolvedWindow {
  readonly window: TimeWindow;
  readonly range: TimeRange;            // always present: a look-back resolved against the clock
  readonly zone: ZoneName;              // the zone the person meant, else the app's
  readonly grain: Grain;                // the finest part the person said
  readonly said: readonly TimePart[];   // 'year' | 'month' | 'day' | 'hour' | 'minute' | 'meridiem' | 'zone'
  readonly implied: readonly TimePart[];
  readonly anchor: 'message' | 'previous-window' | 'none';
  readonly notes: readonly TimeNote[];  // e.g. { kind: 'abbreviation-corrected', said: 'PST', zone: 'America/Los_Angeles', offset: '-07:00' }
}
```

Rules:
- **Only instants compare.** A wall time without a zone ("8 AM") stays a part of a reading until a
  zone is attached by a recorded rule. `period.ts` already refuses zone-less instants (RFC 3339
  § 4.4); every new shape inherits that.
- **The record is UTC-comparable, the reading keeps its zone.** A resolved range is stored with the
  offset the person meant (`2026-10-09T08:00:00-07:00`); the zone name travels beside it
  (RFC 9557's `[America/Los_Angeles]` in one field, not one string, so no existing reader breaks).
- **A duration is a machine spelling.** It appears in a tool's declaration, a tool's argument or a
  dataset's interval. The person's "40 minutes" is words, read only by a strategy (§ 5).

### 3.3 Edges

A range is half-open `[from, to)`. When a person says an end at a grain ("to 8:40"), the default
reading runs to the end of that grain — `[08:00, 08:41)` — and records `{ kind: 'end-of-grain' }`
(Elasticsearch's `lte` rounding). The alternative, `exact`, is configuration (§ 11, TQ9). A tool's
declared `granularity` rounds a range outward, never inward, and records the rounding.

---

## 4. The run clock — a declared, recorded input

The library has no clock by law today: `coverage/period.ts` · `periodVerdict` says "no clock is read", and `arguments/declare.ts` · `parsesUnderSpelling` says "no instant is compared with 'now'". A future
check, a look-back → range conversion and a relative word ("yesterday") all need one. So the clock
becomes an **input**, never a hidden read.

```ts
interface TimeClock {
  readonly now: InstantText;            // the anchor for this turn
  readonly zone: ZoneName;              // the app's zone
  readonly source: 'app' | 'default';   // the app passed `now`, or the library took the turn's start
}
```

- **Declared per turn.** `agent.run({ message, time: { now, zone } })`. `now` should be the
  **message's** time (Rasa's rule), so a replay or a late resume reads "yesterday" the same way.
  When the app passes none, the library takes the turn's start once and records `source: 'default'`
  — a default nobody chose, admitted like `askOrAssume`'s (TQ5).
- **Frozen across a pause.** The clock is a run constant written once at the turn's seed. A
  `requestInput` pause and its resume read the same clock; the host's
  `host:be-server/timeContext.ts` · `applicationClock` already does this by hand
  (`host:docs/TEMPORAL_INPUT_WORKFLOW.md`).
- **Recorded once.** One `clock` stamp per turn on the ledger: `{ now, zone, source }`. Every time
  row cites it. A reader of the record can re-derive every resolution from the stamp and the
  message.
- **The zone is required when armed.** `.time({ zone })` has no default; a server's local zone is
  exactly the silent default the research warns against (TQ10).

---

## 5. The person's words — a pluggable reader

### 5.1 The port

```ts
interface TimeReader {
  /** Recorded on every reading, e.g. 'agentfootprint/english@1'. */
  readonly id: string;
  read(text: string, context: TimeReadContext): TimeReading | Promise<TimeReading>;
}

interface TimeReadContext {
  readonly clock: TimeClock;
  readonly zone: ZoneName;                 // the person's zone if the app knows it, else the clock's
  readonly abbreviations: Readonly<Record<string, ZoneName>>;   // from policy; empty = none accepted
  readonly previous?: ResolvedWindow;      // the last resolved window in this conversation ("the hour before that")
}

interface TimeReading {
  readonly mentions: readonly TimeMention[];
}

interface TimeMention {
  readonly quote: string;                        // verbatim substring of the text — the library checks it
  readonly candidates: readonly TimeCandidate[]; // every reading; more than one = ambiguous
  readonly problem?: 'unreadable' | 'zone-unknown';
}

interface TimeCandidate extends ResolvedWindow {
  /** Which rule produced this reading, so a POLICY can choose among them. */
  readonly reading: Readonly<{
    dateOrder?: 'MDY' | 'DMY' | 'YMD';
    meridiem?: 'am' | 'pm';
    year?: 'said' | 'current' | 'previous';
    dst?: 'earlier' | 'later';
  }>;
}
```

The split is the design:
- **A strategy reads.** It returns every candidate it sees, tagged with the rule that produced it.
  It never picks, never refuses a future date, never applies a date order.
- **The library decides**, the same way for every strategy: it re-checks every candidate with
  `core/time/` (instants with offsets, IANA zones, `from < to`, the quote is a substring), then
  applies the declared policy (§ 11): date order, year, future, DST, abbreviation mismatch. What
  the policy cannot settle becomes one typed ask (§ 6).

This keeps configuration uniform: an app that swaps the English strategy for a Spanish one keeps
the same `dateOrder: 'ask'`, the same `future: 'refuse'`, the same record.

### 5.2 When it runs

Once per turn, at the seed, over the person's message only — never over tool results or model text
(the honesty law: library-authored and model-authored text never ground a value). The reading is a
run constant beside the clock. It is **used lazily**: nothing is asked until a tool that declares a
period is about to be called, so a turn that never reads time never asks (the needless-ask metric,
[../honesty/inputs.md](../honesty/inputs.md)).

### 5.3 The careful default

`readers/english.ts` ships in the library, with no dependency. It reads a small, closed set and
says "unreadable" for the rest, rather than guessing:

| Reads | Example | Candidates |
|---|---|---|
| ISO dates and instants | `2026-10-09`, `2026-10-09T08:00-07:00` | one |
| numeric dates | `10/09/26` | up to three (MDY, DMY, YMD), each tagged |
| clock times, with or without a meridiem | `8 AM`, `8:40`, `20:40` | `8:40` alone → am and pm when no context settles it |
| a range between two of the above | `8 AM to 8:40 AM`, `08:00–08:40` | one per combination of the parts' candidates |
| a zone | IANA (`America/Los_Angeles`), a numeric offset, an abbreviation **only through the declared map** | an abbreviation whose DST state disagrees with the date is corrected and noted, per policy |
| day words | today, yesterday, tomorrow, tonight, overnight | anchored on the clock, in the person's zone |
| parts of a day, from a data table the app may override | morning, afternoon, evening | `morning` = `[06:00, 12:00)` by the default table, noted as `{ kind: 'part-of-day', table: 'default' }` |
| relative spans | last 40 minutes, past 2 hours, last week | a look-back (§ 3.2) or a calendar range for "last week" |

Words for the person's language live as data beside `src/locales/` (a catalog of words, no code),
so a second language is a table plus, at most, a strategy for its grammar.

### 5.4 The host's parser as the reference strategy, and the Q39 ruling

The host's `timeContext.ts` readers become a `TimeReader` in the host (`readClockRanges`,
`readFullRanges`, `numericReadings`, `zoneAbbreviation`), minus everything the library now owns: the
clock, the policy, the ask, the future check, the capability probe. It is the reference strategy
the default is tested against: the host's field cases become the default's test table.

**Q39** ([../honesty/decisions.md](../honesty/decisions.md)) kept `narrower-than-asked` out of v1
because it "would bend 'never parses 2h'". That law protected one thing: the library must not
read a person's phrase as if it were a machine format. This page splits it (TQ1):

| Law | Covers | Read by |
|---|---|---|
| **T-words.** The library never reads the person's words except through an armed `TimeReader`, and never picks among its readings except by a declared policy or an ask. | "last 2 hours", "10/09/26", "yesterday morning" | a strategy the app arms |
| **T-spellings.** The library reads and writes **author-declared machine spellings** through one grammar in `core/time/duration.ts`. | a tool's `-40m` argument, a declaration's `retention: '30d'`, a dataset's `interval: '5m'` | the library |

Under that split, `convertSpelling` may turn a range into a look-back (§ 7), and
`narrower-than-asked` becomes possible (§ 9.2).

---

## 6. One time ask

Today's ask cannot hold a window: `core/inputRequest.ts` · `InputField.type` is `string | number
| boolean`, so every app re-checks shape, order, zone and future-ness itself.

### 6.1 The field

```ts
interface InputField {
  // …unchanged…
  /** New. A time field: the library validates the answer before the app sees it. */
  readonly format?: 'instant' | 'time-range' | 'zone';
}
```

- The value stays a **string** on the wire, so every surface that renders an ask today still works:
  a `time-range` answer is an ISO 8601 interval `from/to` of instants with offsets; a `zone` answer
  an IANA name.
- **Choices** are the candidates the policy could not settle, as `enum` values, each with a label
  rendered by `core/time/present.ts` in the person's zone ("Fri 9 Oct 2026, 08:00–08:41 PDT").
  Free entry stays open unless the app says `strict`.
- Over MCP, a `time-range` field maps to two `date-time` elicitation fields (the MCP elicitation
  schema has `date-time`, not ranges).

### 6.2 Re-validation, refusal and repeat

An answer goes through the same checks as a reading: instants with offsets, `from < to`, the future
policy, the chosen tool's retention and `maxRange`. A failing answer is re-asked with the 9.127.0
shapes — `refused: { answer, reason }` and the runtime's `repeat: { count }`.

One refinement to 9.127.0: `InputRefusal.reason` is "the app's words; the library never writes
one". Here the library validates, so it needs a reason. **Recommended (TQ7):** the reason is a
sentence from a catalog in `src/locales/` (human-facing text, which that folder already holds), the
app may override every key, and only checks the app armed can produce one.

### 6.3 What is asked, and when

| Situation | Ask |
|---|---|
| `10/09/26` under `dateOrder: 'ask'` | "Which date did you mean?" — the readings as choices |
| a date without a year under `year: 'ask'` | the year's readings as choices |
| every reading in the future under `future: 'refuse'` | nothing is asked; the call is refused with the reason ("that window has not happened yet") |
| some readings future, some past | the past ones as choices |
| a wall time in a DST gap or overlap under `dst: 'reject'` | the two instants as choices |
| an abbreviation not in the map | the zone, `format: 'zone'` |
| a tool needs a period and the person said none | the tool's own `askOrAssume` rule, unchanged; its choices may now be ranges |

One ask per batch, before anything dispatches — the inputs layer's rule
([../honesty/README.md](../honesty/README.md) § 3.2 (e)). An answer is recorded as `answered`; the
evidence gate counts it as the person's words (§ 9.5).

---

## 7. Tool time capabilities and conversion

### 7.1 The declaration

`ToolPeriod` (owned by `arguments/declare.ts`) grows additively. Today it is `{ argument,
spelling? }`.

```ts
interface ToolPeriod {
  readonly argument: string;
  readonly spelling?: PeriodSpelling;                // unchanged: the one spelling, when there is one
  readonly accepts?: readonly PeriodSpelling[];      // new: every spelling the argument takes
  readonly zoneArgument?: string;                    // new: the argument naming the zone of a 'wall-range'
  readonly retention?: DurationText;                 // new: the oldest data the source keeps
  readonly maxRange?: DurationText;                  // new: the widest window the tool accepts
  readonly granularity?: DurationText;               // new: the source's smallest step
  readonly widen?: 'record' | 'refuse';              // new: range → look-back when the tool takes no range
}
type PeriodSpelling = 'lookback' | 'signed-lookback' | 'iso-range' | 'wall-range'; // 'wall-range' new
```

`wall-range` is two plain date-times joined by `..` with the zone in `zoneArgument`. The host's
packet-record tools accept a look-back, an `iso-range`, or a `wall-range` with a `timezone`
argument, in one argument (`host:py-tools/server.py` · `_eh_query_window`, which also keeps a
look-back grammar of its own, `[mhd]`). A `wall-range` without a `zoneArgument` is refused
at definition.

The capability is **declared**, never probed. The host's `windowCapability` reads a schema's
`pattern` by testing sample strings; that goes away.

### 7.2 The conversion

The library converts the one resolved range into the spelling the tool accepts, at the inputs
layer, before dispatch, against the turn's clock.

| Asked | Tool accepts | Library sends | Exact? | Recorded |
|---|---|---|---|---|
| a look-back | `lookback` / `signed-lookback` | the same, minus added or removed | yes | `converted` |
| a look-back | `iso-range` | `[now − L, now)` with offsets | yes | `converted` |
| a look-back | `wall-range` + zone | wall times in the tool's zone; a DST gap is refused | yes | `converted` |
| a range | `iso-range` | the range | yes | — |
| a range | `wall-range` + zone | wall times in the tool's zone | yes | `converted` |
| a range ending at now (within `granularity`) | a look-back spelling | the smallest exact spelling that covers `from` | rounding only | `converted`, `rounded` |
| a range ending before now | a look-back spelling, `widen: 'record'` | the covering look-back from now | **no — wider** | `wider-than-asked`, with both ranges |
| a range ending before now | a look-back spelling, `widen: 'refuse'` | nothing | — | refused before dispatch |
| a range older than `retention` | any | nothing | — | refused before dispatch: `period-beyond-retention` |
| a range wider than `maxRange` | any | nothing | — | the ask, to narrow it; or refused |

The wider row is the honest version of the host's `coveringLookback`: the read covers more than
was asked, the record says so, and the answer's limits block says so in words (§ 10.2). Whether the
standing reads "not sure" is TQ8.

### 7.3 Who writes the argument

Two laws of the honesty design hold: the library acts only on declarations, and it never writes
over a value the model chose.

- The model **left the period out** → the library fills it from the resolved window, converted to
  the tool's spelling, as the `assume` precedent fills a default. The argument row's source is
  `said` (the person's words, through the reader) or `answered` (the ask).
- The model **gave the same window** in any accepted spelling → the row says `said`, matched after
  conversion.
- The model **gave a different window** → the call is refused before dispatch with a past-tense
  correction naming the spelling the person's window takes for this tool ("The person asked for
  08:00–08:41 PDT on 9 Oct; for this tool that is `window: '2026-10-09T08:00..2026-10-09T08:41',
  timezone: 'America/Los_Angeles'`."). The model calls again (TQ6).

The tool also receives the asked range as instants, `ctx.time.asked`, so it can declare the
`period.queried` its read covered without parsing its own argument.

---

## 8. Results and datasets — one type family

Two declarations answer two questions, and share every rule in `core/time/`:

| Declaration | Question | Home | Status |
|---|---|---|---|
| `DeclaredPeriod { queried, held \| 'unknown', readAt? }` | what did this **read** cover? | `coverage/period.ts` (rules move to `core/time/instant.ts`) | shipped (step 7b); the host mints none yet |
| `DatasetTimeAxis { column, unit, zone?, interval?, aggregate? }` | which **column** is time, in what clock, at what grain? | in flight `artifacts/timeAxis.ts` → `core/time/axis.ts` | in flight |

- **One grammar.** `interval` uses `core/time/duration.ts`; `zone` uses `core/time/zone.ts`. The
  in-flight branch's private `INTERVAL` regex goes away.
- **They travel together.** A dataset minted from a call carries both: `ArtifactMeta.timeAxis` (in
  flight) and the call's period. A chart's time domain is then `period.queried` — what was asked —
  not the rows' min and max, so a stretch the store does not hold shows as a gap instead of a
  squeezed axis.
- **The axis is normalised before anyone compares.** `core/time/axis.ts` · `normaliseInstants`
  turns a dataset's time column into UTC `Z` instants at one precision (epoch seconds and
  milliseconds included), so a lexicographic compare downstream is chronological. This is the
  guarantee vizfootprint's date law assumes and nothing supplies today (§ 10.4).
- **A naive column never joins.** An `iso` axis without offsets and without a declared `zone` is
  refused at definition (the in-flight rule); a consumer never compares two naive columns.
- **Optional later:** `temporality: 'delta' | 'cumulative' | 'gauge'` (OpenTelemetry), so no chart
  sums a running total (TQ15).

---

## 9. The checks that fall out

Each check reads declarations and the clock stamp; none reads words.

| # | Check | Reads | Resolve | Row / reason |
|---|---|---|---|---|
| 9.1 | **Future window** | resolved range, clock | refuse, or ask with the past readings (§ 6.3); a range ending after now is read to now and noted | `time-future`; `partly-future` |
| 9.2 | **Narrower than asked** | the argument's resolved range vs the result's `period.queried` | flag | `period-narrower-than-asked` → "not sure" (reopens Q39, TQ1) |
| 9.3 | **Wider than asked** | the conversion row | flag | `period-wider-than-asked` (TQ8) |
| 9.4 | **Retention** | the tool's `retention`, the clock | refuse before dispatch; the result's `held` still decides after | `period-beyond-retention` |
| 9.5 | **Evidence lineage for the person's time values** | the resolved window, `core/time/forms.ts` | exempt | an answer's `8:00`, `08:40`, `2026-10-09`, `PDT`, `-07:00` trace to the reading row at its grain |
| 9.6 | **Clocks differ across sources** | periods and axes in one answer | flag; every comparison is done on UTC instants | `clocks-differ { tools, zones }`; the limits block names each source's clock |
| 9.7 | **Clock skew** | a result's `readAt` vs the clock, with a declared tolerance | flag | `clock-skew { tool, by }` |
| 9.8 | **Correlation claims** (later) | claim rows ("A happened before B") | flag | waits for committed claim rows (the Q46 precedent) |

**9.5 in detail.** The in-flight gate fix keeps a table of clock spellings private to `evidence/`.
Here the gate asks one function, `forms.ts` · `timeFormsOf(window, presentation)`, which lists
every spelling the library itself can derive from a **recorded** reading: the quote, the ISO
instants, the presentation line's parts, the offsets, the zone and its abbreviation at that date.
"8 AM" said at grain hour matches `8:00` and `08:00` because both are the same instant at that
grain — equality, not a new fact (Duckling's grain). A time value the answer states that no
reading produced still fails. The gate is not loosened; it gains a lineage.

---

## 10. How it serves the consumers

### 10.1 Tool arguments

The resolved window reaches every tool that declares a period, in the tool's own spelling (§ 7).
The model never does date arithmetic and never writes a filter literal. The tool gets
`ctx.time.asked` as instants.

### 10.2 The answer's limits and reports

Under `.limitsTravelWithTheAnswer()`, `coverage/period.ts` · `periodLine` prints raw ISO instants
today, although [../honesty/results.md](../honesty/results.md) § 3.5 promised words. With `.time()`
armed, the line is rendered by `present.ts` in the presentation zone, with the zone named and the
raw instants kept in the typed `answerCoverage`:

```
Period (client_activity): Fri 9 Oct 2026, 08:00–08:41 PDT (UTC−7) — read 05:20–08:41, wider than asked
Period (packet_records):  Fri 9 Oct 2026, 08:00–08:41 PDT (UTC−7) — covered
Clocks: client_activity reports in UTC; packet_records in America/Los_Angeles — compared as instants
```

Not armed: byte-identical to today. A report built from the record (the `/observe` answer account)
uses the same renderer.

### 10.3 The host's side panel

| Rule | Replaces |
|---|---|
| A dataset with a declared axis is **always** drawn as a time series; a malformed declaration draws nothing and says why | `autoSpec.ts` · `TIMESTAMP_FIELD` / `DATE_SHAPED` guesses (kept only as a fallback that labels itself "time column guessed") |
| The x domain is the call's `period.queried`; unheld stretches are gaps | min/max of the rows |
| Panels from one turn share one time axis, keyed by the turn's resolved window | one axis per chart |
| Brush bounds render in the presentation zone | `chartSelection.ts` · `formatBound` (UTC only) |
| **Time range as a control**: a brushed range is sent back as a typed `time-range` value for the next turn, recorded as `answered`, never as words the reader must re-parse | re-typing the window in the chat |

The in-flight host branch (`feat/declared-time-axis`) already honours `readTimeAxis(meta)`; the
remaining rows are host work after steps T2 and T3.

### 10.4 vizfootprint — the contract only

No vizfootprint code change is proposed here; the owner decides when, after its refactor. The
contract is what vizfootprint would read, and it maps onto shapes vizfootprint already has:

| Library declaration | vizfootprint shape it would fill |
|---|---|
| `DatasetTimeAxis.column` | a declared `ColumnType 'date'` (`viz:src/data/types.ts`; `viz:src/def/builtinAnalyses.ts` · `DECLARABLE_TYPES`) |
| `interval` + `aggregate` | `SeriesGrain { bucket, reducer }` (`viz:src/def/types.ts`) — computed-on, not only a caption |
| `normaliseInstants` output (UTC `Z`, one precision) | the precondition of `SeriesPoint.t`'s lexicographic order and `IntervalClause`'s string bounds |
| `period.queried` | the series' x domain |
| a brushed `TimeRange` | `IntervalBounds` (half-open) |
| the presentation zone | the caller's `formatDate` |

The adapter from one to the other would live in the host or a bridge package, not in vizfootprint.

### 10.5 The metrics dashboard

The host's metrics dashboard has the richest declared time model in the codebase, in a private
vocabulary (`host:be-server/metrics/server/source-adapters.mjs` · `windowTime`, `table(…,
temporalKind)`). Each field maps onto a library declaration, so the dashboard reads tool
declarations instead of keeping its own table:

| Dashboard field | Library source |
|---|---|
| `windowTime.windows` (`1h`, `6h`, `24h`) | the tool's `askOrAssume` choices for its period argument |
| `windowTime.absoluteRange` | `accepts` includes `iso-range` or `wall-range` |
| `windowTime.maxRangeHours` | `maxRange` |
| `temporalKind: 'time-series'` | a dataset axis with `aggregate: 'raw'` or an interval |
| `temporalKind: 'window-rollup'` | a period, no axis (one summary over the whole window) |
| `temporalKind: 'latest-sample'` | `readAt` only |
| `temporalKind: 'inventory-snapshot'` | no period, no axis |
| the history adapter's `bucket_seconds` from the range length | the derived interval (Grafana's rule), with the clamp recorded |
| the dashboard's time range | the same `TimeRange` the chat resolves — one range object across panel, chat and dashboard |

### 10.6 The lens

agentfootprint-lens reads none of this today (`lens:src` has no `period`, `readAt` or `timeAxis`).
It gains: the clock stamp; each reading (quote → candidates → how one was chosen: policy, ask,
answer); the conversion rows, `wider-than-asked` first; the period verdicts; the dataset axis. The
lens learns each row before any tool mints it ([../honesty/results.md](../honesty/results.md) § 3.6).

---

## 11. The configuration

One builder option, one run option, and the tool's declaration.

```ts
import { Agent, defineTool, englishTimeReader, US_ZONE_ABBREVIATIONS } from 'agentfootprint';

const clientActivity = defineTool({
  name: 'client_activity',
  description: 'Client operations on the storage cluster over a look-back.',
  inputSchema: {
    type: 'object',
    required: ['window'],
    properties: { window: { type: 'string', pattern: '^-?[0-9]+[smhdw]$' } },
  },
  askOrAssume: { window: { assume: '-1h' } },
  period: {
    argument: 'window',
    accepts: ['signed-lookback'],
    retention: '30d',
    granularity: '1m',
    widen: 'record',                   // an absolute window is read as a covering look-back, and recorded
  },
  execute: async (args, ctx) => { /* ctx.time.asked = { from, to } as instants */ },
});

const packetRecords = defineTool({
  name: 'packet_records',
  // …
  period: {
    argument: 'window',
    accepts: ['signed-lookback', 'iso-range', 'wall-range'],
    zoneArgument: 'timezone',
    maxRange: '24h',
  },
  // …
});

const agent = Agent.create({ provider, model })
  .tool(clientActivity)
  .tool(packetRecords)
  .time({
    zone: 'America/Los_Angeles',               // required: the app's zone, never the server's
    present: { zone: 'asked', locale: 'en-US' }, // 'asked' = the zone the person meant, else the app's
    reader: englishTimeReader({ partsOfDay: { morning: ['06:00', '12:00'] } }),
    policy: {
      dateOrder: 'ask',                        // '10/09/26' → the readings as choices
      year: 'ask',                             // a date said without a year
      future: 'refuse',                        // an analysis agent reads the past
      abbreviations: US_ZONE_ABBREVIATIONS,    // accepted only through this map, and recorded
      abbreviationMismatch: 'correct',         // 'PST' on 9 Oct → America/Los_Angeles, −07:00, noted
      dst: 'reject',                           // a wall time that does not exist or happens twice → ask
      endEdge: 'end-of-grain',                 // 'to 8:40' reads through 08:40:59
      mismatch: 'refuse',                      // the model's window differs from the person's → corrected
    },
    checks: { retention: 'refuse', clocks: 'flag', skew: '5m' },
  })
  .limitsTravelWithTheAnswer()
  .build();

await agent.run({
  message: 'Show client activity 10/09/26 8 AM to 8:40 AM PST',
  time: { now: message.sentAt, zone: session.zone },  // the message's time; the person's zone if known
});
```

| Option | Default | Why that default |
|---|---|---|
| `zone` | **none — required** | a silent server zone is the most-cited failure in the research |
| `present.zone` | `'asked'` | the person reads the clock they spoke in |
| `present.locale` | `'en-US'` | matches the default reader; overridable |
| `reader` | `englishTimeReader()` | ships, no dependency |
| `policy.dateOrder` | `'ask'` | no silent MDY (dateparser's documented trap) |
| `policy.year` | `'ask'` | the host's own field policy |
| `policy.future` | `'refuse'` | break 3; forecasting apps set `'allow'` |
| `policy.abbreviations` | `{}` (none accepted → ask the zone) | IANA: abbreviations are ambiguous |
| `policy.abbreviationMismatch` | `'correct'` | the person meant "Pacific"; the note records it |
| `policy.dst` | `'reject'` | Temporal's word for "ask" |
| `policy.endEdge` | `'end-of-grain'` | how people mean "to 8:40" |
| `policy.mismatch` | `'refuse'` | the library never overwrites a model-chosen argument |
| `checks.retention` | `'refuse'` when a tool declares `retention` | the read cannot hold it |
| `checks.clocks` | `'flag'` | break 6 |
| `checks.skew` | off | needs a tolerance the app chooses |
| run `time.now` | the turn's start, recorded `source: 'default'` | admitted like any default |

Per tool, `period.widen`, `retention`, `maxRange` and `granularity` override nothing global: they
are facts about the tool. A tool never sets policy.

---

## 12. Byte identity and the honesty contract

### 12.1 Off means byte-identical

- **Step T1 is a pure refactor.** Moving three grammars into `core/time/` must keep the 21 byte
  references in `test/core/tools/reference/` unchanged — with one named exception: where the
  grammars disagree today (§ 1.3), one of them changes. **Recommended:** `period.ts`'s rule wins
  (exact, day-checked, RFC 3339 leap second), so an `iso-range` argument of `2026-02-30T08:00Z`
  is newly refused, and `s` is added to the look-back units. Each change is a changelog line and a
  pinned test.
- Without `.time()` and without a new `ToolPeriod` field, no row, event, served byte or ask changes.
- A tool's new `ToolPeriod` fields serve bytes only inside that tool's own schema and results (the
  honesty design's clause 7).

### 12.2 The seven clauses

| Clause | The time layer |
|---|---|
| **Declare** | The app: `.time()` (zone, policy, reader, checks) and the run's clock. The tool: `period` capabilities; `period` and `timeAxis` on results and datasets. The person: only through the time ask. A strategy's reading is a reading, never evidence by itself. A malformed declaration is refused at definition, at dispatch and at MCP ingest, and never repaired. |
| **Verify** | Instants with offsets; IANA zones; `from < to`; the quote is a substring of the message; the future, retention, `maxRange` checks against the clock; the conversion's exactness. All deterministic. |
| **Record** | One `clock` stamp per turn; one `time-reading` row per mention (quote, candidates, reader id, how chosen); the argument row gains `window` and `converted`; period rows gain `narrower-than-asked` / `wider-than-asked`; `clocks-differ`, `clock-skew`. Events carry names, enums and counts; values live in the rows. |
| **Resolve** | **Ask**: an ambiguity the policy cannot settle, a DST gap, an unknown zone. **Assume**: a policy choice, recorded (`dateOrder: 'DMY'` says so on the row). **Refuse**: all readings future, beyond retention, a mismatching model window, a `widen: 'refuse'` tool. **Flag**: wider, narrower, clocks, skew. |
| **Fold** | New reasons: `time-assumed` (a policy picked among readings), `period-narrower-than-asked`, `period-wider-than-asked` (TQ8), `period-beyond-retention`, `clocks-differ` (label only). Nothing here can support "known". |
| **Serve** | The model: one registered sentence naming the person's resolved window in the tool's spelling, on the tools that declare a period; the refusal corrections. The person: the time ask; the limits lines in the presentation zone. The lens: the rows. |
| **Arm + measure** | `.time()` arms the clock, reader, ask and checks; a tool's `period` fields arm conversion for that tool. Each paid step has a bench (§ 13). |

---

## 13. Implementation plan

Every step follows the honesty design's checklist
([../honesty/README.md](../honesty/README.md) § 7): tests of all seven types, the 21 byte
references, served sentences registered in `test/modelFacingSurfaces.test.ts`, a
`ledgerRowIsWellFormed` arm per new row kind, the folder README, a CAPABILITIES row, a `.changes`
fragment, a feature example, the docs site budget measured after the last code change, and
delivery only when the host re-pins and the behaviour is counted by hand.

Benchmarks run on Haiku 4.5 only, inside a budget the owner approves per cell. Steps marked $0 are
deterministic and are measured over retained recorded runs or unit tables, with no model call.

| # | Step | Ships | Arm (off ⇒ byte-identical) | Needs | Tests (beyond the checklist) | Bench |
|---|---|---|---|---|---|---|
| T0 | **This page** | `docs/design/time/` | — | — | — | — |
| T1 | **One owner** | `src/core/time/` `instant.ts`, `duration.ts`, `zone.ts`, `range.ts`; `period.ts`, `declare.ts` import from it; the § 1.3 disagreements settled and pinned | none (refactor) | TQ1, TQ11 | property: every instant `period.ts` accepted before is accepted after; round-trip `durationMs` ↔ `spellDuration`; DST table for 20 zones through `Intl` | $0 |
| T2 | **The declared time axis, on T1** | the in-flight `feat/dataset-time-axis` rebased: `core/time/axis.ts`, `normaliseInstants`; `artifacts/` re-exports | a dataset declares `timeAxis` | T1 | epoch-s / epoch-ms / mixed offsets normalise to sorted UTC | $0; host panel hand count |
| T3 | **The clock and the presentation** | `.time({ zone, present })`, run option `time`, the `clock` stamp, the checkpoint arm, `present.ts`, `periodLine` in the presentation zone | `.time()` | T1 | the clock survives pause/resume unchanged; `source: 'default'` recorded; limits line golden files per zone | $0 |
| T4 | **The time ask** | `InputField.format`, library re-validation, labelled choices, catalog reasons (TQ7), MCP `date-time` mapping | a `format` field or `.time()` | T3 | answers out of order, zone-less, future, DST gap → re-ask with `refused` and `repeat` | $0; host hand count |
| T5 | **Tool capabilities and conversion** | `ToolPeriod.accepts`, `wall-range`, `zoneArgument`, `retention`, `maxRange`, `granularity`, `widen`; conversion table § 7.2; `ctx.time.asked`; `mismatch` refusal; pre-dispatch refusals | a tool's new `period` fields | T3, TQ1 | every row of § 7.2; a model window that differs → refused with the corrected spelling | **paid**: absolute windows asked of a look-back-only tool — wrong-window answers, armed vs unarmed |
| T6 | **The reader port and the English default** | `TimeReader`, `englishTimeReader`, the policy, the `time-reading` row, the served sentence, the lazy ask, `US_ZONE_ABBREVIATIONS` as data | `.time({ reader })` | T4, T5 | the host's field sentences as the table ("10/09/26 8 AM to 8:40 AM PST", "yesterday morning", a future date, PST in October); a strategy returning a zone-less or out-of-text candidate is refused | **paid**: provoking set — calls with the right window; needless-ask rate on controls |
| T7 | **Evidence lineage at grain** | `forms.ts` · `timeFormsOf`; the gate asks it; the private table from `fix/person-values-normalized` retires | `.time()` | T6 (and that branch landed or superseded) | "8 AM" vs `8:00`/`08:00`; a time no reading produced still fails | $0 over retained recordings: false "not traced" on time values |
| T8 | **Result checks** | `narrower-than-asked`, `wider-than-asked`, `period-beyond-retention`, `clocks-differ`, `clock-skew`; fold reasons; limits lines | the results layer + `.time()` | T5, T3 | a tool clamping 30d to 7d; two sources in UTC and UTC−7 | **paid**: false "not sure" rate on correct answers (Q33's cell R3 method) |
| T9 | **Consumers** | lens rows (lens repo); the host's panel rules § 10.3; the metrics mapping § 10.5; the vizfootprint adapter contract (owner's go) | each consumer's own | T2, T3, T8 | lens fixtures per row kind | $0 |
| T10 | **Host migration** | the host shrinks to `.time()` configuration plus, optionally, its reader strategy; `queryWindowFlow.ts`'s provider wrapper, `windowCapability.ts`'s probing and the zone tables go; the tools mint `period` and declare capabilities | host | T6, T8 | the host's gate, with dummy keys | Haiku re-run of the host's field cases, before vs after |
| T11 | **Correlation claims** (later) | "A before B" over claim rows | — | committed claim rows | — | later |

**Why this order.** T1 settles the grammar every other step leans on and is free. T2 is already
written and only needs rebasing. T3 gives the first visible win (the limits line in words) and is
the clock every later check needs. T4 before T6: the ask must exist before a reader can hand it
ambiguities. T5 needs the clock and the Q39 ruling. T7 needs recorded readings. T8 needs the
conversion rows. The host migrates last, one piece at a time, each piece deleting app code.

**The host after T10.** The host keeps: its zone and policy values in `.time()`, its reader (if it
wants its own), the tools' declarations in `host:py-tools/server.py` (a `period` on each result and
the `period` capabilities in its tool metadata), and the panel's rendering. It deletes: the clock
and policy code in `timeContext.ts`, the provider wrapper in `queryWindowFlow.ts`, the capability
probe, the future check, and its private time vocabulary in the metrics adapters.

---

## 14. Open questions for the owner

| # | Question | Recommended answer | Why |
|---|---|---|---|
| TQ1 | Split Q39's "never parses '2h'" into T-words and T-spellings (§ 5.4)? | **Yes.** It also reopens `narrower-than-asked` for T8. | The law protected the person's words; a tool author's `-40m` is a machine format, and converting it is what break 4 needs. |
| TQ2 | Supersede the honesty design's "an absolute compound window stays app code" (§ 1.4)? | **Yes**, with a pointer from that section to this page. | The owner's brief: a library for everyone. |
| TQ3 | Ship our own English reader, or wrap chrono-node? | **Our own, small, no dependency.** A chrono-node adapter can come later as an optional peer (`lib/lazyRequire.ts`) if a bench shows a gain. | chrono-node's default picks the first parse and reads PST as −08:00 in October; wrapping it means re-exposing every ambiguity anyway. |
| TQ4 | May a reader be async (an LLM-backed reader)? | **Yes**, with the same output shape and the same library checks; its readings are recorded with its id and never skip the policy. | The port must not care how words are read; the checks make any reader safe. |
| TQ5 | When the app passes no `now`? | **The turn's start, recorded `source: 'default'`.** | Admitted like any default; refusing would make every run option mandatory. |
| TQ6 | The model writes a window that differs from the person's: refuse, or replace? | **Refuse with the corrected spelling in v1.** | The library never overwrites a model-chosen argument; the correction costs one round trip. Revisit if the T6 bench shows the round trip hurts. |
| TQ7 | Who writes a refusal reason for a time answer (§ 6.2)? | **A `src/locales/` catalog sentence the app can override**, only for checks the app armed. | Refines 9.127.0's "the library never writes one"; the app still owns the words. |
| TQ8 | Does `wider-than-asked` make the answer "not sure"? | **Yes by default**, and the T8 bench's false-"not sure" rate decides. A result that declares `queried` equal to the asked range (it filtered its own rows) clears it. | A count over a wider read answers a different question. |
| TQ9 | The end of a person's range: end of grain, or exact? | **End of grain** by default, recorded; `exact` configurable. | People mean "through 8:40"; Elasticsearch's `lte` rounding does the same. |
| TQ10 | Make `.time({ zone })` required? | **Yes.** | The silent server zone is the most-cited failure in the research. |
| TQ11 | Add `s` to the look-back units? | **Yes**: one grammar with `s`; a declaration may narrow its units. | The host's tools accept `s`; the in-flight axis already has it; only `declare.ts` lacks it. |
| TQ12 | Where does it export from? | **The main barrel**; no new subpath. | A subpath adds API reference routes to the site budget; the reader is small. |
| TQ13 | Is the resolved window served to the model? | **Yes, one registered sentence, on tools that declare a period.** | Otherwise the model re-derives the window from words — the clock-tool anti-pattern. |
| TQ14 | vizfootprint: where does the adapter live? | **In the host or a bridge package; no vizfootprint change until the owner says its refactor is done.** | vizfootprint is read-only for this work. |
| TQ15 | Add `temporality` to the axis now? | **Later**, when a tool mints a cumulative series. | `aggregate` covers today's tools. |
| TQ16 | The names: `.time()`, `TimeReader`, `TimeClock`, `ResolvedWindow`, `wall-range`, `wider-than-asked` | **Keep the drafts** for T1–T3; rename freely before T5 ships. | Nothing is public until T3. |

# Time as one library layer

**Design and implementation plan, 2026-09-29, revised the same day after one review (§ 15).
Nothing in it is built. Every question in § 14 is open and carries a recommended answer; the owner
decides.**

| Page | What it holds |
|---|---|
| [README.md](README.md) | this page: the problem, the model, the clock, the reader, the ask, tool capabilities, results and datasets, the checks, the consumers, the configuration, the contract, the plan, the questions, the review record |
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
   records it, freezes it across a pause, and never resolves the person's words against the wall
   clock. It reads the wall clock at exactly one other point, when a call dispatches, and records
   that reading (`dispatchedAt`, § 7.4), because a tool evaluates a look-back against its own clock.
3. **The person's words are read by a strategy the app arms; the library resolves them.** A
   strategy is a tokenizer: it returns the zone-less **parts** it sees ("10/09/26", "8 AM", "PST"),
   never an instant and never a pick. One library module turns parts into candidate windows
   against the clock and the declared policy (date order, year, DST, zone abbreviations, edges),
   the same for every language. What the policy cannot settle becomes an ask.
4. **One range per mention, many argument shapes.** Each time mention the person makes resolves to
   one range; an ambiguous or future one becomes one typed ask. A tool declares how one range maps
   onto its arguments (one argument or two, ISO, epoch, date-only, a look-back); the library fills
   only when one mention applies, checks the model's value when it binds a call to a mention, and
   records every conversion that is not exact.
5. **The model's own window is recorded, not refused.** When the model sends a window that differs
   from the person's, the call runs as sent — the shipped `askOrAssume` law — and the row says so;
   claims about the person's window then read "not sure". Refusing is opt-in.
6. **Results and datasets use the same instants.** A result's period (step 7b) and a dataset's
   time axis (in flight) share one instant rule and one duration grammar. The side panel, the
   answer's limits block, the metrics dashboard and vizfootprint read the same declaration, so
   nothing guesses which column is time.
7. **Off means byte-identical.** Nothing changes unless the app arms `.time()` or a tool declares a
   capability. The one exception is step T1's grammar merge: two new refusals of malformed
   instants a tool is sent, named in § 12.1 beside three changes the design avoids.
8. **One ruling is needed first: Q39.** "The library never parses '2h'" becomes two laws: the
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
| The value/resolution split: a language module emits parts, one shared resolver turns them into instants | Duckling (per-language rules, shared `resolve`) | § 5.1 |
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
| `instant.ts` | the one instant parser, moved from `coverage/period.ts` · `instantOf` (exact, no `Date.parse`), with **two profiles** (§ 12.1): `lenient` — today's `instantOf` unchanged, for a period a result declares; `strict` — canonical upper-case `T`/`Z`, no leap second, day-checked, for a value the library sends to a tool. Plus `compareInstants`, `toUtc` |
| `duration.ts` | the one duration grammar `^[1-9][0-9]*[smhdw]$` with a **unit set per use** (look-back default `mhdw`, today's; axis interval `smhdw`), `durationMs`, `spellDuration` (the smallest exact spelling) — merging `declare.ts` · `LOOKBACK` and the in-flight `timeAxis.ts` · `INTERVAL` (§ 12.1) |
| `zone.ts` | IANA validation and offset arithmetic through `Intl` (no dependency); wall time → instant with Temporal's four DST words |
| `range.ts` | `TimeRange`, the per-boundary edge conversions of § 3.3, `covers`, `overlaps`, `roundOutward` |
| `clock.ts` | `TimeClock` (§ 4) |
| `axis.ts` | `DatasetTimeAxis` (§ 8), moved from the in-flight `artifacts/timeAxis.ts` |
| `reader.ts` | the `TimeReader` port and its result shape, `TimeParts` (§ 5.1) |
| `resolve.ts` | parts + clock + policy → candidate windows: date order, meridiem, year, parts-of-day table, abbreviation map, DST, end edge (§ 5.1). The one place zone arithmetic meets the person's words |
| `readers/english.ts` | the default strategy, a tokenizer (§ 5.3) |
| `wire.ts` | the JSON forms that cross a transport: `ToolPeriod` in `_meta.agentfootprint.period`, `ctx.time` in a call's `_meta.agentfootprint.time` (§ 7.1, § 7.5) |
| `forms.ts` | every spelling the library can derive from one resolved window (§ 9.5) |
| `present.ts` | rendering for a person, in a named zone and locale, through `Intl.DateTimeFormat` |

### 3.2 The types

```ts
/** ISO 8601 instant WITH an offset — `coverage/period.ts` · `instantOf`'s rule. */
type InstantText = string;
/** An IANA zone name, checked through Intl. Never an abbreviation. */
type ZoneName = string;
/** The one duration grammar: `^[1-9][0-9]*[smhdw]$`, units narrowed per use. A machine spelling, never a person's words. */
type DurationText = string;
type Grain = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/**
 * The library's INTERNAL range: half-open [from, to), from < to. It is NOT the same
 * reading as `DeclaredPeriod.queried`, whose bounds are inclusive; every boundary
 * converts through § 3.3.
 */
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
  readonly said: readonly TimePart[];   // 'year' | 'month' | 'day' | 'hour' | 'minute' | 'meridiem' | 'zone' — present in the parts of a 'rule' reader; empty for a 'model' reader (§ 5.5)
  readonly implied: readonly TimePart[]; // filled by resolve.ts: the clock, the policy, a correction
  readonly anchor: 'message' | 'previous-window' | 'none';
  readonly reader: { readonly id: string; readonly kind: 'rule' | 'model' } | 'answered';
  readonly notes: readonly TimeNote[];  // library-written, e.g. { kind: 'abbreviation-corrected', said: 'PST', zone: 'America/Los_Angeles', offset: '-07:00' }, { kind: 'dst-overlap', which: 'earlier' }, { kind: 'end-of-grain' }
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

### 3.3 Edges — one row per boundary

Inside the library a range is half-open `[from, to)`. When a person says an end at a grain ("to
8:40"), the default reading runs to the end of that grain — `[08:00, 08:41)` — and records
`{ kind: 'end-of-grain' }` (Elasticsearch's `lte` rounding). The alternative, `exact`, is
configuration (§ 11, TQ9). A tool's declared `granularity` rounds a range outward, never inward,
and records the rounding.

The places a range crosses do **not** share that edge. Each boundary converts, and each
conversion is a function in `range.ts`, never inline:

| Boundary | Its edge today | Into it from `[from, to)` | Back into `[from, to)` |
|---|---|---|---|
| a result's `DeclaredPeriod.queried` / `held` (`coverage/period.ts` · `periodVerdict`) | **inclusive at both ends** ("bounds are inclusive": `queried.to < held.from` is `not-held`, so `to == held.from` is `partly-held`) | not converted — the tool declares its own inclusive range | `[q.from, q.to + step)`, where `step` is the tool's `granularity`, else 1 ms. **`periodVerdict` stays inclusive and byte-identical**; a time-layer check (§ 9.2) compares after this conversion and records the `step` it used |
| a tool argument (§ 7.1) | whatever the tool declares: `to.edge: 'inclusive' \| 'exclusive'` per bound, default `'inclusive'` | exclusive: `to` as is; inclusive: the last instant inside the range at the argument's precision (`to − 1 s` for an ISO value with seconds, `to − 1 min` for a minute wall time, the previous day for a `date`) | inverse of the same rule |
| a look-back argument | `[dispatchedAt − L, dispatchedAt]` as the **tool's** clock evaluates it | § 7.2, with the drift of § 7.4 | the same, recorded |
| an ask answer (`format: 'time-range'`, § 6.1) | the wire value is an ISO 8601 interval `from/to`, half-open, the library's own form | identity | identity |
| a label shown to the person (`present.ts`) | the **said** end: "to 8:40" displays as "08:00–08:40" | under `end-of-grain`, render `to − 1 grain`; under `exact`, render `to` | never parsed back; a label is not data |
| vizfootprint `IntervalClause` (`viz:src/data/types.ts`) | **inclusive at both ends** (SQL `BETWEEN`); its "half-open" `IntervalBounds` means one side is `null` (unbounded), not an excluded end | `[from, last instant before to at the column's precision]` | a brushed `[lo, hi]` → `[lo, hi + 1 step)`; a `null` side stays unbounded, never becomes "now" |

The typed range keeps `08:41`; no person ever reads it.

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
- **One recorded wall-clock read, at dispatch.** The frozen clock resolves the person's words. A
  tool, though, evaluates a look-back against its own clock when it runs, which after a 30-minute
  `requestInput` pause is 30 minutes later than `now`. So each call row records `dispatchedAt` —
  the one wall-clock read the layer makes, recorded, never used to resolve words — and § 7.4 says
  what the drift does.

---

## 5. The person's words — a pluggable reader

### 5.1 The port

A strategy returns **parts, never instants** — Duckling's value/resolution split. Zone and DST
arithmetic, the abbreviation map, the parts-of-day table, edge rounding and the date-order rule are
the hard, universal half; written once in `resolve.ts`, they are never copied into a language
strategy.

```ts
interface TimeReader {
  /** Recorded on every reading, e.g. 'agentfootprint/english@1'. */
  readonly id: string;
  /** 'rule': deterministic over the text. 'model': an LLM or other learned reader (§ 5.5). */
  readonly kind: 'rule' | 'model';
  read(text: string, context: TimeReadContext): TimeReading | Promise<TimeReading>;
}

interface TimeReadContext {
  readonly locale: string;                 // a hint for the tokenizer; no clock, no zone, no map
}

interface TimeReading {
  readonly mentions: readonly TimeMention[];
}

interface TimeMention {
  readonly quote: string;                  // verbatim substring of the text — the library checks it
  readonly parses: readonly TimeParts[];   // usually one; more only when the TOKENS split two ways
  readonly problem?: 'unreadable';
}

/** Zone-less parts, in the order the text wrote them. Every field present was said. */
interface TimeParts {
  readonly date?:
    | { readonly kind: 'numeric'; readonly fields: readonly number[]; readonly yearDigits?: 2 | 4 } // '10/09/26' — order NOT decided
    | { readonly kind: 'fixed'; readonly year?: number; readonly month: number; readonly day: number }; // ISO or a named month: the text fixes the order
  readonly wall?: { readonly h: number; readonly m?: number; readonly s?: number; readonly meridiem?: 'am' | 'pm' };
  readonly zoneToken?: string;             // as written: 'PST', '-07:00', 'America/Los_Angeles' — resolve.ts maps it
  readonly relative?:
    | { readonly unit: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'; readonly offset: number } // 'yesterday' = { day, -1 }
    | { readonly unit: 'second' | 'minute' | 'hour' | 'day' | 'week'; readonly count: number };      // 'last 40 minutes' = { minute, 40 }
  readonly partOfDay?: string;             // 'morning' — a KEY into the policy's table, never hours
  readonly anchor?: 'previous';            // 'the hour before that' — resolved from the recorded previous window only
  readonly rangeOf?: readonly [TimeParts, TimeParts]; // '8 AM to 8:40 AM'
}

/** Produced by resolve.ts, never by a strategy. */
interface TimeCandidate extends ResolvedWindow {
  /** Which reading of the PARTS produced this candidate, so a POLICY can choose among them. */
  readonly reading: Readonly<{
    dateOrder?: 'MDY' | 'DMY' | 'YMD';
    meridiem?: 'am' | 'pm';
    year?: 'said' | 'current' | 'previous';
  }>;
}
```

The split is the design:
- **A strategy tokenizes.** It returns the parts it sees and the verbatim quote. It never
  resolves an instant, never applies a date order, never maps an abbreviation, never refuses a
  future date. A Spanish strategy is a tokenizer plus a word table; chrono-node's `isCertain` maps
  straight onto "which parts are present" if an adapter is ever wanted (TQ3).
- **`resolve.ts` resolves**, the same way for every strategy: parts + clock + policy → every
  candidate (three date orders for a numeric date, am and pm for a bare `8:40`, both instants of a
  DST overlap with a `dst-overlap` note), each checked with `core/time/` (instants with offsets,
  IANA zones, `from < to`).
- **The policy decides** (§ 11): date order, year, future, DST, abbreviation mismatch. What the
  policy cannot settle becomes one typed ask (§ 6).

This keeps configuration uniform: an app that swaps the English strategy for a Spanish one keeps
the same `dateOrder: 'ask'`, the same `future: 'refuse'`, the same record.

### 5.2 When it runs

Once per turn, at the seed, over the person's message only — never over tool results or model text
(the honesty law: library-authored and model-authored text never ground a value). The reading is a
run constant beside the clock, recorded as one `time-reading` row per mention. A resume and a
replay read that row; the reader never runs twice for one message, so a model-backed reader cannot
answer differently the second time. It is **used lazily**: nothing is asked until a tool that declares a
period is about to be called, so a turn that never reads time never asks (the needless-ask metric,
[../honesty/inputs.md](../honesty/inputs.md)).

### 5.3 The careful default

`readers/english.ts` ships in the library, with no dependency, `kind: 'rule'`. It tokenizes a
small, closed set and says "unreadable" for the rest, rather than guessing. The right-hand column
is what `resolve.ts` then makes of those parts, not the strategy:

| Reads | Example | Parts it returns | What `resolve.ts` makes of them |
|---|---|---|---|
| ISO dates and instants | `2026-10-09`, `2026-10-09T08:00-07:00` | `date: fixed`, `wall`, `zoneToken` | one candidate |
| numeric dates | `10/09/26` | `date: numeric [10, 9, 26]` | up to three (MDY, DMY, YMD), each tagged |
| clock times, with or without a meridiem | `8 AM`, `8:40`, `20:40` | `wall` | `8:40` alone → am and pm when no other part settles it |
| a range between two of the above | `8 AM to 8:40 AM`, `08:00–08:40` | `rangeOf` | one per combination of the sides' candidates |
| a zone | IANA (`America/Los_Angeles`), a numeric offset, an abbreviation | `zoneToken`, as written | IANA and offsets directly; an abbreviation **only through the policy's map**; one whose DST state disagrees with the date is corrected and noted, per policy |
| day words | today, yesterday, tomorrow, tonight, overnight | `relative: { day, offset }` | anchored on the clock, in the person's zone |
| parts of a day | morning, afternoon, evening | `partOfDay: 'morning'` | the policy's table (`morning` = `[06:00, 12:00)` by default), noted as `{ kind: 'part-of-day', table: 'default' }` |
| relative spans | last 40 minutes, past 2 hours, last week | `relative: { unit, count }` | a look-back (§ 3.2) or a calendar range for "last week" |

Words for the person's language live as data beside `src/locales/` (a catalog of words, no code),
so a second language is a table plus, at most, a strategy for its grammar.

### 5.4 The host's parser as the reference strategy, and the Q39 ruling

The host's `timeContext.ts` readers become a `TimeReader` in the host (`readClockRanges`,
`readFullRanges`, `numericReadings`), cut down to their tokenizing half, minus everything the
library now owns: the clock, zone and DST arithmetic, the abbreviation table (`zoneAbbreviation`
becomes data in the policy's map), the policy, the ask, the future check, the capability probe. It is the reference strategy
the default is tested against: the host's field cases become the default's test table.

**Q39** ([../honesty/decisions.md](../honesty/decisions.md)) kept `narrower-than-asked` out of v1
because it "would bend 'never parses 2h'". That law protected one thing: the library must not
read a person's phrase as if it were a machine format. This page splits it (TQ1):

| Law | Covers | Read by |
|---|---|---|
| **T-words.** The library never reads the person's words except through an armed `TimeReader`, and never picks among its readings except by a declared policy or an ask. | "last 2 hours", "10/09/26", "yesterday morning" | a strategy the app arms |
| **T-spellings.** The library reads and writes **author-declared machine spellings** through one grammar in `core/time/duration.ts`. | a tool's `-40m` argument, a declaration's `retention: '30d'`, a dataset's `interval: '5m'` | the library |

Under that split, the conversion of § 7.2 may turn a range into a look-back, and
`period-differs-from-asked` becomes possible (§ 9.2).

### 5.5 A model-backed reader is never the person's words

A reader declares `kind`. The library's checks on a reading — the quote is a substring, the parts
are well formed, the resolved instants are valid — check shape, not meaning: a model that reads
"yesterday" as the wrong day passes all of them. So:

- A `kind: 'model'` reading is never `said`. Its candidates carry `said: []`, and its window reaches
  a tool only after the person confirms it through the time ask (§ 6), where it becomes
  `answered`. Unconfirmed, a call may still run on it, filed as `derived-from-reading`, and claims
  about the window fold to "not sure" (§ 9.5).
- Resume and replay use the recorded reading (§ 5.2); the reader never runs again.
- A `kind: 'rule'` reader's parts are `said`, because the same text always yields the same parts
  and the table test (T6) pins which.

### 5.6 Several mentions, and turns with none

A message can hold several mentions ("compare this morning with yesterday morning"), and a turn can
need several windows. There is no "the" window of a turn:

- **Fill only when exactly one mention resolves.** Then the library fills a period the model left
  out (§ 7.3).
- **Otherwise the model binds a call to a mention** through the declared-source quote that already
  exists (`arguments/sources.ts` · `readSources`, `_findings.from`: `{ argument, source: 'user',
  quote }`). The library matches the quote to a recorded mention's quote and checks that the
  argument, converted back through § 3.3, equals that mention's resolved range. A match files the
  row as `said` (or `answered`); anything else is `model-chosen` (§ 7.3). Without declared
  sources, the library still compares the value with every mention's range and records which one
  it equals, if any.
- **A turn with no time words** inherits the previous turn's window only through a recorded row:
  under `policy.carry: 'record'` the library fills from the last recorded resolved window and writes
  a `time-carried { fromTurn }` row, which the limits line names ("window carried from the previous
  question"). Under `'off'` the tool's own `askOrAssume` rule applies. Never silently (TQ17).

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
  rendered by `core/time/present.ts` in the person's zone with the end they said ("Fri 9 Oct
  2026, 08:00–08:40 PDT"; the value behind it keeps `08:41`, § 3.3). Free entry stays open unless
  the app says `strict`.
- A choice drawn from a `kind: 'model'` reading is labelled as the library's reading ("I read
  'yesterday' as Mon 28 Sep — is that right?"), because the person is confirming it, not choosing
  among their own words (§ 5.5).
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
| a tool needs a period and the person said none | `policy.carry` first (§ 5.6); else the tool's own `askOrAssume` rule, unchanged; its choices may now be ranges |
| the only reading came from a `kind: 'model'` reader and a tool needs it | the reading as one choice to confirm (§ 5.5) |

One ask per batch, before anything dispatches — the inputs layer's rule
([../honesty/README.md](../honesty/README.md) § 3.2 (e)). An answer is recorded as `answered`; the
evidence gate counts it as the person's words (§ 9.5).

---

## 7. Tool time capabilities and conversion

### 7.1 The declaration

`ToolPeriod` (owned by `arguments/declare.ts`) grows additively. Today it is `{ argument,
spelling? }`, one argument in one of three single-argument spellings. Real tools spell a period in
many more shapes: two arguments (`start_time` / `end_time`), epoch milliseconds or seconds
(Grafana's default, [research.md](research.md)), a date only (`date: '2026-10-09'`), a nested
`{ from, to }` object. So the declaration maps **one `TimeRange` onto 1..n arguments**:

```ts
interface ToolPeriod {
  // ── today's single-argument form, unchanged, now SUGAR over `forms` ──
  readonly argument?: string;
  readonly spelling?: PeriodSpelling;               // 'lookback' | 'signed-lookback' | 'iso-range'
  readonly accepts?: readonly PeriodSpelling[];     // new: every single-argument spelling it takes
  readonly zoneArgument?: string;                   // new: with 'wall-range' only
  // ── the general form ──
  readonly forms?: readonly PeriodForm[];           // new: every shape the tool accepts, in preference order
  readonly wallZone?: 'app';                        // new: a 'wall'/'day' form with no zone argument reads in the app's .time() zone
  // ── facts about the source ──
  readonly retention?: DurationText;                // the oldest data the source keeps
  readonly maxRange?: DurationText;                 // the widest window the tool accepts
  readonly granularity?: DurationText;              // the source's smallest step
  readonly widen?: 'record' | 'refuse';             // range → look-back when the tool takes no range
}
type PeriodSpelling = 'lookback' | 'signed-lookback' | 'iso-range' | 'wall-range'; // 'wall-range' new

type BoundAs = 'iso' | 'epoch-ms' | 'epoch-s' | 'date' | 'wall';
interface Bound { readonly argument: string; readonly as: BoundAs; readonly edge?: 'inclusive' | 'exclusive' }

type PeriodForm =
  | { readonly kind: 'bounds'; readonly from: Bound; readonly to: Bound; readonly zone?: { readonly argument: string } }  // start_time / end_time
  | { readonly kind: 'joined'; readonly argument: string; readonly as: BoundAs; readonly joiner: '..' | '/'; readonly edge?: 'inclusive' | 'exclusive'; readonly zone?: { readonly argument: string } }
  | { readonly kind: 'object'; readonly argument: string; readonly keys: { readonly from: string; readonly to: string }; readonly as: BoundAs; readonly edge?: 'inclusive' | 'exclusive'; readonly zone?: { readonly argument: string } }
  | { readonly kind: 'day'; readonly argument: string; readonly zone?: { readonly argument: string } } // date only: one calendar day
  | { readonly kind: 'lookback'; readonly argument: string; readonly signed: boolean; readonly units?: string }; // units ⊆ 'smhdw', default 'mhdw'
```

The sugar, exactly:

| Sugar | Means |
|---|---|
| `{ argument: 'window', spelling: 'lookback' }` | `forms: [{ kind: 'lookback', argument: 'window', signed: false }]` |
| `spelling: 'signed-lookback'` | the same with `signed: true` |
| `spelling: 'iso-range'` | `{ kind: 'joined', argument, as: 'iso', joiner: '..', edge: 'inclusive' }` — today's `declare.ts` split on `..` |
| `'wall-range'` + `zoneArgument: 'timezone'` | `{ kind: 'joined', argument, as: 'wall', joiner: '..', edge: 'inclusive', zone: { argument: 'timezone' } }` |
| `accepts: [a, b]` | `forms: [sugar(a), sugar(b)]` |

Rules, checked at definition, at dispatch and at MCP ingest, refused and never repaired (the
`assertAskOrAssume` precedent):
- `argument`/`spelling`/`accepts` **or** `forms`, never both.
- Every argument a form names exists in the input schema and carries an `askOrAssume` rule (today's
  law, extended to each argument). `as: 'epoch-ms' | 'epoch-s'` requires a `number`/`integer`
  property; every other `as` a `string`.
- A `wall` bound or a `day` form without a `zone` argument is refused, unless the app's `.time()`
  zone is declared as the tool's zone by `period.wallZone: 'app'` (explicit, never implied).
- `units` is a subset of `smhdw`; absent, today's `mhdw` (§ 12.1).

**The wire form.** Host tools are often served over MCP from another language, so the declaration
must travel as JSON: `_meta.agentfootprint.period` carries the same object, field for field, read by
`lib/mcp/toolExtras.ts` · `readToolExtras` and judged against the listed tool's own `inputSchema`
like every other rule there. A two-argument Python tool declares:

```json
"_meta": { "agentfootprint": { "period": {
  "forms": [ { "kind": "bounds",
               "from": { "argument": "start_time", "as": "epoch-ms" },
               "to":   { "argument": "end_time",   "as": "epoch-ms", "edge": "exclusive" } } ],
  "retention": "30d" } } }
```

The capability is **declared**, never probed. The host's `windowCapability` reads a schema's
`pattern` by testing sample strings; that goes away.

### 7.2 The conversion

The library converts one resolved range (§ 5.6 says which) into the first form the tool accepts
that is exact, else the first that is not, at the inputs layer, before dispatch. The edges follow
§ 3.3; the clock is the turn's clock, and a look-back also meets the dispatch clock (§ 7.4).

| Asked | Tool form | Library sends | Exact? | Recorded |
|---|---|---|---|---|
| a look-back | `lookback` | the same, sign added or removed | yes, when the drift is within `granularity` (§ 7.4) | `converted` |
| a look-back | `bounds` / `joined` / `object`, any `as` | `[now − L, now)` in that `as`, edges per § 3.3 | yes | `converted` |
| a range | `bounds` / `joined` / `object`, `as: 'iso' \| 'epoch-ms' \| 'epoch-s'` | the range, edges per § 3.3 | yes (epoch-s rounds outward to whole seconds: `rounded`) | `converted` |
| a range | `as: 'wall'` + zone | wall times in the tool's zone; a DST gap is refused | yes | `converted` |
| a range inside one day | `day` | that day | **no — wider** unless the range is the whole day | `period-differs-from-asked { extra }` |
| a range across days | `day` only | nothing | — | refused before dispatch: one call per day is the model's choice, not the library's |
| a range ending at now (within `granularity`) | `lookback` | the smallest exact spelling that covers `from`, in the declared `units` | rounding only | `converted`, `rounded` |
| a range ending before now | `lookback`, `widen: 'record'` | the covering look-back from now | **no — wider** | `period-differs-from-asked { extra }`, with both ranges |
| a range ending before now | `lookback`, `widen: 'refuse'` | nothing | — | refused before dispatch |
| a range older than `retention` | any | nothing | — | refused before dispatch: `period-beyond-retention` |
| a range wider than `maxRange` | any | nothing | — | the ask, to narrow it; or refused |

The wider row is the honest version of the host's `coveringLookback`: the read covers more than
was asked, the record says so, and the answer's limits block says so in words (§ 10.2). Whether the
standing reads "not sure" is TQ8.

### 7.3 Who writes the argument

Two laws of the honesty design hold: the library acts only on declarations, and it never writes
over a value the model chose — `core/tools.ts` · `Tool.askOrAssume`: "A present value runs as
sent, filed as the model's own."

- The model **left the period out** and exactly one mention resolved (§ 5.6) → the library fills
  it from that window, converted to the tool's form, as the `assume` precedent fills a default. The
  row's source is `said` (a `rule` reader), `answered` (the ask), `carried` (§ 5.6) or
  `derived-from-reading` (an unconfirmed `model` reader, § 5.5).
- The model **gave a window equal to a mention's** in any accepted form, after the § 3.3
  conversion → the row cites that mention, with the same source.
- The model **gave a different window** → under the default `policy.mismatch: 'record'`, **the
  call runs as sent**. The row says `model-chosen, differs from the person's window` and carries
  both ranges; claims about the person's window fold to "not sure" through
  `period-differs-from-asked`. A drill-down ("now just 9–10"), a comparison ("vs yesterday
  morning") and a baseline call are normal agent work and pass untouched. Under the opt-in
  `mismatch: 'refuse'`, the call is refused before dispatch with a past-tense correction naming the
  form the person's window takes for this tool ("The person asked for 08:00–08:40 PDT on 9 Oct;
  for this tool that is `window: '2026-10-09T08:00..2026-10-09T08:40', timezone:
  'America/Los_Angeles'`.") (TQ6).

### 7.4 The clock at dispatch

The turn's clock is frozen at the message (§ 4); a look-back is evaluated by the **tool**, against
its own clock, at dispatch. After a pause the two differ. Each call row records `dispatchedAt`
(§ 4), and the library compares `drift = dispatchedAt − now`:

| Drift | Tool has an absolute form | Library sends | Recorded |
|---|---|---|---|
| ≤ `granularity` (1 minute when none is declared) | — | the look-back | `converted` |
| larger | yes | the asked range in the absolute form | `converted`, `drift` |
| larger | no | the look-back | `period-shifted { by }`; the result check reads `period-differs-from-asked { missing, extra }` |

### 7.5 What the tool receives

The tool also receives the asked range, so it can declare the `period.queried` its read covered
without parsing its own argument: `ctx.time = { asked: { from, to, edge: 'exclusive' }, zone,
now, dispatchedAt }`. In process it is a field on the execution context. It must also cross the
wire, because host tools run in another process: over MCP it travels in the `tools/call`
request's `_meta.agentfootprint.time`, the same JSON; a ToolProvider for another transport passes
the same object in its own metadata slot, and a transport with none sends nothing — the tool then
declares its period from its own arguments, today's path. The shape is versioned in `wire.ts`.

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
- **A naive column never joins — enforced on the values, not the declaration.** The in-flight rule
  does **not** refuse a naive axis: `artifacts/timeAxis.ts` · `timeAxisIssues` refuses only a `zone`
  on an epoch unit, and `DatasetTimeAxis.zone`'s own comment reads an `iso` axis with no `zone` as
  "the ISO strings carry their own offset (or are UTC)". A declaration never sees the rows, so it
  cannot refuse what it cannot see, and "(or are UTC)" is the silent default the research warns
  against. So: `normaliseInstants` reads each value; under an `iso` axis with no `zone`, a value
  without an offset is **not** taken as UTC — it is counted, and the axis reads
  `{ status: 'naive-values', count }`. The panel then draws the series labelled "clock unknown"
  (or nothing, under the app's choice), and no check compares or joins it with another source
  (§ 9.6). T2 changes the in-flight comment and rule before that branch lands.
- **Optional later:** `temporality: 'delta' | 'cumulative' | 'gauge'` (OpenTelemetry), so no chart
  sums a running total (TQ15).

---

## 9. The checks that fall out

Each check reads declarations and the clock stamp; none reads words.

| # | Check | Reads | Resolve | Row / reason |
|---|---|---|---|---|
| 9.1 | **Future window** | resolved range, clock | refuse, or ask with the past readings (§ 6.3); a range ending after now is read to now and noted | `time-future`; `partly-future` |
| 9.2 | **Differs from asked** — one check for narrower, wider and shifted | the asked range vs what was read: the conversion row (§ 7.2), the dispatch drift (§ 7.4), the result's `period.queried` converted per § 3.3 | flag | `period-differs-from-asked { missing, extra }`: `missing` = asked but not read (narrower, or the front of a shifted window), `extra` = read but not asked (wider, or its tail). `missing` non-empty → "not sure" (reopens Q39, TQ1); `extra` alone → TQ8 |
| 9.3 | **Model-chosen window** | the argument row (§ 7.3) | flag | `model-chosen, differs from the person's window` → claims about the person's window "not sure" |
| 9.4 | **Retention** | the tool's `retention`, the clock | refuse before dispatch; the result's `held` still decides after | `period-beyond-retention` |
| 9.5 | **Evidence lineage for the person's time values** | the resolved window, `core/time/forms.ts` | two lineages | `said` parts at grain (`8:00`, `08:40`, `10/09` when said) trace to the person; implied, corrected and policy parts (`2026` implied, `PDT` for a said `PST`, `-07:00`, `08:41`) trace as `derived-from-reading` → at most "not sure" |
| 9.6 | **Clocks differ across sources** | periods and axes in one answer | flag; every comparison is done on UTC instants | `clocks-differ { tools, zones }`; the limits block names each source's clock |
| 9.7 | **Clock skew** | a result's `readAt` vs the clock, with a declared tolerance | flag | `clock-skew { tool, by }` |
| 9.8 | **Correlation claims** (later) | claim rows ("A happened before B") | flag | waits for committed claim rows (the Q46 precedent) |

**9.5 in detail.** The in-flight gate fix keeps a table of clock spellings private to `evidence/`.
Here the gate asks one function, `forms.ts` · `timeFormsOf(window)`, which returns two lists from
a **recorded** reading:

- **`said`** — spellings of the parts the person said, at the grain they said them, from a
  `rule` reader or an ask answer. "8 AM" said at grain hour matches `8:00` and `08:00` because both
  are the same instant at that grain — equality, not a new fact (Duckling's grain). These count as
  the person's words.
- **`derived`** — everything the library itself produced: an implied year, a corrected abbreviation
  (`PDT` when the person said `PST`), offsets, the end-of-grain `08:41`, the presentation line,
  the served sentence (TQ13), and every part of a `model` reading. These get the lineage kind
  `derived-from-reading`, which the fold treats like `argument-assumed` (`assessment/types.ts`):
  it can support "not sure", never "known".

Library text is never evidence: without the second list, the model echoing the served sentence
(library text) back into its answer would pass the gate. A time value no reading produced still
fails. The gate is not loosened; it gains a lineage it can tell apart.

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
Period (client_activity): Fri 9 Oct 2026, 08:00–08:40 PDT (UTC−7) — read 05:20–08:40, wider than asked
Period (packet_records):  Fri 9 Oct 2026, 08:00–08:40 PDT (UTC−7) — covered
Clocks: client_activity reports in UTC; packet_records in America/Los_Angeles — compared as instants
```

Every end shown is the end as said (§ 3.3); the typed `answerCoverage` keeps `08:41` exclusive.

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
| `period.queried` (inclusive) | the series' x domain |
| a `TimeRange` `[from, to)` | an `IntervalClause` `[from, last instant before to]`, **inclusive at both ends** (SQL `BETWEEN`), converted per § 3.3; a brush `[lo, hi]` comes back as `[lo, hi + 1 step)`. vizfootprint's "half-open" `IntervalBounds` (one side `null`) is an unbounded side, not an excluded end, and is never used for a closed window |
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
| `windowTime.absoluteRange` | the tool's `forms` include a `bounds`, `joined` or `object` form |
| `windowTime.maxRangeHours` | `maxRange` |
| `temporalKind: 'time-series'` | a dataset axis with `aggregate: 'raw'` or an interval |
| `temporalKind: 'window-rollup'` | a period, no axis (one summary over the whole window) |
| `temporalKind: 'latest-sample'` | `readAt` only |
| `temporalKind: 'inventory-snapshot'` | no period, no axis |
| the history adapter's `bucket_seconds` from the range length | the derived interval (Grafana's rule), with the clamp recorded |
| the dashboard's time range | the same `TimeRange` the chat resolves — one range object across panel, chat and dashboard |

### 10.6 The lens

agentfootprint-lens reads none of this today (`lens:src` has no `period`, `readAt` or `timeAxis`).
It gains: the clock stamp and each call's `dispatchedAt`; each reading (quote → parts → candidates
→ how one was chosen: policy, ask, answer; the reader's `kind`); the conversion rows,
`period-differs-from-asked` and `model-chosen` first; the period verdicts; the dataset axis,
`naive-values` included. The
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
    forms: [{ kind: 'lookback', argument: 'window', signed: true, units: 'smhdw' }], // seconds opted into
    retention: '30d',
    granularity: '1m',
    widen: 'record',                   // an absolute window is read as a covering look-back, and recorded
  },
  execute: async (args, ctx) => { /* ctx.time.asked = { from, to, edge: 'exclusive' } as instants */ },
});

const packetRecords = defineTool({
  name: 'packet_records',
  // …
  period: {
    argument: 'window',
    accepts: ['signed-lookback', 'iso-range', 'wall-range'],   // sugar over `forms` (§ 7.1)
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
    reader: englishTimeReader(),               // a tokenizer; kind 'rule'
    policy: {
      partsOfDay: { morning: ['06:00', '12:00'] }, // applied by resolve.ts, for every reader
      dateOrder: 'ask',                        // '10/09/26' → the readings as choices
      year: 'ask',                             // a date said without a year
      future: 'refuse',                        // an analysis agent reads the past
      abbreviations: US_ZONE_ABBREVIATIONS,    // accepted only through this map, and recorded
      abbreviationMismatch: 'correct',         // 'PST' on 9 Oct → America/Los_Angeles, −07:00, noted
      dst: 'reject',                           // a wall time that does not exist or happens twice → ask
      endEdge: 'end-of-grain',                 // 'to 8:40' reads through 08:40:59
      mismatch: 'record',                      // the model's window differs → runs as sent, recorded, "not sure"
      carry: 'record',                         // a turn with no time words reuses the last window, recorded
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
| a reader's `kind: 'model'` | confirm through the ask | shape checks cannot verify meaning (§ 5.5) |
| `policy.endEdge` | `'end-of-grain'` | how people mean "to 8:40" |
| `policy.partsOfDay` | morning `[06:00, 12:00)`, afternoon `[12:00, 18:00)`, evening `[18:00, 24:00)` | data, applied once in `resolve.ts`; noted on every reading that used it |
| `policy.mismatch` | `'record'` | the shipped law: "a present value runs as sent, filed as the model's own" (`core/tools.ts` · `Tool.askOrAssume`); drill-downs and comparisons are normal work. `'refuse'` is opt-in |
| `policy.carry` | `'record'` (TQ17) | a follow-up question rarely repeats its window; the row and the limits line say it was carried |
| `checks.retention` | `'refuse'` when a tool declares `retention` | the read cannot hold it |
| `checks.clocks` | `'flag'` | break 6 |
| `checks.skew` | off | needs a tolerance the app chooses |
| run `time.now` | the turn's start, recorded `source: 'default'` | admitted like any default |

Per tool, `period.widen`, `retention`, `maxRange` and `granularity` override nothing global: they
are facts about the tool. A tool never sets policy.

---

## 12. Byte identity and the honesty contract

### 12.1 Off means byte-identical

- **Step T1 is a refactor with named behaviour changes, not a pure one.** Moving three grammars
  into `core/time/` must keep the 21 byte references in `test/core/tools/reference/` unchanged.
  Merging them could change five behaviours; two are taken and three are avoided by design. Each
  row is a changelog line (the taken ones) or a pinned test that it did not happen (the avoided
  ones):

  | # | Change | Why it happens | Ruling |
  |---|---|---|---|
  | a | An `iso-range` argument of `2026-02-30T08:00Z` (or any day past the month's end) is **newly refused**; `declare.ts` · `ISO_INSTANT` + `Date.parse` rolls it to 2 March | the strict profile is day-checked | **take it** — a tool was being sent an instant nobody asked for |
  | b | An `iso-range` argument with hour `24` (`2026-10-09T24:00Z`) is **newly refused**; `Date.parse` reads it as the next midnight (measured on Node for this page) | `instantOf` refuses `hour > 23` | **take it**, same reason |
  | c | Lower-case `t`/`z` and the leap second `:60` would be **newly accepted** if arguments used `instantOf` as it is — `coverage/period.ts` · `INSTANT` has `[Tt]`/`[Zz]` and allows second 60 — and a backend such as Python's `datetime.fromisoformat` may reject both after the library passed them | one parser, one profile | **avoided by two profiles** (§ 3.1): `lenient` (today's `instantOf`, for a period a result declares — byte-identical) and `strict` (upper-case `T`/`Z`, no `:60`, day-checked — for a value the library sends to a tool). Under `strict`, today's refusals of `t`, `z` and `:60` stand |
  | d | A digit cap: the in-flight `INTERVAL` is `[1-9][0-9]{0,5}`; `declare.ts` · `LOOKBACK` is `^[1-9][0-9]*[mhdw]$` with no cap, so a merged capped grammar would **newly refuse** `1000000m` | two grammars, two caps | **no cap in the merged regex**; a look-back keeps today's acceptance. The axis's cap (unshipped) goes with it |
  | e | Adding `s` to the look-back would **widen `lookback` for every existing declarer**, whose backend may not take seconds | one grammar, one unit set | **not done by default**: the unit set is per use, a look-back's default stays `mhdw`, and `s` is opted into through `units` (§ 7.1, TQ11) |

- Without `.time()` and without a new `ToolPeriod` field, no row, event, served byte or ask changes.
- A tool's new `ToolPeriod` fields serve bytes only inside that tool's own schema and results (the
  honesty design's clause 7).

### 12.2 The seven clauses

| Clause | The time layer |
|---|---|
| **Declare** | The app: `.time()` (zone, policy, reader and its `kind`, checks) and the run's clock. The tool: `period` capabilities (`forms`, with today's single-argument spellings as sugar), over MCP in `_meta.agentfootprint.period`; `period` and `timeAxis` on results and datasets. The person: only through the time ask. A strategy's reading is a reading, never evidence by itself. A malformed declaration is refused at definition, at dispatch and at MCP ingest, and never repaired. |
| **Verify** | Instants with offsets (the strict profile for anything sent); IANA zones; `from < to`; the quote is a substring of the message; a bound call's value equals its mention's range; the future, retention, `maxRange` checks against the clock; the conversion's exactness; the dispatch drift. All deterministic — and none of them verifies a `model` reader's meaning, which is why its readings are confirmed, not trusted. |
| **Record** | One `clock` stamp per turn; `dispatchedAt` on each call row; one `time-reading` row per mention (quote, parts, candidates, reader id and kind, how chosen), read back on resume and replay; `time-carried`; the argument row gains `window`, `converted`, the mention it is bound to, and `model-chosen` when it differs; period rows gain `period-differs-from-asked { missing, extra }` and `period-shifted`; `clocks-differ`, `clock-skew`; the axis's `naive-values`. Events carry names, enums and counts; values live in the rows. |
| **Resolve** | **Ask**: an ambiguity the policy cannot settle, a DST gap, an unknown zone, a `model` reading to confirm. **Assume**: a policy choice, recorded (`dateOrder: 'DMY'` says so on the row); a carried window. **Refuse**: all readings future, beyond retention, a `widen: 'refuse'` tool, a multi-day range to a `day`-only tool, and a mismatching model window **only** under the opt-in `mismatch: 'refuse'`. **Record and run**: a model-chosen window (the default). **Flag**: differs-from-asked, shifted, clocks, skew. |
| **Fold** | New reasons: `time-assumed` (a policy picked among readings), `period-differs-from-asked` (`missing` → "not sure"; `extra` alone → TQ8), `model-chosen` against the person's window, `period-beyond-retention`, `clocks-differ` (label only). New lineage kind `derived-from-reading`, folded like `argument-assumed`. Nothing here can support "known"; only `said` parts at grain and `answered` values count as the person's. |
| **Serve** | The model: one registered sentence naming the person's resolved window(s) in each tool's form, on the tools that declare a period — library text, so its spellings are `derived-from-reading`, never evidence; the refusal corrections. The tool: `ctx.time`, over MCP in the call's `_meta.agentfootprint.time`. The person: the time ask; the limits lines in the presentation zone. The lens: the rows. |
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
| T1 | **One owner** | `src/core/time/` `instant.ts` (two profiles), `duration.ts` (per-use units), `zone.ts`, `range.ts` (the § 3.3 edge conversions); `period.ts`, `declare.ts` import from it; the § 12.1 rows settled and pinned | none (refactor + the two named refusals) | TQ1, TQ11 | property: every instant the lenient profile accepted before is accepted after (`periodVerdict` byte-identical, inclusive); every `iso-range` argument accepted before is accepted after except rows a–b; `1000000m` still accepted; `30s` still refused for a default look-back; round-trip `durationMs` ↔ `spellDuration`; every § 3.3 boundary round-trips; DST table for 20 zones through `Intl` | $0 |
| T2 | **The declared time axis, on T1** | the in-flight `feat/dataset-time-axis` rebased: `core/time/axis.ts`, `normaliseInstants`, the `naive-values` status (§ 8) replacing "(or are UTC)"; `artifacts/` re-exports | a dataset declares `timeAxis` | T1 | epoch-s / epoch-ms / mixed offsets normalise to sorted UTC; offset-less values under a zone-less `iso` axis are counted, never read as UTC | $0; host panel hand count |
| T3 | **The clock and the presentation** | `.time({ zone, present })`, run option `time`, the `clock` stamp, `dispatchedAt` on call rows, the checkpoint arm, `present.ts` (the said end), `periodLine` in the presentation zone | `.time()` | T1 | the clock survives pause/resume unchanged; `dispatchedAt` after a resume is the resume's; `source: 'default'` recorded; limits line golden files per zone, "to 8:40" shown as 08:40 | $0 |
| T4 | **The time ask** | `InputField.format`, library re-validation, labelled choices, catalog reasons (TQ7), MCP `date-time` mapping | a `format` field or `.time()` | T3 | answers out of order, zone-less, future, DST gap → re-ask with `refused` and `repeat` | $0; host hand count |
| T5 | **Tool capabilities and conversion** | `ToolPeriod.forms` (bounds, joined, object, day, lookback with `units`) and the sugar (`accepts`, `wall-range`, `zoneArgument`); `retention`, `maxRange`, `granularity`, `widen`, `wallZone`; `_meta.agentfootprint.period` read by `readToolExtras`; conversion § 7.2; the dispatch drift § 7.4; `ctx.time` in process and in `_meta.agentfootprint.time`; `mismatch: 'record'` (default) and `'refuse'` (opt-in); pre-dispatch refusals | a tool's new `period` fields | T3, TQ1 | every row of § 7.2 and § 7.4; a two-argument epoch-ms Python tool over the mock MCP client; a model window that differs → runs, row `model-chosen`, fold "not sure"; under `'refuse'` → refused with the corrected form; a drill-down and a comparison call run untouched | **paid**: absolute windows asked of a look-back-only tool — wrong-window answers, armed vs unarmed |
| T6 | **The reader port, the resolver and the English default** | `TimeReader` (`kind`), `TimeParts`, `resolve.ts`, `englishTimeReader` (a tokenizer), the policy (`partsOfDay`, `carry`), the `time-reading` row read back on resume, mention binding through `_findings.from`, `time-carried`, the served sentence, the lazy ask, the `model`-reading confirmation, `US_ZONE_ABBREVIATIONS` as data | `.time({ reader })` | T4, T5 | the host's field sentences as the table ("10/09/26 8 AM to 8:40 AM PST", "yesterday morning", a future date, PST in October); "this morning vs yesterday morning" → two mentions, no fill, each call bound by quote; a strategy returning an out-of-text quote is refused; a `model` reader's window is asked before it is `said`, and a replay never calls the reader | **paid**: provoking set — calls with the right window; needless-ask rate on controls |
| T7 | **Evidence lineage at grain** | `forms.ts` · `timeFormsOf` with its `said` and `derived` lists; the lineage kind `derived-from-reading`; the gate asks it; the private table from `fix/person-values-normalized` retires | `.time()` | T6 (and that branch landed or superseded) | "8 AM" vs `8:00`/`08:00` → `said`; `PDT` for a said `PST`, an implied year, `-07:00`, `08:41`, the served sentence echoed → `derived-from-reading`, never "known"; a time no reading produced still fails | $0 over retained recordings: false "not traced" on time values |
| T8 | **Result checks** | `period-differs-from-asked { missing, extra }`, `period-shifted`, `period-beyond-retention`, `clocks-differ`, `clock-skew`; fold reasons; limits lines | the results layer + `.time()` | T5, T3 | a tool clamping 30d to 7d (`missing`); a covering look-back (`extra`); a look-back after a 30-minute pause (both); an inclusive `queried.to == asked.to − 1 step` reads as covered; two sources in UTC and UTC−7 | **paid**: false "not sure" rate on correct answers (Q33's cell R3 method) |
| T9 | **Consumers** | lens rows (lens repo); the host's panel rules § 10.3; the metrics mapping § 10.5; the vizfootprint adapter contract (owner's go) | each consumer's own | T2, T3, T8 | lens fixtures per row kind | $0 |
| T10 | **Host migration** | the host shrinks to `.time()` configuration plus, optionally, its reader strategy; `queryWindowFlow.ts`'s provider wrapper, `windowCapability.ts`'s probing and the zone tables go; the tools mint `period` and declare capabilities | host | T6, T8 | the host's gate, with dummy keys | Haiku re-run of the host's field cases, before vs after |
| T11 | **Correlation claims** (later) | "A before B" over claim rows | — | committed claim rows | — | later |

**Why this order.** T1 settles the grammar every other step leans on and is free. T2 is already
written and only needs rebasing. T3 gives the first visible win (the limits line in words) and is
the clock every later check needs. T4 before T6: the ask must exist before a reader can hand it
ambiguities. T5 needs the clock (and `dispatchedAt`) and the Q39 ruling. T7 needs recorded readings. T8 needs the
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
| TQ1 | Split Q39's "never parses '2h'" into T-words and T-spellings (§ 5.4)? | **Yes.** It also reopens a narrower read for T8, as `period-differs-from-asked`'s `missing`. | The law protected the person's words; a tool author's `-40m` is a machine format, and converting it is what break 4 needs. |
| TQ2 | Supersede the honesty design's "an absolute compound window stays app code" (§ 1.4)? | **Yes**, with a pointer from that section to this page. | The owner's brief: a library for everyone. |
| TQ3 | Ship our own English reader, or wrap chrono-node? | **Our own, small, no dependency.** A chrono-node adapter can come later as an optional peer (`lib/lazyRequire.ts`) if a bench shows a gain. | chrono-node's default picks the first parse and reads PST as −08:00 in October; wrapping it means re-exposing every ambiguity anyway. |
| TQ4 | May a reader be async (an LLM-backed reader)? | **Yes, as `kind: 'model'`**: same parts shape, same checks, recorded with its id — but its readings are never `said`: they are confirmed through the ask or fold to "not sure", and resume/replay use the recorded reading, never a re-run (§ 5.5). | The checks verify shape, not meaning: a model reading "yesterday" as the wrong day passes every one of them. |
| TQ5 | When the app passes no `now`? | **The turn's start, recorded `source: 'default'`.** | Admitted like any default; refusing would make every run option mandatory. |
| TQ6 | The model writes a window that differs from the person's: record, refuse, or replace? | **Record by default** (`mismatch: 'record'`): the call runs as sent, the row says `model-chosen, differs from the person's window`, claims about the person's window fold to "not sure". `'refuse'` with the corrected form is opt-in. Never replace. | The shipped law (`core/tools.ts` · `Tool.askOrAssume`: "a present value runs as sent, filed as the model's own"); refusing would also block drill-downs, comparisons and baselines. "Never overwrite" argues for recording, not refusing. |
| TQ7 | Who writes a refusal reason for a time answer (§ 6.2)? | **A `src/locales/` catalog sentence the app can override**, only for checks the app armed. | Refines 9.127.0's "the library never writes one"; the app still owns the words. |
| TQ8 | Does a read with `extra` and no `missing` (wider than asked) make the answer "not sure"? | **Yes by default**, and the T8 bench's false-"not sure" rate decides. A result that declares `queried` equal to the asked range (it filtered its own rows) clears it. | A count over a wider read answers a different question. |
| TQ9 | The end of a person's range: end of grain, or exact? | **End of grain** by default, recorded; `exact` configurable. | People mean "through 8:40"; Elasticsearch's `lte` rounding does the same. |
| TQ10 | Make `.time({ zone })` required? | **Yes.** | The silent server zone is the most-cited failure in the research. |
| TQ11 | Add `s` to the look-back units? | **Only by opt-in.** One grammar, units per use: a look-back's default stays today's `mhdw`; a tool that takes seconds declares `units: 'smhdw'` (§ 7.1); an axis interval takes `smhdw`. No digit cap. | Adding `s` to the default widens `lookback` for every existing declarer whose backend may not take seconds — a behaviour change without opt-in (§ 12.1 row e). |
| TQ12 | Where does it export from? | **The main barrel**; no new subpath. | A subpath adds API reference routes to the site budget; the reader is small. |
| TQ13 | Is the resolved window served to the model? | **Yes, one registered sentence, on tools that declare a period**, naming each mention's window; its spellings are `derived-from-reading`, never evidence (§ 9.5). | Otherwise the model re-derives the window from words — the clock-tool anti-pattern; the lineage stops its echo passing the gate. |
| TQ14 | vizfootprint: where does the adapter live? | **In the host or a bridge package; no vizfootprint change until the owner says its refactor is done.** | vizfootprint is read-only for this work. |
| TQ15 | Add `temporality` to the axis now? | **Later**, when a tool mints a cumulative series. | `aggregate` covers today's tools. |
| TQ17 | Does a turn with no time words reuse the previous window? | **Yes, only through a recorded row** (`policy.carry: 'record'` default, `time-carried { fromTurn }`, named in the limits line); `'off'` falls back to the tool's `askOrAssume` rule. | Follow-ups rarely repeat the window, and re-asking is a needless ask; a silent carry would be a hidden default. |
| TQ18 | A tool bound's edge when the tool does not declare one? | **`inclusive`**, and T5 requires the declaration on every new `bounds`/`object` form (only the sugar defaults). | Matches `periodVerdict`'s inclusive reading of what a tool covers and SQL `BETWEEN`; an exclusive backend given an inclusive bound loses at most one step, which § 9.2 would report as `missing`. |
| TQ19 | The drift threshold before a look-back is converted or recorded as shifted (§ 7.4)? | **The tool's `granularity`, else 1 minute.** | Below one step the tool cannot see the difference; a fixed minute keeps an undeclared tool honest after any real pause. |
| TQ20 | Several mentions and declared sources off: fill anything? | **No.** Record which mention each model value equals, if any. | Filling would be the library picking among the person's own windows. |
| TQ16 | The names: `.time()`, `TimeReader`, `TimeParts`, `TimeClock`, `ResolvedWindow`, `PeriodForm`, `wall-range`, `period-differs-from-asked`, `derived-from-reading` | **Keep the drafts** for T1–T3; rename freely before T5 ships. | Nothing is public until T3. |

---

## 15. Review record

One review, 2026-09-29, against af 9.127.0 (`c05834a1`), the host at `ef53e31`, the in-flight
`feat/dataset-time-axis` and read-only reads of vizfootprint. Verdict: right direction, not yet
universal or safe to build. Every finding received is applied; none is rejected.

| # | Finding | Applied in |
|---|---|---|
| M1 | The edge law contradicted `periodVerdict` (inclusive) and vizfootprint's `IntervalClause` (inclusive, SQL `BETWEEN`; its "half-open" is a `null` side); the display showed `08:41` for "to 8:40" | § 3.2 (`TimeRange` no longer claims to equal `queried`), § 3.3 (a table, one row per boundary; `periodVerdict` stays inclusive and byte-identical), § 6.1, § 10.2, § 10.4 |
| M2 | The strategy seam was one layer too low: every language strategy would redo zone, DST, abbreviation and edge arithmetic | § 5.1 (`TimeParts`; a strategy is a tokenizer), § 3.1 (`resolve.ts`), § 5.3, § 5.4, § 11 (`partsOfDay` moved to the policy); `abbreviations` removed from `TimeReadContext`, `dst` from `TimeCandidate.reading` (now a `dst-overlap` note) |
| M3 | `mismatch: 'refuse'` contradicted `Tool.askOrAssume`'s shipped law and blocked drill-downs and comparisons | § 7.3, § 9.3, § 11 (default `'record'`), § 12.2, TQ6 |
| M4 | One window per turn was assumed; binding a call to a mention was missing; carry-over unstated | § 5.6, § 7.3, TQ17, TQ20 |
| M5 | A frozen clock broke look-back exactness after a pause | § 4 (`dispatchedAt`), For the owner item 2, § 7.4, § 9.2 (one `period-differs-from-asked { missing, extra }` replaces narrower/wider), TQ19 |
| M6 | The tool vocabulary modelled only the host's two families; `ctx.time.asked` had no wire form | § 7.1 (`PeriodForm`: bounds, joined, object, day, lookback; today's spellings as sugar; `_meta.agentfootprint.period`), § 7.5 (`_meta.agentfootprint.time`), § 3.1 (`wire.ts`) |
| M7 | T1 was not byte-identical and its exceptions were incomplete | § 12.1 (rows a–e; one more found while applying this: `T24:00` accepted by `Date.parse` today), § 3.1 (two instant profiles, per-use units, no digit cap), TQ11 (`s` is opt-in) |
| M8 | Library-derived time spellings leaked into "the person's words" | § 9.5 (`said` vs `derived-from-reading`, folded like `argument-assumed`), § 12.2 Fold and Serve, TQ13 |
| M9 | An LLM-backed reader laundered a model claim | § 5.5 (`kind: 'rule' \| 'model'`; a model reading is confirmed or "not sure"; replay never re-runs a reader), § 5.2, § 6.1, TQ4 |
| M10 | § 8's naive-axis claim was wrong | § 8: the in-flight `timeAxisIssues` refuses only a zone on an epoch unit and reads a zone-less `iso` axis as "(or are UTC)"; the rule moves onto the values (`naive-values`), T2 |

**What the review text did not carry.** The review arrived cut off partway through M10 ("It says
an `iso` axis without offsets or zone 'is refused a…"), and no SHOULD-FIX section reached this
revision. M10 was therefore applied from the in-flight code, read directly, not from the review's
wording; any SHOULD-FIX items are not applied or rejected here and need the full text.


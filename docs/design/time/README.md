# Time as one library layer

**Design and implementation plan, 2026-09-29, revised twice the same day to apply one review in
full (§ 15). Nothing in it is built. Every question in § 14 is open and carries a recommended answer; the owner
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

> **Decided 2026-09-30.** The owner approved the design and every recommended answer in § 14 (TQ1–TQ26), and asked for it to be implemented in the order of § 13. Any answer can still be reopened.

1. **What is broken.** Time is read in several places today, by the library and by the app, and
   they disagree: one part accepts a date another refuses, a date in the future got through, a tool
   was sent a window it cannot read, and charts guess which column is the time.
2. **What changes.** All of it moves into one place in the library. The app says what "now" is and
   which time zone the person is in; the library reads the person's time words, asks when they can
   mean two things, turns the window into the form each tool needs, and writes down every step.
3. **What stays the same.** An app that does not switch this on sees no change, except that two
   impossible dates (30 February, hour 24) are no longer passed to a tool.
4. **Decision 1 — may the library read people's time words? (TQ1)** Recommended: **yes**, but only
   through a reader the app switches on, and when the words can mean two things it asks the person
   instead of picking.
5. **Decision 2 — how small is the first version? (TQ23)** Recommended: **small**. The app sets the
   time zone, the reader, and two rules (the order of day and month, and a missing year); every
   other behaviour is a fixed careful rule until a test shows it needs a switch.
6. **Decision 3 — the model uses a different window from the person's. (TQ6)** Recommended: **let
   the call run and record it**; the answer then says "not sure" about the person's window. Blocking
   the call stays optional, because comparing with yesterday or zooming in is normal work.
7. **Decision 4 — where does the time zone come from? (TQ10)** Recommended: **from each run**, so
   every person keeps their own zone, with an app-wide fallback; never the server's zone, and a run
   with neither is stopped.
8. **Decision 5 — dates in the future. (TQ24)** Recommended: **each tool says whether it can read
   the past, the future or both**; a log store says "past", so a future window is refused with a
   plain reason instead of quietly returning nothing.

---

## 1. The problem

### 1.1 In the owner's words

Time keeps breaking, piece by piece, in a real app, and the library is meant for every app, not
the one that found the breaks. The owner asked for **one** universal solution in the library, driven by configuration, with a
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
| `range.ts` | `TimeRange`, the per-boundary edge conversions of § 3.3, `covers`, `overlaps`, `roundOutward`, and the two range spellings, `parseRange` / `spellRange`: the ISO 8601 interval `from/to` (ask answers, § 6.1) and the joined `from..to` (a tool argument, § 7.1). No other file splits or joins a range |
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
  readonly reader: { readonly id: string; readonly kind: 'rule' | 'model' } | 'answered' | 'control'; // 'control': a typed window set in a UI (§ 4)
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
`{ kind: 'end-of-grain' }` (Elasticsearch's `lte` rounding). In v1 this is a fixed law, not a
switch; an `exact` reading waits for a bench that shows the need (§ 11, TQ9). A tool's declared `granularity` rounds a range outward, never inward,
and records the rounding.

The places a range crosses do **not** share that edge. Each boundary converts, and each
conversion is a function in `range.ts`, never inline:

| Boundary | Its edge today | Into it from `[from, to)` | Back into `[from, to)` |
|---|---|---|---|
| a result's `DeclaredPeriod.queried` / `held` (`coverage/period.ts` · `periodVerdict`) | **inclusive at both ends** ("bounds are inclusive": `queried.to < held.from` is `not-held`, so `to == held.from` is `partly-held`) | not converted — the tool declares its own inclusive range | `[q.from, q.to + step)`, where `step` is the tool's `granularity`, else 1 ms. **`periodVerdict` stays inclusive and byte-identical**; a time-layer check (§ 9.2) compares after this conversion and records the `step` it used |
| a tool argument (§ 7.1) | whatever the tool declares: `to.edge: 'inclusive' \| 'exclusive'` per bound, default `'inclusive'` | exclusive: `to` as is; inclusive: the last instant inside the range at the argument's precision (`to − 1 s` for an ISO value with seconds, `to − 1 min` for a minute wall time, the previous day for a `date`) | inverse of the same rule |
| a look-back argument | `[dispatchedAt − L, dispatchedAt]` as the **tool's** clock evaluates it | § 7.2, with the drift of § 7.4 | the same, recorded |
| an ask answer (`format: 'time-range'`, § 6.1) | the wire value is an ISO 8601 interval `from/to`, half-open, the library's own form (`range.ts` · `parseRange` / `spellRange`) | identity | identity |
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
  readonly now: InstantText;                    // the anchor for this turn
  readonly nowSource: 'app' | 'default';        // the app passed `now`, or the library took the turn's start
  readonly zone: ZoneName;                      // the person's zone for this run
  readonly zoneSource: 'run' | 'builder';       // the run's `time.zone`, else the `.time({ zone })` fallback
}
```

- **Declared per turn.** `agent.run({ message, time: { now, zone } })`. `now` should be the
  **message's** time (Rasa's rule), so a replay or a late resume reads "yesterday" the same way.
  When the app passes none, the library takes the turn's start once and records
  `nowSource: 'default'` — a default nobody chose, admitted like `askOrAssume`'s (TQ5).
- **The zone is per run, the builder's is a fallback.** A multi-user app serves people in many
  zones, so a zone fixed at build time would be the silent default in another form. The run's
  `time.zone` wins; `.time({ zone })` is an optional, declared fallback; with neither, `run()` is
  refused before the turn starts — never the server's zone (TQ10). `resolve.ts` uses the stamp's
  `zone` for every part the person left zone-less; a zone the person said (`zoneToken`) overrides it
  for that mention only.
- **Frozen across a pause.** The clock is a run constant written once at the turn's seed. A
  `requestInput` pause and its resume read the same clock; the host's
  `host:be-server/timeContext.ts` · `applicationClock` already does this by hand
  (`host:docs/TEMPORAL_INPUT_WORKFLOW.md`). When `resume()` is passed a different `time`, the frozen
  clock is kept — the paused turn's words were already resolved against it — and the passed value
  is recorded on the resume row as `clock-on-resume { passed, kept }`; it is not refused, because an
  app that passes the current time on every call is doing nothing wrong (TQ21).
- **Recorded once.** One `clock` stamp per turn on the ledger: `{ now, nowSource, zone, zoneSource }`.
  Every time row cites it. A reading is re-derivable only from its own row, not from the stamp and
  the message alone: the reader and the zone data can change between releases, so each
  `time-reading` row also records the reader's id **and** version and the tzdata version where the
  runtime names it (`process.versions.tz` on Node), else `'unknown'`.
- **A window set in a UI is a run input, not an answer.** `agent.run({ …, time: { window } })`
  takes a typed `TimeRange` — a brushed chart range, the dashboard's range picker — recorded with
  `source: 'control'`. It is the person's own typed value, so it counts like an answer (§ 9.5), but
  it was not given in reply to a library ask, so it is never filed as `answered`. For the fill rule
  of § 5.6 it counts as one more mention, with no quote (TQ26).
- **Two recorded wall-clock reads, never used on words.** The frozen clock resolves the person's
  words. The layer reads the wall clock at exactly two points, and records both: the turn's start
  when the app passes no `now` (`nowSource: 'default'`), and `dispatchedAt` on each call row,
  because a tool evaluates a look-back against its own clock when it runs, which after a 30-minute
  `requestInput` pause is 30 minutes later than `now`; § 7.4 says what that drift does.
- **Out of scope:** the operational clocks the library already has, which decide no time a person
  asked about: `memory/stages/filterByDecay.ts` · `now` (memory decay), `core/agent/window/strategy.ts`
  · `now` (the context window), and the artifact stores' `_now` (`artifacts/inMemoryArtifacts.ts`,
  `artifacts/gcsArtifacts.ts`).

---

## 5. The person's words — a pluggable reader

### 5.1 The port

A strategy returns **parts, never instants** — Duckling's value/resolution split. Zone and DST
arithmetic, the abbreviation map, the parts-of-day table, edge rounding and the date-order rule are
the hard, universal half; written once in `resolve.ts`, they are never copied into a language
strategy.

```ts
interface TimeReader {
  /** Recorded on every reading with the version, e.g. 'agentfootprint/english' + '1.0.0'. */
  readonly id: string;
  readonly version: string;
  /** The language it reads, e.g. 'en-US'; the default presentation locale (§ 11). */
  readonly locale: string;
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
- **The policy decides** (§ 11): in v1, date order and year; DST, the end edge and the rest are
  fixed laws until a bench shows they need a switch. What the policy cannot settle becomes one typed
  ask (§ 6). Whether a future (or past) reading can be read at all is not policy: it is a fact about
  the tool, its declared `direction` (§ 7.1), checked when a call is about to use the window.

This keeps configuration uniform: an app that swaps the English strategy for a Spanish one keeps
the same `dateOrder: 'ask'`, the same tool facts, the same record.

### 5.2 When it runs

Once per turn, at the seed, and only when the app armed a reader (`.time({ reader })`; there is no
default reader, so without one there are no `time-reading` rows and no word-driven asks, § 11). It
reads only the messages `lib/saidByPerson.ts` · `saidByPerson` accepts — the one gate for which
`role: 'user'` turn a person wrote, because the library itself writes seven kinds of `role: 'user'`
message nobody said. Never tool results or model text (the honesty law: library-authored and
model-authored text never ground a value). The reading is a
run constant beside the clock, recorded as one `time-reading` row per mention. A resume and a
replay read that row; the reader never runs twice for one message, so a model-backed reader cannot
answer differently the second time. It is **used lazily**: nothing is asked until a tool that declares a
period is about to be called, so a turn that never reads time never asks (the needless-ask metric,
[../honesty/inputs.md](../honesty/inputs.md)).

### 5.3 The careful default

`readers/english.ts` ships in the library, with no dependency, `kind: 'rule'`. It tokenizes a
small, closed set and says "unreadable" for the rest, rather than guessing. The right-hand column
is what `resolve.ts` then makes of those parts, not the strategy. v1 reads only the rows marked v1;
the others wait until a bench shows people need them:

| Reads | Example | Parts it returns | What `resolve.ts` makes of them | v1 |
|---|---|---|---|---|
| ISO dates and instants | `2026-10-09`, `2026-10-09T08:00-07:00` | `date: fixed`, `wall`, `zoneToken` | one candidate | v1 |
| numeric dates | `10/09/26` | `date: numeric [10, 9, 26]` | up to three (MDY, DMY, YMD), each tagged | v1 |
| clock times, with or without a meridiem | `8 AM`, `8:40`, `20:40` | `wall` | `8:40` alone → am and pm when no other part settles it | v1 |
| a range between two of the above | `8 AM to 8:40 AM`, `08:00–08:40` | `rangeOf` | one per combination of the sides' candidates | v1 |
| a zone | IANA (`America/Los_Angeles`), a numeric offset | `zoneToken`, as written | directly | v1 |
| a zone abbreviation | `PST` | `zoneToken: 'PST'` | v1 has no abbreviation map, so the zone is asked (`format: 'zone'`); later, **only through the policy's map**, and one whose DST state disagrees with the date is asked with both readings as choices (`abbreviationMismatch: 'ask'`, § 11) | tokenized; resolved by the ask |
| day words | today, yesterday, tomorrow | `relative: { day, offset }` | anchored on the clock, in the person's zone | v1 |
| relative spans | last 40 minutes, past 2 hours | `relative: { unit, count }` | a look-back (§ 3.2) | v1 |
| night words | tonight, overnight | `relative` + `partOfDay` | a span that crosses midnight | later |
| parts of a day | morning, afternoon, evening | `partOfDay: 'morning'` | the policy's table (`morning` = `[06:00, 12:00)`), noted as `{ kind: 'part-of-day', table: 'default' }` | later |
| calendar spans | last week | `relative: { week, offset: -1 }` | a calendar range, which needs a week-start rule | later |

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
  and the table test (T6b) pins which.

### 5.6 Several mentions, and turns with none

A message can hold several mentions ("compare this morning with yesterday morning"), and a turn can
need several windows. There is no "the" window of a turn:

- **Fill only when exactly one mention resolves.** Then the library fills a period the model left
  out (§ 7.3). A window set in a UI (`time.window`, § 4) counts as one mention with no quote.
- **Otherwise the model binds a call to a mention** through the declared-source quote that already
  exists (`arguments/sources.ts` · `readSources`, `_findings.from`: `{ argument, source: 'user',
  quote }`). The library matches the quote to a recorded mention's quote and checks that the
  argument, converted back through § 3.3, equals that mention's resolved range. A match files the
  row as `said` (or `answered`); anything else is `model-chosen` (§ 7.3). Without declared
  sources, the library still compares the value with every mention's range and records which one
  it equals, if any.
- **A turn with no time words** inherits the previous turn's window only through a recorded row:
  the library fills from the last recorded resolved window and writes a `time-carried { fromTurn }`
  row, which the limits line names ("window carried from the previous question"). In v1 this is a
  fixed law; a `carry: 'off'` switch, falling back to the tool's own `askOrAssume` rule, waits for a
  need (§ 11). Never silently (TQ17).

---

## 6. One time ask

Today's ask cannot hold a window: `core/inputRequest.ts` · `InputField.type` is `string | number
| boolean`, so every app re-checks shape, order, zone and future-ness itself.

### 6.1 The field

```ts
interface InputField {
  // …unchanged…
  /** New. A time field: the library validates the answer before the app sees it.
   *  Refused at definition unless `type: 'string'`. */
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

An answer goes through the same checks as a reading: instants with offsets, `from < to`, and the
chosen tool's facts — its `direction`, its `retention` (refused only when the whole range is older)
and its `maxRange` (§ 7.1). The tool facts join this re-validation in step T5a, when they land; T4
checks shape, order and zone. A failing answer is re-asked with the 9.127.0
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
| every reading outside the tool's `direction` (a future window for a `past` tool) | nothing is asked; the call is refused with the reason ("that window has not happened yet") |
| some readings inside the tool's `direction`, some outside | the ones inside as choices |
| a wall time in a DST gap or overlap (a fixed v1 law: Temporal's `reject`) | the two instants as choices (Temporal's `earlier` and `later`) |
| a zone abbreviation (v1 has no map), or one not in the map | the zone, `format: 'zone'` |
| an abbreviation in the map whose DST state disagrees with the date (`PST` on 9 Oct) | both readings as choices — literal `−08:00`, or the zone's `−07:00` (`abbreviationMismatch: 'ask'`) |
| a tool needs a period and the person said none | the carried window first (§ 5.6); else the tool's own `askOrAssume` rule, unchanged; its choices may now be ranges |
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
  // ── facts about the source — never policy ──
  readonly direction?: 'past' | 'future' | 'any';   // which side of now the source can hold; absent: not checked
  readonly retention?: DurationText;                // the oldest data the source keeps
  readonly maxRange?: DurationText;                 // the widest window the tool accepts
  readonly granularity?: DurationText;              // the source's smallest step
  readonly filtersToAsked?: boolean;                // the tool reads `ctx.time.asked` and drops rows outside it
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
| a range ending before now | `lookback` | the covering look-back from now (the v1 law; an app `widen: 'refuse'` waits for a need, § 11) | **no — wider** | `period-differs-from-asked { extra }`, with both ranges; with `filtersToAsked: true`, `converted, trimmed by the tool` — the result's declared `queried` still decides (TQ8) |
| a range outside the tool's `direction` | any | nothing | — | refused before dispatch: `time-future` (or `time-past`) |
| a range **wholly** older than `retention` | any | nothing | — | refused before dispatch: `period-beyond-retention` |
| a range **partly** older than `retention` | any | the range, as asked | yes | `converted`, `partly-beyond-retention`; the result's `held` decides `partly-held` |
| a range wider than `maxRange` | any | nothing | — | refused before dispatch, the reason naming `maxRange`; splitting it into several calls is the model's choice, as for a `day`-only tool (TQ22) |

The wider row is the honest version of the host's `coveringLookback`: the read covers more than
was asked, the record says so, and the answer's limits block says so in words (§ 10.2). Whether the
standing reads "not sure" is TQ8. Whether to widen at all is the app's choice, not the tool's: a
tool declares only facts — here, whether it trims its rows to the asked range.

### 7.3 Who writes the argument

Two laws of the honesty design hold: the library acts only on declarations, and it never writes
over a value the model chose — `core/tools.ts` · `Tool.askOrAssume`: "A present value runs as
sent, filed as the model's own."

- The model **left the period out** and exactly one mention resolved (§ 5.6) → the library fills
  it from that window, converted to the tool's form, as the `assume` precedent fills a default. The
  row's source is `said` (a `rule` reader), `answered` (the ask), `control` (a window set in a UI,
  § 4), `carried` (§ 5.6) or `derived-from-reading` (an unconfirmed `model` reader, § 5.5).
- The model **gave a window equal to a mention's** in any accepted form, after the § 3.3
  conversion → the row cites that mention, with the same source.
- The model **gave a different window** → under the v1 law (record), **the call runs as sent**. The row says `model-chosen, differs from the person's window` and carries
  both ranges; claims about the person's window fold to "not sure" through
  `period-differs-from-asked`. A drill-down ("now just 9–10"), a comparison ("vs yesterday
  morning") and a baseline call are normal agent work and pass untouched. Under a later opt-in,
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
| `DatasetTimeAxis { column, unit, zone?, interval?, aggregate? }` | which **column** is time, in what clock, at what grain? | `core/time/axis.ts` (moved from `artifacts/timeAxis.ts`, T2) | shipped; `normaliseInstants` with T2 |

- **One grammar.** `interval` uses `core/time/duration.ts`; `zone` uses `core/time/zone.ts`. The
  in-flight branch's private `INTERVAL` regex goes away.
- **They travel together.** A dataset minted from a call carries both: `ArtifactMeta.timeAxis` (in
  flight) and the call's period. For a dataset minted from **exactly one** call, a chart's time
  domain is that call's `period.queried` — what was asked — not the rows' min and max, so a stretch
  the store does not hold shows as a gap instead of a squeezed axis. A derived or multi-call dataset
  has no one asked period: its domain is the rows' extent, labelled "range of the rows".
- **The axis is normalised before anyone compares.** `core/time/axis.ts` · `normaliseInstants`
  turns a dataset's time column into UTC `Z` instants at one precision (epoch seconds and
  milliseconds included), so a lexicographic compare downstream is chronological. This is the
  guarantee vizfootprint's date law assumes and nothing supplies today (§ 10.4). It is a
  **read-side view**: the stored rows and their bytes are unchanged, and every reader that compares
  asks for the view.
- **A naive value is never read as UTC — checked on the values, in T2.** The in-flight declaration
  check cannot catch it: `artifacts/timeAxis.ts` · `timeAxisIssues` judges the declaration's shape
  (keys, a valid IANA zone, no zone on an epoch unit) and never looks at a value, and
  `DatasetTimeAxis.zone`'s own comment reads an `iso` axis with no `zone` as "the ISO strings carry
  their own offset (or are UTC)" — the silent-UTC default the research warns against. So T2 adds a
  value check to `normaliseInstants`: under an `iso` axis with no declared `zone`, a value without an
  offset is **flagged** — counted, and the axis reads `{ status: 'naive-values', count }` — or, under
  the app's choice, **refused**; it is never read as UTC. The panel draws a flagged series labelled
  "clock unknown", and no check compares or joins it with another source (§ 9.6). T2 changes the
  in-flight comment and rule before that branch lands.
- **Wall-clock values need a fall-back rule.** Under a declared `zone`, values are wall times, and
  in the hour the clocks go back one wall time names two instants (two `01:30` rows). Read in the
  rows' order, the values before the wall clock steps back inside the overlap take the earlier
  offset and those after it the later, noted `{ kind: 'dst-overlap', resolvedBy: 'row-order' }`.
  When the order cannot tell (a single `01:30`, or rows not in time order), the value is counted as
  `dst-ambiguous` and handled like a naive value, never picked silently. A wall time inside the
  spring-forward gap names no instant and is counted as `dst-gap`.
- **Optional later:** `temporality: 'delta' | 'cumulative' | 'gauge'` (OpenTelemetry), so no chart
  sums a running total (TQ15).

---

## 9. The checks that fall out

Each check reads declarations and the clock stamp; none reads words.

| # | Check | Reads | Resolve | Row / reason |
|---|---|---|---|---|
| 9.1 | **Outside the tool's direction** | resolved range, clock, the tool's declared `direction` | refuse, or ask with the readings inside it (§ 6.3); for a `past` tool, a range ending after now is read to now and noted. A tool with no `direction` is not checked | `time-future` / `time-past`; `partly-future` |
| 9.2 | **Differs from asked** — one check for narrower, wider and shifted | the asked range vs what was read: the conversion row (§ 7.2), the dispatch drift (§ 7.4), the result's `period.queried` converted per § 3.3 | flag | `period-differs-from-asked { missing, extra }`: `missing` = asked but not read (narrower, or the front of a shifted window), `extra` = read but not asked (wider, or its tail). `missing` non-empty → "not sure" (reopens Q39, TQ1); `extra` alone → TQ8 |
| 9.3 | **Model-chosen window** | the argument row (§ 7.3) | flag | `model-chosen, differs from the person's window` → claims about the person's window "not sure" |
| 9.4 | **Retention** | the tool's `retention`, the clock | refuse before dispatch only when the whole range is older; a partial overlap dispatches, and the result's `held` decides `partly-held` | `period-beyond-retention`; `partly-beyond-retention` |
| 9.5 | **Evidence lineage for the person's time values** | the resolved window, `core/time/forms.ts` | two lineages | `said` parts at grain (`8:00`, `08:40`, `10/09` when said) trace to the person; implied, corrected and policy parts (`2026` implied, `PDT` for a said `PST`, `-07:00`, `08:41`) trace as `derived-from-reading` → at most "not sure" |
| 9.6 | **Clocks differ across sources** | the declared `DatasetTimeAxis.zone` of wall-clock sources in one answer — not period offsets, where `Z` and `-07:00` are two correct spellings of one instant | a label only; every comparison is done on UTC instants | `clocks-differ { tools, zones }`; the limits block names each wall-clock source's zone |

Two checks from the first draft are gone. **Clock skew** compared a result's `readAt` with the
frozen message-time `now`, so it measured latency or the length of a pause, not a skew; it is cut.
**Correlation claims** ("A happened before B") wait for committed claim rows (the Q46 precedent)
and are not in the plan.

**9.5 in detail.** The in-flight gate fix keeps a table of clock spellings private to `evidence/`.
Here the gate asks one function, `forms.ts` · `timeFormsOf(window)`, which returns two lists from
a **recorded** reading:

- **`said`** — spellings of the parts the person said, at the grain they said them, from a
  `rule` reader, an ask answer or a `control` window (§ 4). "8 AM" said at grain hour matches `8:00` and `08:00` because both
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
Clocks: packet_records' rows are wall times in America/Los_Angeles (declared) — compared as instants
```

Every end shown is the end as said (§ 3.3); the typed `answerCoverage` keeps `08:41` exclusive.

Not armed: byte-identical to today. A report built from the record (the `/observe` answer account)
uses the same renderer.

### 10.3 The host's side panel

| Rule | Replaces |
|---|---|
| A dataset with a declared axis is **always** drawn as a time series; a malformed declaration draws nothing and says why | `autoSpec.ts` · `TIMESTAMP_FIELD` / `DATE_SHAPED` guesses (kept only as a fallback that labels itself "time column guessed") |
| For a dataset from exactly one call, the x domain is that call's `period.queried` and unheld stretches are gaps; for a derived or multi-call dataset, the rows' extent, labelled so (§ 8) | min/max of the rows, unlabelled |
| Panels from one turn share one time axis, keyed by the turn's resolved window | one axis per chart |
| Brush bounds render in the presentation zone | `chartSelection.ts` · `formatBound` (UTC only) |
| **Time range as a control**: a brushed range is sent with the next turn as the run input `time.window` (§ 4), recorded with `source: 'control'` — not `answered`, because nothing asked for it — and never as words the reader must re-parse. The metrics dashboard's range picker and the chat use the same input: one piece serves panel, dashboard and chat | re-typing the window in the chat |

The in-flight host branch (`feat/declared-time-axis`) already honours `readTimeAxis(meta)`; the
remaining rows are host work after steps T2 and T3.

### 10.4 vizfootprint — the contract only

No vizfootprint code change is proposed here; the owner decides when, after its refactor. The
contract is what vizfootprint would read, and it maps onto shapes vizfootprint already has:

| Library declaration | vizfootprint shape it would fill |
|---|---|
| `DatasetTimeAxis.column` | a declared `ColumnType 'date'` (`viz:src/data/types.ts`; `viz:src/def/builtinAnalyses.ts` · `DECLARABLE_TYPES`) |
| `interval` + `aggregate` | today only a caption: vizfootprint's `SeriesGrain { bucket, reducer }` (`viz:src/def/types.ts`) is "never parsed (R12)". Whether vizfootprint ever computes on a declared grain is **a future vizfootprint decision**, not part of this contract |
| the bucketing zone | a gap to name: `viz:src/data/bins.ts` puts day edges at UTC midnight, which is wrong for a person's day in UTC−7. A calendar bucket needs a named zone (Elasticsearch's `calendar_interval` + `time_zone`); the contract carries the presentation zone for it, and using it is the same future vizfootprint decision |
| `normaliseInstants` output (UTC `Z`, one precision) | the precondition of `SeriesPoint.t`'s lexicographic order and `IntervalClause`'s string bounds |
| `period.queried` (inclusive), for a dataset from exactly one call | the series' x domain; otherwise the rows' extent, labelled (§ 8) |
| a `TimeRange` `[from, to)` | an `IntervalClause` `[from, last instant before to]`, **inclusive at both ends** (SQL `BETWEEN`), converted per § 3.3; a brush `[lo, hi]` comes back as `[lo, hi + 1 step)`. vizfootprint's "half-open" `IntervalBounds` (one side `null`) is an unbounded side, not an excluded end, and is never used for a closed window |
| the presentation zone | the caller's `formatDate` |

The adapter from one to the other would live in the host or a bridge package, not in vizfootprint.

### 10.5 The metrics dashboard

The host's metrics dashboard has the richest declared time model in the codebase, in a private
vocabulary (`host:be-server/metrics/server/source-adapters.mjs` · `windowTime`, `table(…,
temporalKind)`). Its capability fields — absolute range, maximum range, readable direction — map onto the tool's
declared `period`, so the dashboard reads those from the tool instead of keeping its own table; its
presets stay its own:

| Dashboard field | Library source |
|---|---|
| `windowTime.windows` (`1h`, `6h`, `24h`) | **stays app configuration**: these are the dashboard's presets, not asks — a tool's `askOrAssume` choices exist only on an `ask` rule, so a tool with `assume` would have none |
| `windowTime.absoluteRange` | the tool's `forms` include a `bounds`, `joined` or `object` form |
| `windowTime.maxRangeHours` | `maxRange`; the default `windowTime` sets none, so absent means no cap on either side |
| (none today) — which side of now the source can show | `direction` |
| `temporalKind: 'time-series'` | a dataset axis with `aggregate: 'raw'` or an interval |
| `temporalKind: 'window-rollup'` | a period, no axis (one summary over the whole window) |
| `temporalKind: 'latest-sample'` | `readAt` only |
| `temporalKind: 'inventory-snapshot'` | no period, no axis |
| the history adapter's `bucket_seconds` from the range length | the derived interval (Grafana's rule), with the clamp recorded |
| the dashboard's time range | the run input `time.window` (§ 4), the same `TimeRange` the chat resolves — one range object across panel, chat and dashboard |

### 10.6 The lens

agentfootprint-lens reads none of this today (`lens:src` has no `period`, `readAt` or `timeAxis`).
It gains: the clock stamp and each call's `dispatchedAt`; each reading (quote → parts → candidates
→ how one was chosen: policy, ask, answer; the reader's `kind`); the conversion rows,
`period-differs-from-asked` and `model-chosen` first; the period verdicts; the dataset axis,
`naive-values` included. The
lens learns each row before any tool mints it ([../honesty/results.md](../honesty/results.md) § 3.6).

---

## 11. The configuration

One builder option, one run option, and the tool's declaration. v1 keeps the switches to the few
that have two careful answers (TQ23); every other behaviour is a fixed law until a bench shows it
needs a switch.

```ts
import { Agent, defineTool, englishTimeReader } from 'agentfootprint';

const clientActivity = defineTool({
  name: 'client_activity',
  description: 'Client operations on the storage cluster over a look-back.',
  inputSchema: {
    type: 'object',
    required: ['window'],
    properties: { window: { type: 'string', pattern: '^-?[0-9]+[smhdw]$' } },
  },
  askOrAssume: { window: { assume: '-1h' } },
  period: {                            // facts about the tool, never policy
    forms: [{ kind: 'lookback', argument: 'window', signed: true, units: 'smhdw' }], // seconds opted into
    direction: 'past',                 // a log store holds no tomorrow
    retention: '30d',
    granularity: '1m',
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
    direction: 'past',
    maxRange: '24h',
  },
  // …
});

const agent = Agent.create({ provider, model })
  .tool(clientActivity)
  .tool(packetRecords)
  .time({
    zone: 'America/Los_Angeles',   // optional fallback; each run's own zone wins (§ 4)
    reader: englishTimeReader(),   // no default: without a reader, the person's words are not read
    policy: {
      dateOrder: 'ask',            // '10/09/26' → the readings as choices
      year: 'ask',                 // a date said without a year
    },
  })
  .limitsTravelWithTheAnswer()
  .build();

await agent.run({
  message: 'Show client activity 10/09/26 8 AM to 8:40 AM PST',
  time: { now: message.sentAt, zone: session.zone },  // the message's time and the person's zone
});
```

**v1 switches:**

| Option | Default | Why that default |
|---|---|---|
| run `time.zone` / `.time({ zone })` | the run's zone, else the builder's fallback; with neither, `run()` is refused | a zone per person; a silent server zone is the most-cited failure in the research (TQ10) |
| run `time.now` | the turn's start, recorded `nowSource: 'default'` | admitted like any default (TQ5) |
| run `time.window` | none | a window set in a UI, recorded as `control` (§ 4, TQ26) |
| `reader` | **none** | reading the person's words is armed separately; no reader means no `time-reading` rows and no word-driven asks (T-words, § 5.4) |
| `policy.dateOrder` | `'ask'` | no silent MDY (dateparser's documented trap) |
| `policy.year` | `'ask'` | a year the person did not say is a guess, and near New Year the current and previous years are both plausible (dateparser's `PREFER_DATES_FROM` exists for exactly this) |
| tool `period` facts | absent: nothing checked | `direction`, `retention`, `maxRange`, `granularity`, `filtersToAsked` are facts about the tool (§ 7.1); a tool never sets policy |

**Fixed laws in v1**, each a switch later only if a bench shows the need:

| Behaviour | v1 law | A later switch would add |
|---|---|---|
| presentation | the zone the person meant, else the run's; the reader's `locale`, or a locale-neutral ISO form with the zone named when no reader is armed | `present: { zone, locale }` |
| the end of "to 8:40" | end of grain, recorded (§ 3.3, TQ9) | `endEdge: 'exact'` |
| a wall time in a DST gap or overlap | ask, with both instants (Temporal's `reject`) | `dst` |
| a zone abbreviation | asked as a zone (`format: 'zone'`); no map ships | `abbreviations` (a map, e.g. US zones, as data), with `abbreviationMismatch: 'ask'` as its default — a literal `PST` is −08:00, so correcting it to −07:00 is a guess, and the host itself refuses a mismatch (`host:be-server/timeContext.ts` · `zoneMismatch`) |
| parts of a day, night words, calendar spans | not read (§ 5.3) | `partsOfDay` (a table applied in `resolve.ts`) |
| the model's window differs from the person's | record and run (§ 7.3, TQ6) | `mismatch: 'refuse'` |
| a turn with no time words | carry the last window through a recorded row (§ 5.6, TQ17) | `carry: 'off'` |
| a range to a look-back-only tool | the covering look-back, recorded as wider (§ 7.2, TQ8) | app policy `widen: 'refuse'` |
| a retention check | from the tool's `retention` alone | nothing: a second `checks.retention` would duplicate the tool's fact |
| clocks across sources | a label, for declared wall-clock zones only (§ 9.6) | nothing |
| a reader of `kind: 'model'` | confirmed through the ask, else "not sure" (§ 5.5) | nothing |

---

## 12. Byte identity and the honesty contract

### 12.1 Off means byte-identical

- **Step T1 is a refactor with named behaviour changes, not a pure one.** Moving three grammars
  into `core/time/` must keep every byte reference in `test/core/tools/reference/` unchanged.
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
  One refusal is new off the arm (T3): `time` passed to an agent without `.time()` is refused by
  name, because a door that ignored it would look configured and do nothing.
- A tool's new `ToolPeriod` fields serve bytes only inside that tool's own schema and results (the
  honesty design's clause 7).

### 12.2 The seven clauses

| Clause | The time layer |
|---|---|
| **Declare** | The app: `.time()` (a fallback zone, the reader and its `kind`, the v1 policy) and the run's clock, zone and optional `window`. The tool: `period` capabilities (`forms`, with today's single-argument spellings as sugar) and facts (`direction`, `retention`, `maxRange`, `granularity`, `filtersToAsked`), over MCP in `_meta.agentfootprint.period`; `period` and `timeAxis` on results and datasets. The person: through the time ask, or a window set in a UI (`control`). A strategy's reading is a reading, never evidence by itself. A malformed declaration is refused at definition, at dispatch and at MCP ingest, and never repaired. |
| **Verify** | Instants with offsets (the strict profile for anything sent); IANA zones; `from < to`; the quote is a substring of the message; a bound call's value equals its mention's range; the tool's `direction`, `retention` and `maxRange` against the clock; the conversion's exactness; the dispatch drift. All deterministic — and none of them verifies a `model` reader's meaning, which is why its readings are confirmed, not trusted. |
| **Record** | One `clock` stamp per turn (`nowSource`, `zoneSource`); `clock-on-resume` when a resume passes a different `time`; `dispatchedAt` on each call row; one `time-reading` row per mention (quote, parts, candidates, reader id, version and kind, the tzdata version, how chosen), read back on resume and replay; a `control` window; `time-carried`; the argument row gains `window`, `converted`, the mention it is bound to, and `model-chosen` when it differs; period rows gain `period-differs-from-asked { missing, extra }`, `period-shifted` and `partly-beyond-retention`; `clocks-differ`; the axis's `naive-values`, `dst-ambiguous` and `dst-gap` counts. Events carry names, enums and counts; values live in the rows. |
| **Resolve** | **Ask**: an ambiguity the policy cannot settle, a DST gap, an unknown zone, a `model` reading to confirm. **Assume**: a policy choice, recorded (`dateOrder: 'DMY'` says so on the row); a carried window. **Refuse**: every reading outside the tool's `direction`, a range wholly beyond `retention`, a range wider than `maxRange`, a multi-day range to a `day`-only tool, a run with no zone, and — only under later opt-ins — a widening (`widen: 'refuse'`) or a mismatching model window (`mismatch: 'refuse'`). **Record and run**: a model-chosen window (the v1 law); a covering look-back. **Flag**: differs-from-asked, shifted, partly beyond retention, clocks (a label). |
| **Fold** | New reasons: `time-assumed` (a policy picked among readings), `period-differs-from-asked` (`missing` → "not sure"; `extra` alone → TQ8), `model-chosen` against the person's window, `period-beyond-retention`, `clocks-differ` (label only). New lineage kind `derived-from-reading`, folded like `argument-assumed`. Nothing here can support "known"; only `said` parts at grain, `answered` values and a `control` window count as the person's. |
| **Serve** | The model: one registered sentence naming the person's resolved window(s) in each tool's form, on the tools that declare a period — library text, so its spellings are `derived-from-reading`, never evidence; the refusal corrections. The tool: `ctx.time`, over MCP in the call's `_meta.agentfootprint.time`. The person: the time ask; the limits lines in the presentation zone. The lens: the rows. |
| **Arm + measure** | `.time()` arms the clock, the ask and the checks; the reader is armed on its own (`reader`, no default); a tool's `period` fields arm conversion for that tool. Each paid step has a bench (§ 13). |

---

## 13. Implementation plan

Every step follows the honesty design's checklist
([../honesty/README.md](../honesty/README.md) § 7): tests of all seven types, every byte
reference, served sentences registered in `test/modelFacingSurfaces.test.ts`, a
`ledgerRowIsWellFormed` arm per new row kind, the folder README, a CAPABILITIES row, a `.changes`
fragment, a feature example, the docs site budget measured after the last code change, and
delivery only when the host re-pins and the behaviour is counted by hand.

Benchmarks run on Haiku 4.5 only, inside a budget the owner approves per cell. Steps marked $0 are
deterministic and are measured over retained recorded runs or unit tables, with no model call.

| # | Step | Ships | Arm (off ⇒ byte-identical) | Needs | Tests (beyond the checklist) | Bench |
|---|---|---|---|---|---|---|
| T0 | **This page** | `docs/design/time/` | — | — | — | — |
| T1 | **One owner** — *landed; implementation note T1 below* | `src/core/time/` `instant.ts` (two profiles), `duration.ts` (per-use units), `zone.ts`, `range.ts` (the § 3.3 edge conversions, `parseRange` / `spellRange`); `period.ts`, `declare.ts` import from it; the § 12.1 rows settled and pinned | none (refactor + the two named refusals) | TQ1, TQ11 | property: every instant the lenient profile accepted before is accepted after (`periodVerdict` byte-identical, inclusive); every `iso-range` argument accepted before is accepted after except rows a–b; `1000000m` still accepted; `30s` still refused for a default look-back; round-trip `durationMs` ↔ `spellDuration` and `parseRange` ↔ `spellRange`; every § 3.3 boundary round-trips; DST table for 20 zones through `Intl` | $0 |
| T2 | **The declared time axis, on T1** — *landed; implementation note T2 below* | the in-flight `feat/dataset-time-axis` rebased: `core/time/axis.ts`, `normaliseInstants` as a read-side view with the value check, the `naive-values` status replacing "(or are UTC)", the fall-back overlap rule (§ 8); `artifacts/` re-exports | a dataset declares `timeAxis` | T1 | epoch-s / epoch-ms / mixed offsets normalise to sorted UTC; offset-less values under a zone-less `iso` axis are counted (or refused, by choice), never read as UTC; two `01:30` rows across a fall-back resolve by row order, a lone one is `dst-ambiguous`; stored bytes unchanged | $0; host panel hand count |
| T3 | **The clock and the presentation** — *landed; implementation note T3 below* | run option `time` (`now`, `zone`, `window`), `.time({ zone })` as the fallback, the `clock` stamp with `nowSource` / `zoneSource`, `clock-on-resume`, `dispatchedAt` on call rows, the checkpoint arm, `present.ts` (the said end; locale-neutral with no reader), `periodLine` in the presentation zone | `.time()` | T1 | the clock survives pause/resume unchanged, and a resume passing a new `time` is recorded, not applied; no zone anywhere → the run is refused; `dispatchedAt` after a resume is the resume's; `nowSource: 'default'` recorded; limits line golden files per zone, "to 8:40" shown as 08:40 | $0 |
| T6a | **The reader port and the resolver** — *landed; implementation note T6a below* | `TimeReader` (`kind`, `version`, `locale`), `TimeParts`, `resolve.ts` over parts + clock + the v1 policy (`dateOrder`, `year`) and the fixed laws (DST, end edge), the `time-reading` row (reader version, tzdata version) read back on resume, the `saidByPerson` gate, the `model`-reading rule | `.time({ reader })` | T3 | against a **fixture reader** that returns fixed parts: every candidate for `10/09/26`, a bare `8:40`, a DST overlap; an out-of-text quote is refused; a replay never calls the reader; a library-written `role: 'user'` turn is never read | $0 |
| T4 | **The time ask** | `InputField.format` (refused unless `type: 'string'`), re-validation of shape, order and zone, labelled choices, catalog reasons (TQ7), MCP `date-time` mapping | a `format` field or `.time()` | T3, T6a | answers out of order, zone-less, in a DST gap → re-ask with `refused` and `repeat`; a `model` reading offered to confirm | $0; host hand count |
| T5a | **Declared mapping and exact conversions** | `ToolPeriod.forms` (bounds, joined, object, day, lookback with `units`) and the sugar (`accepts`, `wall-range`, `zoneArgument`); the facts `direction`, `retention`, `maxRange`, `granularity`, `filtersToAsked`, `wallZone`; `_meta.agentfootprint.period` read by `readToolExtras`; the exact rows of § 7.2; `ctx.time` in process and in `_meta.agentfootprint.time`; fill from one mention (a `control` window included), binding by quote, the record-and-run law for a differing model window; the tool facts join T4's re-validation | a tool's new `period` fields | T4, TQ1 | every exact row of § 7.2; a two-argument epoch-ms Python tool over the mock MCP client; a model window that differs → runs, row `model-chosen`, fold "not sure"; a drill-down and a comparison call run untouched; "this morning vs yesterday morning" from the fixture reader → two mentions, no fill, each call bound by quote | $0 |
| T5b | **Widening and pre-dispatch refusals** | the inexact rows of § 7.2 (the covering look-back, `day` wider, `filtersToAsked`), the dispatch drift § 7.4, the refusals (outside `direction`, wholly beyond `retention`, over `maxRange`, a multi-day range to a `day` tool, a `wall` DST gap), `partly-beyond-retention` | a tool's new `period` fields | T5a | every inexact row of § 7.2 and every row of § 7.4; a range half inside `retention` dispatches; a future window to a `past` tool is refused with the reason | $0 |
| T6b | **The English default and the paid bench** | `englishTimeReader` (a tokenizer; the v1 rows of § 5.3), the served sentence (TQ13), the lazy ask wired to real words | `.time({ reader: englishTimeReader() })` | T5b | the host's field sentences as the table ("10/09/26 8 AM to 8:40 AM PST" → a zone ask for `PST`, "yesterday", a future date); every non-v1 row of § 5.3 reads "unreadable" | **paid**: the provoking set — calls with the right window, and absolute windows asked of a look-back-only tool (wrong-window answers, armed vs unarmed); needless-ask rate on controls |
| T7 | **Evidence lineage at grain** | `forms.ts` · `timeFormsOf` with its `said` and `derived` lists; the lineage kind `derived-from-reading`; the gate asks it; the private table from `fix/person-values-normalized` retires | `.time()` | T6b; `fix/person-values-normalized` landed first (TQ25) | "8 AM" vs `8:00`/`08:00` → `said`; a corrected abbreviation, an implied year, `-07:00`, `08:41`, the served sentence echoed → `derived-from-reading`, never "known"; a time no reading produced still fails; the landed fix's cases still pass after it retires | $0 over retained recordings: false "not traced" on time values |
| T8 | **Result checks** | `period-differs-from-asked { missing, extra }`, `period-shifted`, `period-beyond-retention`, `clocks-differ` (declared wall-clock zones, a label); fold reasons; limits lines | the results layer + `.time()` | T5b, T3 | a tool clamping 30d to 7d (`missing`); a covering look-back (`extra`); a look-back after a 30-minute pause (both); an inclusive `queried.to == asked.to − 1 step` reads as covered; `Z` vs `-07:00` periods raise no `clocks-differ` | **paid**: false "not sure" rate on correct answers (Q33's cell R3 method) |
| T9a | **Lens** (lens repo) | the rows of § 10.6 | the lens's own | T8; floor = the af release that ships T8 | lens fixtures per row kind | $0 |
| T9b | **Host panel** (host repo) | the rules of § 10.3, `time.window` from a brush | the host's own | T2, T3, T5a; floor = the af release that ships T5a | the panel's hand count | $0 |
| T9c | **Metrics dashboard** (host repo) | the mapping of § 10.5 | the host's own | T5b; floor = the af release that ships T5b | the dashboard reads a tool's `period` instead of its table | $0 |
| T9d | **vizfootprint adapter** (host or a bridge package) | the contract of § 10.4 | the adapter's own | T2; floor = the af release that ships T2; the owner's go | an adapter table test | $0 |
| T10 | **Host migration** | the host shrinks to `.time()` configuration plus, optionally, its reader strategy; `queryWindowFlow.ts`'s provider wrapper, `windowCapability.ts`'s probing and the zone tables go; the tools mint `period` and declare capabilities | host | T6b, T8 | the host's gate, with dummy keys | Haiku re-run of the host's field cases, before vs after |

**Implementation notes.**

- **T1.** Landed as written, with four smallest faithful choices. (1) The dataset time axis
  shipped on main before T1 (`artifacts/timeAxis.ts`, with its `INTERVAL` digit cap and an
  `Intl`-only zone check), so T1 leaves it untouched and T2 folds it: § 12.1 row d's "the axis's
  cap (unshipped) goes with it" is now a shipped cap, and dropping it — like refusing `PST` there
  — is a behaviour change T2 names in its changelog line. (2) `Intl` is more forgiving than § 3.2's
  `ZoneName`: on Node 22 it accepts `PST` (reading it as `America/Los_Angeles`), `EST` (as
  `America/Panama`) and a bare offset (`+05:30`), so `zone.ts` · `isZoneName` adds a shape rule
  (`Area/Location`, or `UTC` / `GMT`) before asking `Intl`. (3) Nothing is exported from the package
  in T1 (TQ16: nothing is public until T3); the folder is internal and its README says so. (4) The
  look-back row of § 3.3 is `[until − L, until]`, both ends inside, so `range.ts` ·
  `lookbackRange` reads it back as half-open `[until − L, until + 1 ms)` (the inclusive-span rule
  with a 1 ms step), and `lookbackOf` inverts it.

- **T2.** Landed with these smallest faithful choices. (1) There was no branch to rebase: the axis
  had shipped on main, so `artifacts/timeAxis.ts` MOVED to `core/time/axis.ts` (its five internal
  importers repointed; `artifacts/index.ts` re-exports it and `normaliseInstants`, so the package
  surface only grows). The two behaviour changes T1's note foresaw are named in the changelog: an
  `interval` has no digit cap (`duration.ts` under `AXIS_UNITS`), and a `zone` goes through
  `zone.ts` · `isZoneName`, so `PST`, a bare offset, `utc` and `EST5EDT` are refused at mint and an
  older ticket carrying one reads `malformed`. (2) The view's shape: `NormalisedAxis` is
  `instants | naive-values | refused`; `count` is `naive + dstAmbiguous` (the two "clock unknown"
  counts), and `dstGap`, `unreadable` and `missing` are counted under every status. `points` are
  sorted in time (ties by row), each carrying its row index, spelled at the column's finest
  precision with a fixed-width fraction — `instant.ts` · `spellInstant` drops trailing zeros, and
  `…:00Z` would sort after `…:00.5Z` as text. (3) "Rows not in time order" is made exact: over the
  zoned wall values in row order, a value not after the one before it is a step back; the column
  can place overlap values only when every step back lies between two overlap values of the same
  day, and a day places them only with exactly one step. An EQUAL repeat is a step (the two-`01:30`
  case), so a column that repeats wall times elsewhere (long format, one row per series) places
  none — counted `dstAmbiguous`, never guessed. (4) Under a zoned axis, a value that carries its
  own offset is read as that instant. A date alone (`2026-09-14`) is naive under a zone-less axis
  and midnight wall time under a zoned one. Epoch values must be numbers, read through their
  decimal spelling (so `…400.123` is exactly 123 ms); an exponent spelling, a digit string or a
  year past 9999 is `unreadable`. (5) No ledger row kind, served sentence or byte reference: the
  view is a pure read-side function; the Record clause's axis counts are its fields until a
  consumer records them. The feature example is the existing
  `examples/artifacts/dataset-time-axis.ts` (a `normalise` region), where datasets are taught.

- **T3.** Landed with these smallest faithful choices. (1) **Where the rows live.** The one
  honesty ledger (`AgentState.findingsLedger`, filed through `findings/ledger.ts` ·
  `recordFindings`), three new kinds owned by `core/time/rows.ts`: `clock` (one per run, filed
  last in seed — `stages/seed.ts` · `stampClock` — after `anchorTurnNumber`, so its `turn` is
  final), `clock-on-resume`, and `call`. The design's "call row" had no existing shape (the
  argument and period rows exist only under their layers), so a `call` row is ONE per dispatched
  call, filed just before `tool.execute` at both of ToolCalls' execute sites (the batch loop and
  the check-in resume door) — a call that never reached a tool files none. "The checkpoint arm" is
  `core/runCheckpoint.ts` · `ledgerRowIsWellFormed` routing the three kinds to `rows.ts` ·
  `timeRowIsWellFormed`, plus the ledger restore armed under `.time()` so a continued
  conversation keeps each turn's clock. No row fires an event (the `conflict` precedent), and
  nothing is served to the model, so no sentence is registered; the armed byte reference is
  `agent-time-clock`. (2) The `control` window rides the `clock` row (`window: { from, to,
  source: 'control' }`) rather than a fourth kind: it is a run input stamped at the same moment.
  (3) **Two spellings of the run input.** `run({ message, time })` as designed, and
  `AgentRunOptions.time` for the doors with no message bag (`followUp`, `resume`,
  `resumeOnError`); the input wins, as `identity` does. `time` passed to an agent WITHOUT
  `.time()` is refused (a door that ignored it would look configured and do nothing) — the one
  behaviour change off the arm, named in the changelog. (4) **Frozen means across a pause.** Every
  pause is raised in ToolCalls, in two shapes: the pausable handler's pause (a check-in, a
  middleware ask, a tool's own pause), whose resume enters the `resume` door, and the inputs
  layer's argument ask, which pauses through `interrupt()`, so its resume RE-RUNS `execute` from
  its top. `clock-on-resume` is filed first thing at BOTH entries (`stages/toolCalls.ts` ·
  `recordClockOnResume`); the passed value is taken once (`ToolCallsHandlerDeps.time` ·
  `takePassedOnResume`), so the resumed leg files it once whichever door it came through and a
  fresh run files nothing. It compares the passed values with the kept `clock` row as text (the
  record keeps spellings); a paused turn with no clock (written by a runtime without the layer)
  files nothing. `resumeOnError` and a continued conversation are new runs and stamp their own
  clock. **A turn `run()` did not start** — the agent's chart mounted in a composition, which
  passes no `time` — stamps the builder's fallback zone with the turn's start (`zoneSource:
  'builder'`, `nowSource: 'default'`, the record a `run()` with no `time` files), and is refused
  when there is no fallback (`Agent` · `seedClockDraft`); the draft `run()` read ends with that
  `run()`, so an earlier direct run's clock is never stamped on a later turn. (5) A zone is recorded **as the app wrote it** once
  `zone.ts` · `isZoneName` accepts it: `Intl`'s canonical form can be an older link the person
  never named (`Asia/Kolkata` → `Asia/Calcutta` on Node 22). (6) **Presentation.** No reader
  exists yet, so `present.ts` is locale-neutral only (`2026-10-09 08:00–08:40
  America/Los_Angeles (UTC-07:00)`; each end's offset when a span crosses a DST change) and the
  presentation zone is the clock's; the `locale` arm arrives with the reader (T6a). `.time()`
  takes `{ zone }` only — `reader` and `policy` are refused until their steps ship, rather than
  accepted and ignored. `periodLine` under the arm renders each end as declared (a declared period
  is inclusive) and reads `; read at …` in place of the parenthesis; unarmed it is byte-identical.
  (7) Both wall-clock reads (a default `now`, `dispatchedAt`) are spelled at fixed width
  (`toISOString`), so they compare as text; an app's `now` may be a strict instant (kept as
  written) or a `Date` (spelled so).

- **T6a.** Landed with these smallest faithful choices. (1) **The files.** `core/time/reader.ts`
  (the port, `readerIssue`, `checkReading`), `core/time/resolve.ts` (`resolveMention`,
  `chooseReading`, the v1 `TimePolicy`, the checks for a recorded candidate and choice), a fourth
  row kind in `rows.ts` (`time-reading`, `timeReadingRows`, `readingsOf`), `zone.ts` ·
  `tzdataVersion`; `.time()` takes `{ zone?, reader?, policy? }` (`clock.ts` · `readTimeOptions`),
  and a `policy` without a `reader` is refused (it would look configured and do nothing). Types
  only from the main barrel (TQ12). (2) **One row per mention — and one when there is none.** A
  message with no mention files ONE `time-reading` row with `mentions: 0` and no mention fields:
  without it a `resumeOnError` retry (which re-seeds the same turn) could not tell "read, nothing
  found" from "never read", and would call the reader twice for one message — the laundering path
  § 5.5 closes. **The replay rule** is therefore "a turn that already has `time-reading` rows is
  read back, never re-read" (`stages/seed.ts` · `readTimeWords` asks `rows.ts` · `readingsOf`); a
  pause never re-enters seed, so its resume cannot re-read either. A retry keeps the first
  attempt's reading, resolved against that attempt's clock. (3) **How a reading settles** is a
  recorded `choice`: `only` (every candidate left names one window), `policy` (the policy removed a
  reading — `time-assumed`'s raw material), `open` with the questions an ask must settle
  (`date-order`, `year`, `meridiem`, `dst`, `zone`, `parse`, `confirm`) — T4 raises the ask — or
  `none` (`unreadable`, `unsupported`, `no-candidate`, `excluded-by-policy`). The policy's `year`
  takes `'ask' | 'current'`: the candidates are the clock's year and the one before, and "always the
  previous year" is no rule anyone writes. (4) **The gate** reads only this turn's entry, and only
  when `lib/saidByPerson.ts` · `isSaidByPerson` accepts it; a composed run's message
  (`messageFrom: 'composed'`) is never read, so an agent with a reader registers as a reader of
  that marker (`core/messageFrom.ts` · `readsMessageFrom`) and `run()` forwards it to it. (5) **An
  out-of-text quote** refuses that mention (`refused: 'quote-not-in-text'`), and the row keeps NO
  text — a quote the person did not write is not the person's words; malformed parts refuse the
  mention (`malformed`); a reading that is not `{ mentions: [] }` fails the run, naming the reader
  (never a guess at what it meant). Bounds on the record: 16 mentions, 4 parses. (6) **What v1
  resolves.** A day word (`relative: { day, offset }`) and a look-back; a part of the day, a
  calendar week / month / year, a window anchored on the previous one and a look-back inside a
  range are named `unsupported`; a range whose `to` wall time is earlier than its `from` with no date said ("11 PM to 1 AM") is not rolled into the next day — it resolves to no candidate (`none / no-candidate`), honest and asked, never guessed. A said zone is an IANA name or a numeric offset (`Z`, `±HH:MM`,
  `±HHMM`, `±HH`; noted `offset-said`, the window's `zone` stays the clock's); any other token is
  asked (`needsZone`). A two-digit year takes the clock's century (noted `century-implied`). A day
  starts at its first instant (Temporal's `startOfDay`, `wallToInstant(…, 'compatible')`). A range
  side takes the day and the zone the whole mention or the other side said, and the sides must
  agree on date order and year. `TimePart` gains `second` (a said second) and `duration` (a
  look-back's length), and `ReadingTags` gains `endMeridiem` (a range's `to` side) and each
  candidate `parse` (which parse it came from). (7) **Not in this step.** The presentation stays
  locale-neutral in the clock's zone — the reader's `locale` is on every row for the step that
  first shows a reading to a person — and nothing is served to the model (so no sentence is
  registered and the request bytes equal the reader-less twin's). No new byte reference: the rows
  carry the runtime's tzdata version, and every existing reference (the T3 armed one included) is
  unchanged.

**Why this order.** T1 settles the grammar every other step leans on and is free. T2 is already
written and only needs rebasing and the value check. T3 gives the first visible win (the limits
line in words) and is the clock every later check needs. T6a comes before the ask because the ask
offers the resolver's candidates, and it is tested with a fixture reader, so no English words and
no model call are needed yet. T4 then asks; it checks shape, order and zone, and the tool facts
join its checks in T5a, when they land. T5 is split so each half is small: exact conversions
first, then everything that widens, shifts or refuses. The paid bench waits for T6b, the first
step that reads real words, because every bench question starts from a person's words. T7 needs
recorded readings and retires the gate fix that lands now (TQ25). T8 needs the conversion rows.
Each consumer is its own packet in its own repo, pinned to the af release it reads. The host
migrates last, one piece at a time, each piece deleting app code.

**The host after T10.** The host keeps: its zone and policy values in `.time()`, its reader (if it
wants its own), the tools' declarations in `host:py-tools/server.py` (a `period` on each result and
the `period` capabilities in its tool metadata), and the panel's rendering. It deletes: the clock
and policy code in `timeContext.ts`, the provider wrapper in `queryWindowFlow.ts`, the capability
probe, the future check, and its private time vocabulary in the metrics adapters.

---

## 14. Open questions for the owner

**Answered 2026-09-30:** each question took its recommended answer (owner: "implement").

| # | Question | Recommended answer | Why |
|---|---|---|---|
| TQ1 | Split Q39's "never parses '2h'" into T-words and T-spellings (§ 5.4)? | **Yes.** It also reopens a narrower read for T8, as `period-differs-from-asked`'s `missing`. | The law protected the person's words; a tool author's `-40m` is a machine format, and converting it is what break 4 needs. |
| TQ2 | Supersede the honesty design's "an absolute compound window stays app code" (§ 1.4)? | **Yes**, with a pointer from that section to this page. | The owner's brief: a library for everyone. |
| TQ3 | Ship our own English reader, or wrap chrono-node? | **Our own, small, no dependency.** A chrono-node adapter can come later as an optional peer (`lib/lazyRequire.ts`) if a bench shows a gain; because a reader returns parts (§ 5.1), such an adapter is cheap. | chrono-node's default takes the first parse and hides the other readings — the ambiguity this layer must keep as data. (Its reading of PST as −08:00 in October is arguably the correct literal one, so it is not the reason.) |
| TQ4 | May a reader be async (an LLM-backed reader)? | **Yes, as `kind: 'model'`**: same parts shape, same checks, recorded with its id — but its readings are never `said`: they are confirmed through the ask or fold to "not sure", and resume/replay use the recorded reading, never a re-run (§ 5.5). | The checks verify shape, not meaning: a model reading "yesterday" as the wrong day passes every one of them. |
| TQ5 | When the app passes no `now`? | **The turn's start, recorded `nowSource: 'default'`.** | Admitted like any default; refusing would make every run option mandatory. |
| TQ6 | The model writes a window that differs from the person's: record, refuse, or replace? | **Record by default** (`mismatch: 'record'`): the call runs as sent, the row says `model-chosen, differs from the person's window`, claims about the person's window fold to "not sure". `'refuse'` with the corrected form is a later opt-in (TQ23). Never replace. | The shipped law (`core/tools.ts` · `Tool.askOrAssume`: "a present value runs as sent, filed as the model's own"); refusing would also block drill-downs, comparisons and baselines. "Never overwrite" argues for recording, not refusing. |
| TQ7 | Who writes a refusal reason for a time answer (§ 6.2)? | **A `src/locales/` catalog sentence the app can override**, only for checks the app armed. | Refines 9.127.0's "the library never writes one"; the app still owns the words. |
| TQ8 | Does a read with `extra` and no `missing` (wider than asked) make the answer "not sure"? | **Yes by default**, and the T8 bench's false-"not sure" rate decides. A result that declares `queried` equal to the asked range (it filtered its own rows; a tool may say it will, with `filtersToAsked`) clears it. Whether to widen at all is app policy (a later `widen: 'refuse'`), never a tool's. | A count over a wider read answers a different question. |
| TQ9 | The end of a person's range: end of grain, or exact? | **End of grain**, recorded — a fixed law in v1; an `exact` switch only if a bench shows the need. | People mean "through 8:40"; Elasticsearch's `lte` rounding does the same. |
| TQ10 | Where does the zone come from? | **Per run** (`time.zone`), with `.time({ zone })` as an optional declared fallback; with neither, `run()` is refused. The stamp records `zoneSource: 'run' \| 'builder'`, and `resolve.ts` uses that zone for every part the person left zone-less. | A zone fixed at build time is wrong for a multi-user app, and the silent server zone is the most-cited failure in the research. |
| TQ11 | Add `s` to the look-back units? | **Only by opt-in.** One grammar, units per use: a look-back's default stays today's `mhdw`; a tool that takes seconds declares `units: 'smhdw'` (§ 7.1); an axis interval takes `smhdw`. No digit cap. | Adding `s` to the default widens `lookback` for every existing declarer whose backend may not take seconds — a behaviour change without opt-in (§ 12.1 row e). |
| TQ12 | Where does it export from? | **The main barrel**; no new subpath. | A subpath adds API reference routes to the site budget; the reader is small. |
| TQ13 | Is the resolved window served to the model? | **Yes, one registered sentence, on tools that declare a period**, naming each mention's window; its spellings are `derived-from-reading`, never evidence (§ 9.5). | Otherwise the model re-derives the window from words — the clock-tool anti-pattern; the lineage stops its echo passing the gate. |
| TQ14 | vizfootprint: where does the adapter live? | **In the host or a bridge package; no vizfootprint change until the owner says its refactor is done.** | vizfootprint is read-only for this work. |
| TQ15 | Add `temporality` to the axis now? | **Later**, when a tool mints a cumulative series. | `aggregate` covers today's tools. |
| TQ17 | Does a turn with no time words reuse the previous window? | **Yes, only through a recorded row** (`time-carried { fromTurn }`, named in the limits line) — a fixed law in v1; a `carry: 'off'` switch, falling back to the tool's `askOrAssume` rule, only if a need shows. | Follow-ups rarely repeat the window, and re-asking is a needless ask; a silent carry would be a hidden default. |
| TQ18 | A tool bound's edge when the tool does not declare one? | **`inclusive`**, and T5a requires the declaration on every new `bounds`/`object` form (only the sugar defaults). | Matches `periodVerdict`'s inclusive reading of what a tool covers and SQL `BETWEEN`; an exclusive backend given an inclusive bound loses at most one step, which § 9.2 would report as `missing`. |
| TQ19 | The drift threshold before a look-back is converted or recorded as shifted (§ 7.4)? | **The tool's `granularity`, else 1 minute.** | Below one step the tool cannot see the difference; a fixed minute keeps an undeclared tool honest after any real pause. |
| TQ20 | Several mentions and declared sources off: fill anything? | **No.** Record which mention each model value equals, if any. | Filling would be the library picking among the person's own windows. |
| TQ21 | `resume()` is passed a different `time`? | **Keep the frozen clock and record the passed value** (`clock-on-resume { passed, kept }`). | The paused turn's words were resolved against the frozen clock; refusing would punish an app that passes the current time on every call. |
| TQ22 | A range wider than a tool's `maxRange`: ask or refuse? | **Refuse** before dispatch, the reason naming `maxRange`. | Deterministic, and the same rule as a multi-day range to a `day`-only tool: splitting into several calls is the model's choice, not the library's. |
| TQ23 | How large is the v1 configuration? | **`.time({ zone?, reader?, policy?: { dateOrder, year } })` plus the tools' facts and the run's `time`.** Presentation, DST, the end edge, abbreviations, parts of day, mismatch, carry and widening are fixed laws (§ 11) until a bench shows one needs a switch. | About twenty switches were drafted; most had one careful value, and every switch is a place for a silent default. |
| TQ24 | Where does "the future is not readable" live? | **On the tool**: `period.direction: 'past' \| 'future' \| 'any'`, beside `retention`; absent, not checked. No global `future` policy. | Readability is a fact about the source (a log store holds no tomorrow); a global default fits an analysis agent and is wrong for a scheduling agent. |
| TQ25 | The gate's person-values fix: wait for T7, or land now? | **Land `fix/person-values-normalized` now** for the field bug; T7 retires its private table and keeps its cases. | The field bug is live today; T7 is several steps away. |
| TQ26 | A window set in a UI (a brush, a range picker)? | **A run input, `time.window`, recorded with `source: 'control'`**; it counts as the person's, like an answer, and as one mention for the fill rule. | It was not given in reply to a library ask, so filing it as `answered` would bend that word; one input serves panel, dashboard and chat. |
| TQ16 | The names: `.time()`, `TimeReader`, `TimeParts`, `TimeClock`, `ResolvedWindow`, `PeriodForm`, `wall-range`, `period-differs-from-asked`, `derived-from-reading` | **Keep the drafts** for T1–T3; rename freely before T5a ships. | Nothing is public until T3. |

---

## 15. Review record

One review, 2026-09-29, against af 9.127.0 (`c05834a1`), the host at `ef53e31`, the in-flight
`feat/dataset-time-axis` and read-only reads of vizfootprint. Verdict: right direction, not yet
universal or safe to build. It was applied in two revisions: the first applied M1–M9 and
reconstructed M10 from a copy cut off partway through it; the second read the **full review** and
applied M10 as written, M11, every SHOULD-FIX (S12–S23) and every NICE item (N24–N29). None is
rejected.

| # | Finding | Applied in |
|---|---|---|
| M1 | The edge law contradicted `periodVerdict` (inclusive) and vizfootprint's `IntervalClause` (inclusive, SQL `BETWEEN`; its "half-open" is a `null` side); the display showed `08:41` for "to 8:40" | § 3.2 (`TimeRange` no longer claims to equal `queried`), § 3.3 (a table, one row per boundary; `periodVerdict` stays inclusive and byte-identical), § 6.1, § 10.2, § 10.4 |
| M2 | The strategy seam was one layer too low: every language strategy would redo zone, DST, abbreviation and edge arithmetic | § 5.1 (`TimeParts`; a strategy is a tokenizer), § 3.1 (`resolve.ts`), § 5.3, § 5.4, § 11 (`partsOfDay` moved to the policy — since S14 a later switch); `abbreviations` removed from `TimeReadContext`, `dst` from `TimeCandidate.reading` (now a `dst-overlap` note) |
| M3 | `mismatch: 'refuse'` contradicted `Tool.askOrAssume`'s shipped law and blocked drill-downs and comparisons | § 7.3, § 9.3, § 11 (default `'record'`), § 12.2, TQ6 |
| M4 | One window per turn was assumed; binding a call to a mention was missing; carry-over unstated | § 5.6, § 7.3, TQ17, TQ20 |
| M5 | A frozen clock broke look-back exactness after a pause | § 4 (`dispatchedAt`), For the owner (since rewritten), § 7.4, § 9.2 (one `period-differs-from-asked { missing, extra }` replaces narrower/wider), TQ19 |
| M6 | The tool vocabulary modelled only the host's two families; `ctx.time.asked` had no wire form | § 7.1 (`PeriodForm`: bounds, joined, object, day, lookback; today's spellings as sugar; `_meta.agentfootprint.period`), § 7.5 (`_meta.agentfootprint.time`), § 3.1 (`wire.ts`) |
| M7 | T1 was not byte-identical and its exceptions were incomplete | § 12.1 (rows a–e; one more found while applying this: `T24:00` accepted by `Date.parse` today), § 3.1 (two instant profiles, per-use units, no digit cap), TQ11 (`s` is opt-in) |
| M8 | Library-derived time spellings leaked into "the person's words" | § 9.5 (`said` vs `derived-from-reading`, folded like `argument-assumed`), § 12.2 Fold and Serve, TQ13 |
| M9 | An LLM-backed reader laundered a model claim | § 5.5 (`kind: 'rule' \| 'model'`; a model reading is confirmed or "not sure"; replay never re-runs a reader), § 5.2, § 6.1, TQ4 |
| M10 | § 8's naive-axis claim was wrong: the in-flight `DatasetTimeAxis.zone` reads a zone-less `iso` axis as "(or are UTC)", and `timeAxisIssues` never looks at values | § 8: T2 adds a value check in `normaliseInstants` (flagged as `naive-values`, or refused by the app's choice; never read as UTC); the fall-back overlap rule (row order, else `dst-ambiguous`; `dst-gap`); `normaliseInstants` is a read-side view, stored bytes unchanged; T2's tests. **Corrected from the reconstruction**, which said `timeAxisIssues` "refuses only a `zone` on an epoch unit" (it also judges keys and the zone's validity — the point is that it never sees a value) and lacked the overlap rule and the read-side clause |
| M11 | The default reader silently armed word reading | § 5.2, § 11 (`reader` has no default; no reader → no `time-reading` rows, no word-driven asks), § 12.2 Arm |
| S12 | `future` and `abbreviationMismatch` defaults fit one app | § 7.1 (`direction` is a tool fact beside `retention`), § 5.1, § 6.2, § 6.3, § 9.1, § 11 (no global `future`; `abbreviationMismatch: 'ask'` with both readings, citing `host:be-server/timeContext.ts` · `zoneMismatch`; the `year` reason made universal; the locale from the reader, locale-neutral with none), TQ24; research.md lesson 4 |
| S13 | Two zones with unclear precedence; one required in the wrong place; resume with a new `time` unstated | § 4 (`TimeClock { now, nowSource, zone, zoneSource }`; per-run zone, builder fallback, refused with neither; `resolve.ts` uses the stamp's zone — `TimeReadContext` has held no zone since M2; `clock-on-resume`), TQ10, TQ21 |
| S14 | About twenty switches for v1 | § 11 (v1: `.time({ zone?, reader?, policy?: { dateOrder, year } })` + tool facts; the rest are fixed laws with the switch each would add; `checks.retention` dropped as a duplicate; `widen` moved to app policy and the tool declares `filtersToAsked`), § 3.3, § 5.6, § 7.2, § 7.3, TQ6, TQ8, TQ9, TQ17, TQ23 |
| S15 | `clock-skew` measured latency; `clocks-differ` flagged spellings | § 9 (skew cut; `clocks-differ` limited to declared wall-clock zones, a label only), § 10.2, § 12.2, T8 |
| S16 | Retention and `maxRange` unspecified at the edges | § 7.2 and § 9.4 (partial overlap dispatches, `held` decides; only a wholly older range is refused), § 6.2; `maxRange` → refuse (TQ22) |
| S17 | The steps were not small and the order had gaps | § 13 (T1 → T2 → T3 → T6a → T4 → T5a → T5b → T6b → T7 → T8; T9 split per consumer repo with a floor each; the paid benches at T6b), TQ25 (the gate fix lands now, T7 retires it) |
| S18 | The panel's "time range as a control" bent the word `answered` | § 4 (run input `time.window`, `source: 'control'`), § 3.2, § 5.6, § 7.3, § 9.5, § 10.3, § 10.5, TQ26 |
| S19 | The metrics mapping conflated presets with ask choices | § 10.5 (presets stay app configuration; only absolute range, max range and direction come from the tool; the default `windowTime` has no `maxRangeHours`) |
| S20 | The vizfootprint contract overreached | § 10.4 (`SeriesGrain` stays a caption, "never parsed (R12)" — computing on it is a future vizfootprint decision; the bucketing-zone gap in `viz:src/data/bins.ts` named) |
| S21 | Two range spellings had no owner | § 3.1 and § 3.3 (`range.ts` · `parseRange` / `spellRange`), T1 |
| S22 | The reader's input set was not tied to its owner | § 5.2 (`lib/saidByPerson.ts` · `saidByPerson`), T6a |
| S23 | Stale counts; the owner summary's wall-clock claim | § 12.1, § 13 ("every byte reference"); § 4 (two recorded wall-clock reads; the existing operational clocks named out of scope); For the owner rewritten |
| N24 | An owner quote pointed at one partner app | § 1.1 paraphrased |
| N25 | chrono-node's stated flaw was arguably correct behaviour | TQ3; research.md (first parse wins, ambiguity hidden) |
| N26 | The English reader's v1 set was too wide | § 5.3 (a v1 column; parts of day, night words and "last week" later), T6b |
| N27 | "Re-derive from the stamp" fails across reader or tzdata updates | § 4, § 5.1 (`TimeReader.version`), § 12.2 Record, T6a |
| N28 | `InputField.format` on a non-string; T11 in the plan | § 6.1, T4; T11 dropped (§ 9 says why) |
| N29 | "The x domain is `period.queried`" held only for one-call datasets | § 8, § 10.3, § 10.4 |

# Time interpretation — the whole meaning of a person's time words, before any read

**DESIGN — awaiting owner go.** 2026-10-28. Nothing in this page is built. It extends the time
layer ([time/README.md](time/README.md), [src/time/](../../src/time/README.md)); it is not a
second one. The measurement behind it is
[2026-10-time-interpretation-measurement.md](2026-10-time-interpretation-measurement.md).

Code is cited as `file · symbol`, under `src/` unless it starts with `host:` (the host app that
field-tests the library).

## For the owner

1. **The problem.** A tool that reads a time window reads the wrong window for ordinary
   English. "outside the last 2 hours" reads the 2 hours. "the last 15 minutes of each hour"
   reads 15 minutes. "last 2 hours, only while backups were running" drops the condition.
   "last 1½h" reads the default hour.
2. **The cause.** The library's reader returns a quote and its parts. It returns no offsets,
   no modifier, no recurrence, no event, and nothing about the words it did not read. So the
   host app guesses the rest with word lists.
3. **What we measured.** Five readers on 274 phrases (the host app's corpus and the
   reviewer's cases) and on 80 new phrases written blind. Plugged in as a value, every reader
   reads a wrong window on 46–65 of the 80. With the strict rule and quote agreement, the
   library's own grammar reads 17 of the 21 exact windows. It makes one wrong reading, a
   condition with no time word ("restricted to backup runs"). The host app's word list, tuned
   over several review rounds, makes three.
4. **What this page proposes.**
   - The reader's result grows into a `TimeInterpretation`: the words, their place, kind,
     modifiers, recurrence, event, and every time word left unread.
   - Tools declare the time shapes they support. Anything else is asked before any read.
   - The answer states the window it read, from the record.
   - The host app's phrases become the library's shared test corpus.
5. **Decisions needed.** § 15. The first is whether a clean rolling lookback may skip the
   confirmation click.

---

## 1. Why

### 1.1 The failures

| The person wrote | The tool read | It should |
|---|---|---|
| outside the last 2 hours | the last 2 hours | ask: the tool reads one window ending now |
| the last 15 minutes of each hour | the last 15 minutes | ask: the tool cannot keep a part of each hour |
| last 2 hours, only while backups were running | the last 2 hours | ask: the tool cannot keep only those times |
| last 1½h | the app's default hour | read 90 minutes, or ask |

The library's reader shows the cause directly. For the first three phrases it returns a plain
lookback, such as `{ quote: 'last 2 hours', parses: [{ relative: { unit: 'hour', count: 2 } }] }`.
Nothing in it says "outside", "of each hour" or "while". For "last 1½h" it returns no mention
at all (measured on `englishTimeReader()` 1.2.0).

### 1.2 What the reader cannot say today

`time/reader.ts · TimeMention` is `{ quote, parses, problem? }`. A quote is a verbatim
substring, with no offset. `TimeParts` holds a date, a wall time, a zone token, a relative
amount, a part of day, an anchor (`'previous'`) and a range. It has no field for:

- a modifier ("before", "about", "outside");
- a recurrence ("each hour", "every 5 minutes");
- an event anchor ("while backups were running", "of the outage");
- the time words the reader did not cover.

`checkReading` refuses any other key as `malformed`. A reader that saw more could not say so.

### 1.3 Why word lists in the app cannot fix it

The library already refuses to let a reading stand as the person's words: "Always confirm"
(time design TQ29) offers every reading in the time ask first. That costs one click per time
phrase, "last 2 hours" included. The host app wanted lookbacks read without the click. So it
reads them itself, in a tool middleware, and guards the read with a word scan
(`host:be-server/timeWords.ts`, 460 lines).

That guard cannot be finished:

- **It leaks on new wording.** After several review rounds it reads none of the 274 phrases
  wrong. On 80 phrases it had never seen, it read 3 wrong: an event anchor ("of the outage"),
  an approximation after a comma ("maybe a little more"), and a condition with no time word.
- **No word list sees a condition with no time word.** "restricted to backup runs" has none.
  Every reader that can read a lookback read the 2 hours, even behind the scan.
- **A list passes the corpus it was tuned on, by construction.** Its own tests cannot show it
  is right.
- **Every app writes it again.** Two owners of one grammar drift. That is the time layer's
  first law.

The library can do this once, for every app: structure from the reader, one scan whose only
power is to ask, quote agreement, and a benchmark that includes phrases nobody tuned against.

## 2. What exists, and what this design extends

| Seam | Today | This design |
|---|---|---|
| `time/reader.ts · TimeReader`, `TimeMention`, `TimeParts`, `checkReading` | the port: quote + parts, checked for shape | the reader may add offsets and structure; the library computes the rest (§ 6) |
| `time/readers/english.ts · englishTimeReader` | a closed tokenizer; "unreadable" for the rest | reads the closed lookback grammar with fractions and number words, and returns offsets (§ 7.1) |
| `core/agent/stages/timeLayer.ts · readTimeWords` | runs the reader once per message, at the seed | also runs `interpret` and files its result |
| `time/rowsBuild.ts · timeReadingRows`, `time/rows.ts · TimeReadingRow` | one `time-reading` row per mention; the "Always confirm" law lives here | the rows carry the interpretation; the law gains its one measured exception, if approved (§ 8.4) |
| `lib/saidByPerson.ts · isSaidByPerson` | the one gate for which message a person wrote | unchanged: only that message is read |
| `tools/declare.ts · ToolPeriod`, `periodRule` | a period's forms and facts; every period argument carries an `askOrAssume` rule | gains `shapes` (§ 8.1) |
| `semantics/coverage/search/types.ts · SearchArgument.whenOmitted` | the default a tool applies when an argument is left out | unchanged; checked against the `askOrAssume` default |
| `time/windows.ts · isOpenForPerson` | a reading waits on the person: to confirm, a zone, words not read | also open: leftovers, a modifier, a recurrence, an event, an unsupported shape |
| `time/bind.ts · callWindowOf` | which window a call carries; refuses what no form holds | refuses to fill an unsupported shape; records the app's default (§ 9) |
| `core/agent/arguments/resolve.ts · verifyPlan`, `timeDecisionsOf` | routes open readings to the batch ask, before dispatch | unchanged route; more readings are open |
| `time/readingAsk.ts · timeAskOf`, `time/ask.ts · checkTimeAnswer` | builds and judges the time field | new choices and catalog keys for each unsupported shape (§ 8.3) |
| `time/convert.ts · convertForTool` | the one answer to "can this tool read this window" | unchanged |
| `semantics/coverage/period.ts · periodLine`, `semantics/coverage/timeLimits.ts · timeLimitLinesOf` | lines about what a call queried, rendered in the person's zone | the line also says whose window it was (§ 9) |

## 3. What research and industry do

Each fact below was checked against its source on 2026-10-28.

- **ISO 24617-1:2012 (ISO-TimeML).** TIMEX3 types are `DATE`, `TIME`, `DURATION` and `SET`.
  Its `mod` values are `BEFORE`, `AFTER`, `ON_OR_BEFORE`, `ON_OR_AFTER`, `LESS_THAN`,
  `MORE_THAN`, `EQUAL_OR_LESS`, `EQUAL_OR_MORE`, `START`, `MID`, `END` and `APPROX`. `SIGNAL`
  marks function words that relate times and events ("on", "during", "when", "if"). `EVENT`
  and `TLINK` connect a time to what happened. There is no complement modifier: "outside" is
  our addition.
- **Recognizers-Text (DateTimeV2).** Types `date`, `time`, `daterange`, `timerange`,
  `datetimerange`, `duration`, `set`, `datetime`, with a `mod` such as `before` or `after`.
  Ambiguity comes back as several values.
- **Duckling.** Intervals with a grain, from a server. Rasa uses it.
- **chrono-node.** JavaScript; a result is a start and an optional end.
- **Models.** In Su et al. 2025 (arXiv 2507.06450), six frontier models wrote structured
  normalisations (SCATE code) at 0.50–0.69 accuracy, average 0.62, on TempEval-2013's training
  split. On the test split the one model tried both ways scored 0.49 structured and 0.38 with
  direct intervals. A model may propose; code must check.
- **ThoughtSpot.** A closed keyword grammar ("last n days", "n days ago", "before", "between …
  and …", "for each"). Its `last` returns the last n full periods and excludes the current
  one. The search bar draws a box around each recognised phrase, and an ambiguous term is
  settled by picking from a list.

Two lessons follow. No reader we measured sees a complement or an event condition. And "last
N" is not one thing: a rolling window in Recognizers, but whole periods that leave out the
current one in Duckling (clock hours) and in ThoughtSpot's documented `last`.

## 4. The measurement, in short

On the 80 blind phrases (21 exact windows, 46 to ask, 13 with no time):

| Reader | Rule | Wrong readings | Unnecessary clarifications | Exact reads |
|---|---|---|---|---|
| any of the five | the value as the window | 46–65 | 0 | 8–21 |
| library grammar (prototype) | strict + agree | **1** | 7 | 17 |
| `englishTimeReader` (today) | strict + agree | **1** | 14 | 10 |
| Recognizers-Text | strict + agree | **1** | 15 | 11 |
| Duckling | strict + agree | 0 | 20 | 8 |
| chrono-node | strict + agree | 0 | 25 | 0 |
| the host app's rule | its own | **3** | 9 | 13 |

The one wrong reading in the middle rows is the same phrase: "over the last 2 hours,
restricted to backup runs". Duckling and chrono reach zero by asking almost everything. The
seven questions the grammar asks without need are all sampling cadences, which the strict rule
asks about on purpose. The full tables, the 274-phrase results and the method are in the
[measurement page](2026-10-time-interpretation-measurement.md).

## 5. The reviewer's requirements

The owner's independent reviewer approved the direction with these requirements. Each one says
how it is met and how it is tested.

**R1. What the parser keeps.** The person's original time words (quoted, with their place),
the interpreted scope, and every restriction it could not interpret. A structured object from
a model proves nothing on its own.
- *Met by:* `TimeInterpretation` (§ 6) keeps each mention's quote and span, its kind,
  modifiers, recurrence and event, and the turn's `leftovers`. The library computes spans and
  leftovers itself; it never takes them from the reader. A model's reading is checked against
  the person's words (verbatim quote, grammar agreement) and the declared shapes (§ 7.4).
- *Tested by:* a property test that every span slices back to its quote; the shared corpus
  (§ 13) asserting the leftover classes per phrase; a fixture model reader that invents a
  quote, misstates a value, or leaves out a restriction, each one caught.

**R2. Supported shapes.** Tools declare the time shapes they support. An unsupported or
ambiguous request is clarified before any read.
- *Met by:* `ToolPeriod.shapes` (§ 8.1). An interpretation outside a tool's shapes is open
  (`windows.ts · isOpenForPerson`); the batch ask asks it before dispatch
  (`arguments/resolve.ts · verifyPlan`). It is never widened, filled or defaulted.
- *Tested by:* the corpus run through an agent with a mock provider: for every phrase labelled
  ask, the tool's `execute` is never called before the answer to the ask.

**R3. Bounds come from the runtime.** The runtime fixes the query bounds and the zone. The
answer shows them from the execution record, including whether the app supplied a default. It
never restates them from the model's text.
- *Met by:* the clock (`time/clock.ts · readRunTime`, the `clock` row) and the `call-window`
  row already fix the asked range and zone; the time design's drift law (time/README.md
  § 7.4) redraws a lookback the clock moved past. New: an app default is filed as
  `how: 'default'` with its asked range (§ 9). The window line is rendered by code from those
  rows (§ 9).
- *Tested by:* a run where the model's prose names another window; the delivered window line
  still equals the rows. A run with no time named shows "the app's default".

**R4. Migration order.** The host app's regression cases move into the library's tests
first. The host app removes its own phrase checks only after the library's implementation is
integrated into the host app and passes those same cases. Until then the host app keeps its
checks.
- *Met by:* § 12, in that order.
- *Tested by:* the host app's corpus test runs against the library build before any deletion
  is merged.

**R5. Reuse the existing machinery.** The design extends the `TimeReader`, the period
declarations and the time ask. It is not a parallel system.
- *Met by:* every change in § 2 lands on an existing seam. The new modules are leaves under
  `time/`.
- *Tested by:* the layering check: `time/` stays a leaf; no second ask path exists.

**R6. Score the complete meaning.** "outside the last two hours" read as "the last two
hours" is a wrong reading.
- *Met by:* the corpus labels the whole request (reads *N*, ask, none), never the fragment.
- *Tested by:* the corpus test fails on any read whose label is ask.

**R7. Unseen cases.** A held-out set of at least 60 new phrases, written blind and fixed by a
hash and a time before any run, across every class, reported apart.
- *Met by:* 80 phrases in 11 classes, fixed at 2026-10-28T23:33:15Z (SHA-256 `caec788a…`),
  run once on a frozen harness.
- *Tested by:* § 13: each release adds a fresh blind batch the same way.

**R8. Two numbers, never merged.** Wrong readings and unnecessary clarifications are counted
apart.
- *Met by:* every table here and in the measurement page.
- *Tested by:* the corpus test gates on wrong readings (must be 0 on the shared corpus) and
  reports clarifications as a separate number that may not grow.

## 6. The port — `TimeInterpretation`

The reader stays the adapter. The library turns its reading into one checked interpretation
per message, modelled on TIMEX3:

```ts
/** The library's checked reading of ONE message a person wrote. Filed with the turn's
 *  time-reading rows. Never built from a reader's say-so alone. */
interface TimeInterpretation {
  readonly reader: { readonly id: string; readonly version: string; readonly kind: 'rule' | 'model' };
  /** The leftover scan's vocabulary version, recorded like the reader's. */
  readonly scan: { readonly version: string };
  readonly mentions: readonly InterpretedMention[];
  /** Time-bearing words no mention covers: the restrictions nothing interpreted. Any one asks. */
  readonly leftovers: readonly Leftover[];
}

interface InterpretedMention {
  /** The person's words, verbatim, and where they are (UTF-16 offsets; text.slice(...) === quote). */
  readonly quote: string;
  readonly span: readonly [start: number, end: number];
  /** TIMEX3 DATE/TIME → 'point'; a range; DURATION; SET → 'recurrence'. */
  readonly kind: 'point' | 'range' | 'duration' | 'recurrence';
  /** Today's parts, unchanged: what was said. resolve.ts still turns them into windows. */
  readonly parts: TimeParts;
  /** What a relative value is measured from (TIMEX3 anchorTimeID). */
  readonly anchor: 'now' | 'mention' | 'event' | 'unstated';
  /** TIMEX3 `mod`, plus 'outside' (a complement — TIMEX3 has none). */
  readonly modifiers: readonly TimeModifier[];
  /** TIMEX3 SET: "each hour", "every 5 minutes". */
  readonly recurrence?: { readonly quote: string; readonly span: readonly [number, number] };
  /** SIGNAL + EVENT: "while backups were running", "of the outage". */
  readonly event?: { readonly signal: string; readonly quote: string; readonly span: readonly [number, number] };
  /** The closed lookback grammar's own reading of the quote, when it has one (agreement). */
  readonly grammar?: { readonly seconds: number };
}

type TimeModifier = 'before' | 'after' | 'on-or-before' | 'on-or-after' | 'less-than'
  | 'more-than' | 'start' | 'mid' | 'end' | 'approx' | 'outside';

interface Leftover {
  readonly text: string;
  readonly span: readonly [number, number];
  /** Why it counts: unit, amount, clock, calendar, relation, event, negation, approximation,
   *  recurrence, comparison, position, scope, range, or the slot before a mention. */
  readonly class: LeftoverClass;
}
```

**Rules.**
- A reader returns what it can. The library fills the rest. `time/interpret.ts · interpret`
  (new, a leaf) locates each quote, runs the leftover scan, reads modifiers, recurrence and
  events from the words around each mention, and asks the grammar for its own reading.
- **The scan can only add asks.** It never makes a read. It decides nothing but "this word was
  not interpreted". A word it misses can let a wrong read through; a word it adds only costs a
  question. Its vocabulary is data in `time/signals.ts`, versioned and recorded.
- The port grows additively. `TimeMention` may carry `at` (the quote's offset) and `TimeParts`
  may carry `mod` and `every`, so an adapter like Recognizers can report what it sees.
  `checkReading` checks them for shape. The library never relies on them for safety.

## 7. Adapters behind the port

### 7.1 The default: `englishTimeReader`, extended

It is the measured winner. On the blind set, its grammar prototype made 1 wrong reading, 7
unnecessary clarifications and 17 exact reads of 21. It has no dependency, works in the
browser (4.9 KB gzip for the prototype), and runs in tens of microseconds. Changes:

- read the closed lookback grammar: `[the] last | past | trailing | latest | most recent`, an
  exact amount, a unit. The amount may be digits, a decimal, a vulgar fraction, number words,
  "half an", "a quarter of an", "… and a half", or "1 hour 30 minutes". "a couple of", "a
  few", "several" and "previous" stay out;
- return the quote's offset;
- raise `ENGLISH_TIME_READER_VERSION`, because what it returns changes.

Everything it reads still goes through `resolve.ts`, as today.

### 7.2 Optional: Recognizers-Text, not in v1

It is the only external reader that reports structure: `set` for "each hour", `mod` for
"since" and "before". But on our phrases it does not earn its cost:

- It needs quote agreement to be safe. It reads "last 1½h" as 1 hour and "past couple of
  hours" as 2 hours, with spans that cover every word.
- It reads "last 7 days" as calendar days.
- It is 336 KB gzip, and the npm package was last published in 2023.

On the blind set it read 11 exact windows to the grammar's 17. If an app needs its wider
coverage of dates and ranges, it can ship later as a lazy subpath adapter behind the same
checks.

### 7.3 Not supported: Duckling, chrono-node

- **Duckling** needs a separate Haskell server, so the person's text would leave the process
  over a network connection. It reads "last 2 hours" as the last two whole clock hours,
  07:00–09:00 at 09:30.
- **chrono-node** has no duration: "last 2 hours" and "2 hours ago" come back as the same
  point. It reads "for 90 minutes" as a time in the future.

### 7.4 A model as a reader: a proposal, checked

A `kind: 'model'` reader is allowed only as a proposal. The port already treats it so
(time design § 5.5: never `said`, filled as `derived-from-reading` until confirmed). On top of
that, each proposed mention must pass:

1. its quote is verbatim in the person's message (`checkReading`, today);
2. the library, not the model, computes spans and leftovers;
3. for a supported shape, the closed grammar reads the same value from the same words;
4. the shape is one the tool declares.

A proposal that fails any check is not dropped silently. It becomes an open mention, asked
with nothing pre-filled. No model was called for this design.

## 8. Supported shapes, declared by tools

### 8.1 The declaration

`ToolPeriod` (`tools/declare.ts`) gains one optional fact:

```ts
period: {
  forms: [{ kind: 'lookback', argument: 'window', signed: false }],
  direction: 'past',
  shapes: ['rolling-lookback'],   // new: the time shapes this tool reads as the person meant them
}
```

| Shape | Means | v1 |
|---|---|---|
| `rolling-lookback` | one duration ending now; no modifier, recurrence or event; nothing left over | yes |
| `range` | one closed range, as today's readings resolve it | yes |
| `day` | one calendar day | yes |
| `recurrence-filter`, `event-window`, `complement` | a tool that can keep part of a window | named, not built |

Absent, `shapes` is derived from `forms`, and behaviour is byte-identical to today. Declared,
it is checked at definition like `direction`, and travels over MCP in
`_meta.agentfootprint.period` (`mcp/toolExtras.ts · readToolExtras`).

### 8.2 The decision, before any read

| The interpretation | A tool that declares it | A tool that does not |
|---|---|---|
| one mention of a supported shape, nothing left over | filled exactly (after the confirm click, or without it if § 8.4 is approved) | asked, with the readable alternative as a choice |
| a modifier, recurrence, event or complement | asked | asked |
| any leftover | asked | asked |
| two or more mentions | the model binds by quote (the time design's § 5.6) | asked |
| no time named | the tool's own `askOrAssume` default, filed as the app's | the same |

"Asked" is today's batch ask: one ask before anything in the batch dispatches
(`arguments/ask.ts · planAskFields`, `stages/argumentAsk.ts · windowPlanOf`). A tool with no
period is not affected.

### 8.3 The ask offers choices where it can

| Unsupported because | The ask |
|---|---|
| a complement ("outside the last 2 hours") | no choice can be right. Free entry: "This search reads one window ending now, like 'the last 6 hours'. Which window should it read?" |
| a recurrence ("of each hour") or a condition ("only while backups ran") | free entry, naming what the tool cannot do: "It cannot keep only the last 15 minutes of each hour." |
| an approximation ("about the last 3 hours") | the exact core as one choice: "the last 3 hours", and free entry |
| a range or a day, to a lookback-only tool | the covering lookback as one labelled choice ("the last 34 hours, which includes all of yesterday"), and free entry. It is never widened silently. |
| words no reader read | free entry, as today (`arguments/serve.ts · unreadSentence`) |

The sentences are new keys in the ask catalog (`src/locales/timeAsk.ts`), which the app may
override, as every ask sentence may (TQ7). The answer is judged by `checkTimeAnswer`, as
today.

### 8.4 The confirm click and the growth rule

Today every reading costs one click (TQ29, "Always confirm"). TQ29 has a growth rule: a form
may skip the click only when a registered, committed benchmark shows the reader always reads
it right. This design proposes the first such form:

- **the form:** a `rolling-lookback` read by the closed grammar, one mention, no modifier,
  recurrence, event or leftover;
- **the gate:** zero wrong readings on the shared corpus and on a fresh blind batch, checked
  in CI for every reader and scan version;
- **the opt-in:** per app, `.time({ reader, readsWithoutConfirm: ['rolling-lookback'] })`. The
  row is then filed `said`, and its reader and scan versions are recorded.

Everything else keeps the click. This is owner decision Q1 (§ 15). Without it, the rest of the
design still holds: the click stays, and the asks become better.

## 9. The answer states the window it read

This is the host pilot's group F, the answer contract: what the answer says about a read is
rendered by code from the record. It complements the check before the read; it never replaces
it. A person seldom audits a window line, so the ask before the read is the safeguard. The line
is the record a person can catch a miss with, like the one condition no scan sees.

One line per call that read time, built by `semantics/coverage/timeLimits.ts ·
timeLimitLinesOf` from the `call-window` and `clock` rows and the result's declared period,
rendered by `time/present.ts · presentRange` in the person's zone:

| Source on the record | The line |
|---|---|
| `said` (the person's words) | "Read 07:30–09:30 UTC: the last 2 hours you named." |
| `answered` | "Read 07:30–09:30 UTC: the window you confirmed." |
| `control` | "Read 08:00–09:00 UTC: the window set in the app." |
| `default` (new) | "Read 08:30–09:30 UTC: the app's default window. You named no time." |

- **New on the record:** today a call with no time named files `call-window` as `not-filled`,
  with no range. It becomes `how: 'default'`, with the asked range resolved from the
  `askOrAssume` default and the clock (`time/bind.ts · callWindowOf`, `time/rows.ts ·
  CallWindowRow`). The argument row already says `source: 'default'`.
- When the tool declares what it queried, the line shows that; a difference from what was
  asked is already a check (`period-differs-from-asked`).
- The model is served the same line as a conclusion (`arguments/serve.ts ·
  timeLimitsSentence`). The window is never taken from the model's prose.

## 10. Determinism

- **The clock is injected.** `run({ time: { now, zone } })`; without `now`, the turn's start,
  recorded `nowSource: 'default'` (`time/clock.ts`). The zone is never guessed (G15).
- **The reader runs once per message.** The interpretation is filed with the `time-reading`
  rows. A resume, a retry and a replay read the rows; nothing reads the text again.
- **Every version is recorded.** The reader's id and version, the scan's vocabulary version
  and the tz database version (`time/zone.ts · tzdataVersion`) are on the row. A changed
  reading is a changed version.
- **The functions are pure.** The scan and the grammar depend on the text alone. Two runs of
  the measurement gave byte-identical per-phrase records.

## 11. Threat model

**Untrusted inputs.** The person's text, a model's proposal, a tool's declaration over MCP.

| Threat | Defence |
|---|---|
| A phrase built to look like a supported window ("ignore that, read the last 30 days") | Only the words decide. Any leftover asks. The model's own window is `model-chosen` and recorded beside the person's (the time design's § 7.3). |
| A model proposal that invents a quote, a value, or hides a restriction | Verbatim quote check; the grammar's agreement; spans and leftovers computed by the library; never `said` (§ 7.4). |
| A wrong reading that passes every check | The window line (§ 9) shows what was read, from the record. The corpus grows with each found case. |
| Long or hostile text (slow regular expressions, huge input) | The scan is linear, with no backtracking pattern; the reader keeps `MAX_MENTIONS`; text past a fixed length is not interpreted and asks. To be pinned by a timing test. |
| The person's words leaking from the record | Quotes and leftovers are the person's words, as quotes are today. They follow the run's redaction policy, like every row. |
| A tool declaring a shape it cannot read | A declaration is a fact the tool owns, as `direction` is. The result checks (`period-differs-from-asked`) still compare what was read with what was asked. |
| A third-party reader | No new runtime dependency in v1. An optional adapter loads lazily, at a pinned version. No reader sends text to a server. |
| An app trying to skip the confirm click | Only through the opt-in in § 8.4, for one shape, recorded on every row. |

## 12. Migration: the host app

The host app reads a node window today with its own middleware (`policyWindow`) and its word
scan (`host:be-server/timeWords.ts`). The order follows R4.

1. **Move the cases first.** The host app's 269 phrases, the reviewer's four cases, and the
   80 held-out phrases move into the library as the shared corpus (§ 13). Four rows that name
   products get generic nouns.
2. **Build in the library.** § 6–§ 9, behind the corpus test.
3. **Integrate in the host app, with its checks still on.** The host's tool declares:

   ```ts
   period: { forms: [{ kind: 'lookback', argument: 'window', signed: false }],
             direction: 'past', shapes: ['rolling-lookback'] },
   askOrAssume: { window: { assume: '1h' } },   // the app's default, recorded as the app's
   ```

   and keeps `.time({ reader: englishTimeReader() })` armed, as it is today. Its middleware
   still runs.
4. **Run the host app's own corpus test against the library build.** Every case must pass.
5. **Only then remove** `timeWords.ts` and the middleware's word rules. **Until step 4
   passes, the host app keeps its checks.**

What the middleware does today, and where each part goes:

| The middleware today | In the library |
|---|---|
| the host's window control sets the bounds | `run({ time: { window } })` (exists) |
| one clean lookback the person wrote replaces the model's window | the fill (exists), with or without the click (§ 8.4) |
| no time named: the app's window | the `askOrAssume` default, filed `default` (§ 9) |
| any other time: the call is refused | asked before any read (§ 8.2) |
| the model's own bounds beside the person's lookback: refused | recorded `model-chosen` today; refusing it needs the planned opt-in `mismatch: 'refuse'` (TQ6, not built) |
| the person's message is chosen by `isSaidByPerson` | the seed reads only that message (exists) |

## 13. The shared test corpus

- **Where:** `test/time/corpus/` as JSON: the phrase, its meaning label (reads *N*, ask,
  none), its class, and the host app's own label kept for reference.
- **Two numbers per run:** wrong readings, which must be 0; and unnecessary clarifications,
  which are reported and may not grow.
- **Blind batches:** every release that changes the reader, the scan or the grammar adds a
  new batch, written before the run and fixed by hash and time. A batch is never tuned
  against after its run; it joins the main corpus.
- **The benchmark of record:** the corpus is TQ29's registered benchmark. A form skips the
  click only while it passes.

## 14. Not in this design

- A stated Retry-After has nothing to do with this design. Retry and back-off are not
  touched here.
- Languages other than English. The scan's vocabulary is data, so a second language is a
  table.
- Recurrence filters, event windows and complements that a tool could honour. They are named
  as shapes, not built.
- Calendar parts of a day ("yesterday morning"). They stay unreadable and asked, as today.

## 15. Open questions for the owner

1. **May a clean rolling lookback skip the confirm click** (§ 8.4)? Recommended: yes, per-app
   opt-in, one shape only, gated by the corpus in CI.
2. **Sampling cadences** ("every 5 minutes") ask today under the strict rule. They were all 7
   of the grammar's unnecessary clarifications on the blind set. Recommended: keep asking in
   v1; add a cadence shape when a tool declares a step argument.
3. **A condition with no time word** ("restricted to backup runs") is read wrong by every
   reader that can read a lookback. Recommended: accept it as a known limit, covered by the
   window line (§ 9), and measure a model proposal on it later with the owner's go.
4. **Recognizers-Text as an optional adapter** (§ 7.2)? Recommended: not in v1.
5. **`shapes` absent:** derive it from `forms`, byte-identical to today? Recommended: yes.
6. **`how: 'default'` on the `call-window` row** (§ 9)? Recommended: yes. It changes the
   record for apps with `.time()` armed and a default rule.
7. **The host app's default:** move it to `askOrAssume` beside `search.whenOmitted`, and check
   that the two agree? Recommended: yes. The host's tests currently assert there is no
   `askOrAssume` rule, so step 3 changes them.
8. **Where the harness lives:** move the measurement scripts into `bench/time/`, without the
   host app's code? Recommended: yes, once this design is approved.

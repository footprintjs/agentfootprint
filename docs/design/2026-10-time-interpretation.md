# Time interpretation — the whole meaning of a person's time words, before any read

**Design under review — not approved for implementation.** Nothing in this page is built.
Approval to review it is not approval to implement it. First written 2026-10-28; revised 2026-10-29
to answer the review of PR #230 (verdict: changes required). It extends the time layer
([time/README.md](time/README.md), [src/time/](../../src/time/README.md)); it is not a second one.
The measurement behind it is
[2026-10-time-interpretation-measurement.md](2026-10-time-interpretation-measurement.md), and its
harness, labels, hashes and raw results are in
[bench/time/interpretation/](../../bench/time/interpretation/README.md).

Code is cited as `file · symbol`, under `src/` unless it starts with `host:` (the host app that
field-tests the library).

## For the owner

1. **The problem.** A tool that reads a time window reads the wrong window for ordinary English.
   "outside the last 2 hours" reads the 2 hours. "the last 15 minutes of each hour" reads 15
   minutes. "last 2 hours, only while backups were running" drops the condition. "last 1½h" reads
   the default hour.
2. **The cause.** The library's reader returns a quote and its parts. It returns no offsets, no
   modifier, no recurrence, no event, and nothing about the words it did not read. So the host app
   guesses the rest with word lists.
3. **What we measured.** Five readers, on 274 phrases from the host app's corpus and the reviewer,
   and on 80 phrases written before any reader ran. Plugged in as a value, every reader reads a
   wrong window or scope on 53–66 of the 80. With the full rule of this page, no reader makes a
   wrong reading on either set. That includes "restricted to backup runs", which a word list cannot
   see. The cost is questions: the library's own grammar asks 8 times without need on the 80, all
   for metrics the tool did not declare.
4. **What this page proposes.**
   - The reader's result grows into a `TimeInterpretation`: the words, their place, kind,
     modifiers, recurrence, event, and every time word left unread.
   - Tools declare the time shapes they read, whether they execute sampling, and the words for
     what they read.
   - **The complete-meaning rule.** Every word of the request must be accounted for, or the
     person is asked before any read.
   - The confirmation stays in v1, and it states the whole executable scope, not just the window.
   - The answer states the window it read, from the record. A default is recorded as a default,
     with no claim about what the person said.
   - The host app's phrases become the library's shared test corpus. The harness is in this PR.
5. **Decisions.** § 15 lists what the review decided and what is still open.

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
Nothing in it says "outside", "of each hour" or "while". For "last 1½h" it returns no mention at
all (measured on `englishTimeReader()` 1.2.0).

### 1.2 What the reader cannot say today

`time/reader.ts · TimeMention` is `{ quote, parses, problem? }`. A quote is a verbatim substring,
with no offset. `TimeParts` holds a date, a wall time, a zone token, a relative amount, a part of
day, an anchor (`'previous'`) and a range. It has no field for:

- a modifier ("before", "about", "outside");
- a recurrence ("each hour", "every 5 minutes");
- an event anchor ("while backups were running", "of the outage");
- the time words the reader did not cover.

`checkReading` refuses any other key as `malformed`. A reader that saw more could not say so.

### 1.3 Why word lists in the app cannot fix it

The library already refuses to let a reading stand as the person's words: "Always confirm"
(time design TQ29) offers every reading in the time ask first. That costs one click per time
phrase, "last 2 hours" included. The host app wanted lookbacks read without the click. So it reads
them itself, in a tool middleware, and guards the read with a word scan
(`host:be-server/timeWords.ts`, 460 lines).

That guard cannot be finished:

- **It leaks on new wording.** After several review rounds it reads none of the 274 phrases
  wrong for their window. On the 80 held-out phrases it read 3 wrong: an event anchor ("of the
  outage"), an approximation after a comma ("maybe a little more"), and a condition with no time
  word ("restricted to backup runs").
- **No list of time words sees a condition with no time word.** Every reader that can read a
  lookback read the 2 hours there, even behind the scan. Adding "restricted to" to a list fixes
  that phrase, not the next one.
- **A list passes the corpus it was tuned on, by construction.** Its own tests cannot show it is
  right.
- **Every app writes it again.** Two owners of one grammar drift. That is the time layer's first
  law.

The fix is not a longer list. It is to turn the question around: instead of listing words that
restrict a read, list what is understood, and ask about everything else (§ 8.6).

## 2. What exists, and what this design extends

| Seam | Today | This design |
|---|---|---|
| `time/reader.ts · TimeReader`, `TimeMention`, `TimeParts`, `checkReading` | the port: quote + parts, checked for shape | the reader may add offsets and structure; the library computes the rest (§ 6) |
| `time/readers/english.ts · englishTimeReader` | a closed tokenizer; "unreadable" for the rest | reads the closed lookback grammar with fractions and number words, and returns offsets (§ 7.1) |
| `core/agent/stages/timeLayer.ts · readTimeWords` | runs the reader once per message, at the seed | also runs `interpret` and files its result |
| `time/rowsBuild.ts · timeReadingRows`, `time/rows.ts · TimeReadingRow` | one `time-reading` row per mention; the "Always confirm" law lives here | the rows carry the interpretation; the law is unchanged |
| `lib/saidByPerson.ts · isSaidByPerson` | the one gate for which message a person wrote | unchanged: only that message is read |
| `tools/declare.ts · ToolPeriod`, `periodRule` | a period's forms and facts; every period argument carries an `askOrAssume` rule | gains `shapes` and `sampling` (§ 8.1) |
| `semantics/coverage/search/types.ts · ToolSearch`, `SearchArgument` | the search's words: `source.said`, `subject.said`, `fixed[].said`, and `said` on filter and source values | the complete-meaning rule reads them; population arguments gain words (§ 8.6) |
| `time/windows.ts · isOpenForPerson` | a reading waits on the person: to confirm, a zone, words not read | also open: leftovers, a modifier, a recurrence, an event, an unsupported shape, an unaccounted word |
| `time/bind.ts · callWindowOf` | which window a call carries; refuses what no form holds | refuses to fill an unsupported shape; records the default (§ 9) |
| `core/agent/arguments/resolve.ts · verifyPlan`, `timeDecisionsOf` | routes open readings to the batch ask, before dispatch | unchanged route; more readings are open |
| `time/readingAsk.ts · timeAskOf`, `time/ask.ts · checkTimeAnswer` | builds and judges the time field | the confirmation names the executable scope; new choices per unsupported shape (§ 8.3, § 8.4) |
| `time/convert.ts · convertForTool` | the one answer to "can this tool read this window" | unchanged |
| `semantics/coverage/period.ts · periodLine`, `semantics/coverage/timeLimits.ts · timeLimitLinesOf` | lines about what a call queried, rendered in the person's zone | the line also says whose window it was (§ 9) |

## 3. What research and industry do

Each fact below was checked against its source on 2026-10-28.

- **ISO 24617-1:2012 (ISO-TimeML).** TIMEX3 types are `DATE`, `TIME`, `DURATION` and `SET`. Its
  `mod` values are `BEFORE`, `AFTER`, `ON_OR_BEFORE`, `ON_OR_AFTER`, `LESS_THAN`, `MORE_THAN`,
  `EQUAL_OR_LESS`, `EQUAL_OR_MORE`, `START`, `MID`, `END` and `APPROX`. `SIGNAL` marks function
  words that relate times and events ("on", "during", "when", "if"). `EVENT` and `TLINK` connect a
  time to what happened. There is no complement modifier: "outside" is our addition.
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
  and …", "for each"). Its `last` returns the last n full periods and excludes the current one.
  The search bar draws a box around each recognised phrase, and an ambiguous term is settled by
  picking from a list.

Two lessons follow. No reader we measured sees a complement or an event condition. And "last N" is
not one thing: a rolling window in Recognizers, but whole periods that leave out the current one in
Duckling (clock hours) and in ThoughtSpot's documented `last`.

## 4. The measurement, in short

On the 80 held-out phrases (expected under a tool that declares no sampling: 17 reads, 53 asks, 10
with no time):

| Reader | Rule | Wrong readings | Unnecessary clarifications | Exact reads |
|---|---|---|---|---|
| any of the five | the value as the window | 53–66 | 0 | 8–17 |
| library grammar (prototype) | strict + agree | 1 | 0 | 17 |
| library grammar (prototype) | **complete meaning** | **0** | 8 | 9 |
| library grammar (prototype) | complete meaning, held-out nouns declared | **0** | 0 | 17 |
| `englishTimeReader` (today) | complete meaning | **0** | 11 | 6 |
| Recognizers-Text | complete meaning | **0** | 11 | 8 |
| Duckling | complete meaning | 0 | 16 | 5 |
| chrono-node | complete meaning | 0 | 18 | 0 |
| the host app's rule | its own | 8 | 7 | 10 |

- The one wrong reading left by strict + agree was "over the last 2 hours, restricted to backup
  runs". Under the complete-meaning rule it asks, because "restricted", "to", "backup" and "runs"
  are accounted for by nothing.
- The grammar's 8 questions are metrics the measured tool did not declare ("error rate", "disk
  latency", "requests"). With them declared there are none.
- Duckling and chrono reach zero by asking almost everything.
- The host app's 8 are three real misses and five sampling phrases it reads or defaults. Those five
  are right if its tool executes sampling; the measured profile does not.
- The rule was written after the first held-out run, which it answers (H23). Its numbers here are
  therefore not blind. On the 274 tuned phrases every reader makes 0 wrong readings under it.

The full tables, the method and its limits are in the
[measurement page](2026-10-time-interpretation-measurement.md).

## 5. The reviewer's requirements

The owner's independent reviewer set these requirements. R1–R8 came with the first review; R9–R14
came with its follow-up. Each says how it is met and how it is tested.

**R1. What the parser keeps.** The person's original time words (quoted, with their place), the
interpreted scope, and every restriction it could not interpret. A structured object from a model
proves nothing on its own.
- *Met by:* `TimeInterpretation` (§ 6) keeps each mention's quote and span, kind, modifiers,
  recurrence and event, and the turn's leftovers. Each call's row keeps the words the
  complete-meaning rule could not account for (§ 8.6). The library computes spans, leftovers and
  unaccounted words itself; it never takes them from the reader. A model's reading is checked
  against the person's words and the declared shapes (§ 7.4).
- *Tested by:* a property test that every span slices back to its quote; the shared corpus
  asserting each phrase's outcome; a fixture model reader that invents a quote, misstates a value,
  or leaves out a restriction, each one caught.

**R2. Supported shapes.** Tools declare the time shapes they support. An unsupported or ambiguous
request is clarified before any read.
- *Met by:* `ToolPeriod.shapes` (§ 8.1). An interpretation outside a tool's shapes is open
  (`windows.ts · isOpenForPerson`); the batch ask asks it before dispatch
  (`arguments/resolve.ts · verifyPlan`). It is never widened, filled or defaulted.
- *Tested by:* the corpus run through an agent with a mock provider: for every phrase expected to
  ask, the tool's `execute` is never called before the answer.

**R3. Bounds come from the runtime.** The runtime fixes the query bounds and the zone. The answer
shows them from the execution record, including whether the app supplied a default. It never
restates them from the model's text.
- *Met by:* the clock (`time/clock.ts · readRunTime`, the `clock` row) and the `call-window` row fix
  the asked range and zone; the time design's drift law (time/README.md § 7.4) redraws a lookback the
  clock moved past. A default is filed as `how: 'default'` with its asked range (§ 9). The window
  line is rendered by code from those rows.
- *Tested by:* a run where the model's prose names another window; the delivered window line still
  equals the rows.

**R4. Migration order.** The host app's regression cases move into the library's tests first. The
host app removes its own phrase checks only after the library's implementation is integrated into
the host app and passes those same cases. Until then the host app keeps its checks.
- *Met by:* § 12, in that order.
- *Tested by:* the host app's corpus test runs against the library build before any deletion is
  merged.

**R5. Reuse the existing machinery.** The design extends the `TimeReader`, the period declarations,
the search declaration and the time ask. It is not a parallel system.
- *Met by:* every change in § 2 lands on an existing seam. The new modules are leaves under
  `time/`.
- *Tested by:* the layering check: `time/` stays a leaf; no second ask path exists.

**R6. Score the complete meaning.** "outside the last two hours" read as "the last two hours" is a
wrong reading.
- *Met by:* the corpus labels the whole request (reads *N*, ask, none), never the fragment.
- *Tested by:* the corpus test fails on any read whose expected outcome is ask.

**R7. Unseen cases.** A held-out set of at least 60 new phrases, written before any run and fixed by
a hash and a time, across every class, reported apart.
- *Met by:* 80 phrases in 11 classes, fixed at 2026-10-28T23:33:15Z (SHA-256 `caec788a…`). Its first
  run was blind. One person wrote the set, the labels and the prototypes, and the complete-meaning
  rule came after the first run, so later runs are not blind for it (§ 13).
- *Tested by:* the next set is written by someone else, fixed the same way, before it is run.

**R8. Two numbers, never merged.** Wrong readings and unnecessary clarifications are counted apart.
- *Met by:* every table here and in the measurement page.
- *Tested by:* the corpus test gates on wrong readings (0) and reports clarifications as a separate
  number that may not grow.

**R9. Confirmation stays in v1, and it confirms the executable scope.** A window-only confirmation
does not confirm that no event filter was dropped.
- *Met by:* § 8.4. "Always confirm" (TQ29) is unchanged. The confirmation names the tool, the
  window and its zone, the declared filters it will apply, and says that nothing else is applied.
- *Tested by:* for every corpus phrase that reads, the call is preceded by a `time-answer` row; the
  confirmation text for H23-like phrases cannot be produced, because they ask first.

**R10. Sampling only when the tool declares and executes it.** Recognising the words is not enough.
- *Met by:* `ToolPeriod.sampling` (§ 8.5). Without it, a sampling instruction is an unaccounted word,
  and the request asks.
- *Tested by:* the 18 + 7 sampling phrases ask under a tool with no sampling; with a sampling tool,
  the step reaches the call's arguments and its row.

**R11. Complete meaning, structurally.** The clause carrying the time request must be fully
accounted for: the accepted lookback, the terms the tool declares, and closed function words. Any
remaining content word is an unresolved restriction, and the request asks.
- *Met by:* § 8.6, with how the clause is found and how a tool declares its words.
- *Tested by:* both sets (H23 asks); a property test that inserting any word outside the closed
  classes and the tool's terms into an accepted request makes it ask.

**R12. A default is recorded as a default.** The record says that the default was applied, never
that the person named no time: the reader can miss a time request.
- *Met by:* § 9.
- *Tested by:* no row or answer line for a default contains a statement about what the person said.

**R13. A lookback-only tool does not read exact calendar ranges.** Where its default is declared
changes nothing about that. Only a tool that declares and executes a range or day shape can.
- *Met by:* § 8.1 and § 12. For a lookback-only tool, a calendar or clock range is asked; a wider
  lookback is offered only as an explicit choice.
- *Tested by:* "yesterday" and "from 8 to 9" to a lookback-only tool ask, and never fill.

**R14. The harness travels with the design, before approval.** Anonymised scripts, labels,
versions, hashes and raw results.
- *Met by:* [bench/time/interpretation/](../../bench/time/interpretation/README.md). The host app's
  private module is not in it; the reference row that needs it is described there.
- *Tested by:* `--duckling-replay` re-scores the committed raw results to byte-identical records.

## 6. The port — `TimeInterpretation`

The reader stays the adapter. The library turns its reading into one checked interpretation per
message, modelled on TIMEX3:

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
- A reader returns what it can. The library fills the rest. `time/interpret.ts · interpret` (new, a
  leaf) locates each quote, runs the leftover scan, reads modifiers, recurrence and events from the
  words around each mention, and asks the grammar for its own reading.
- **The scan and the rule can only add asks.** They never make a read. A word the scan misses can
  let a wrong read through; the complete-meaning rule (§ 8.6) is the structural check behind it.
- The interpretation is per message. The complete-meaning rule is per call, because it reads the
  tool's declared words; its result goes on the call's `call-window` row as `unaccounted` (the
  words, with the declaration's version).
- The port grows additively. `TimeMention` may carry `at` (the quote's offset) and `TimeParts` may
  carry `mod` and `every`, so an adapter like Recognizers can report what it sees. `checkReading`
  checks them for shape. The library never relies on them for safety.

## 7. Adapters behind the port

### 7.1 The default: `englishTimeReader`, extended

It is the measured winner. It has no dependency, works in the browser (4.9 KB gzip for the
prototype), and runs in tens of microseconds. Under the complete-meaning rule it made no wrong
reading on either set, and the most exact reads of any reader. Changes:

- read the closed lookback grammar: `[the] last | past | trailing | latest | most recent`, an exact
  amount, a unit. The amount may be digits, a decimal, a vulgar fraction, number words, "half an",
  "a quarter of an", "… and a half", or "1 hour 30 minutes". "a couple of", "a few", "several" and
  "previous" stay out;
- return the quote's offset;
- raise `ENGLISH_TIME_READER_VERSION`, because what it returns changes.

Everything it reads still goes through `resolve.ts` and the confirmation, as today.

### 7.2 Optional: Recognizers-Text, not in v1

It is the only external reader that reports structure: `set` for "each hour", `mod` for "since"
and "before". But on our phrases it does not earn its cost:

- It needs quote agreement to be safe. It reads "last 1½h" as 1 hour and "past couple of hours" as
  2 hours, with spans that cover every word.
- It reads "last 7 days" as calendar days.
- It is 336 KB gzip, and the npm package was last published in 2023.

It can ship later as a lazy subpath adapter behind the same checks, if an app needs its wider
coverage of dates and ranges.

### 7.3 Not supported: Duckling, chrono-node

- **Duckling** needs a separate Haskell server, so the person's text would leave the process over a
  network connection. It reads "last 2 hours" as the last two whole clock hours.
- **chrono-node** has no duration: "last 2 hours" and "2 hours ago" come back as the same point. It
  reads "for 90 minutes" as a time in the future.

### 7.4 A model as a reader: a proposal, checked

A `kind: 'model'` reader is allowed only as a proposal. The port already treats it so (time design
§ 5.5: never `said`, filled as `derived-from-reading` until confirmed). Each proposed mention must
also pass:

1. its quote is verbatim in the person's message (`checkReading`, today);
2. the library, not the model, computes spans, leftovers and unaccounted words;
3. for a supported shape, the closed grammar reads the same value from the same words;
4. the shape is one the tool declares, and the complete-meaning rule accounts for the request.

A proposal that fails any check becomes an open mention, asked with nothing pre-filled. No model
was called for this design.

## 8. What a tool declares, and what the library decides

### 8.1 The declaration

`ToolPeriod` (`tools/declare.ts`) gains two optional facts:

```ts
period: {
  forms: [{ kind: 'lookback', argument: 'window', signed: false }],
  direction: 'past',
  shapes: ['rolling-lookback'],                 // new: the time shapes this tool reads as the person meant them
  sampling: { argument: 'every', units: 'mh' }, // new, optional: the tool reads its window in steps of this argument
}
```

| Shape | Means | v1 |
|---|---|---|
| `rolling-lookback` | one duration ending now; no modifier, recurrence or event; nothing left over | yes |
| `range` | one closed range, as today's readings resolve it | yes |
| `day` | one calendar day | yes |
| `recurrence-filter`, `event-window`, `complement` | a tool that can keep part of a window | named, not built |

- Absent, `shapes` is derived from `forms`, and behaviour is byte-identical to today. Declared, it
  is checked at definition like `direction`, and travels over MCP in `_meta.agentfootprint.period`
  (`mcp/toolExtras.ts · readToolExtras`).
- **A lookback-only tool does not read exact calendar or clock ranges.** "yesterday", "from 8 to 9"
  or "this week" to a tool whose only shape is `rolling-lookback` are asked. Where the tool's
  default is declared changes nothing about that. Only a tool that declares and executes a `range`
  or `day` shape (a `bounds`, `joined`, `object` or `day` form) reads them exactly. Any wider
  alternative is offered only as an explicit choice (§ 8.3), never filled.

### 8.2 The decision, before any read

| The request | A tool that declares the shape | A tool that does not |
|---|---|---|
| one mention of a supported shape, nothing left over, every word accounted for | offered in the confirmation (§ 8.4), then filled exactly | asked, with the readable alternative as an explicit choice |
| a modifier, recurrence, event or complement | asked | asked |
| any leftover, or any word the complete-meaning rule cannot account for | asked | asked |
| a sampling instruction | read with the sampling only if the tool declares `sampling`; otherwise asked | asked |
| two or more mentions | the model binds by quote (the time design's § 5.6) | asked |
| no time request found | the tool's own `askOrAssume` default, filed `default` (§ 9) | the same |

"Asked" is today's batch ask: one ask before anything in the batch dispatches
(`arguments/ask.ts · planAskFields`, `stages/argumentAsk.ts · windowPlanOf`). A tool with no period
is not affected.

### 8.3 The ask offers choices where it can

| Unsupported because | The ask |
|---|---|
| a complement ("outside the last 2 hours") | no choice can be right. Free entry: "This search reads one window ending now, like 'the last 6 hours'. Which window should it read?" |
| a recurrence ("of each hour"), a condition ("only while backups ran") or an unaccounted restriction ("restricted to backup runs") | free entry, naming what the tool cannot do: "It cannot keep only the last 15 minutes of each hour." |
| an approximation ("about the last 3 hours") | the exact core as one choice: "the last 3 hours", and free entry |
| a range or a day, to a lookback-only tool | the covering lookback as one labelled choice ("the last 34 hours, which includes all of yesterday"), and free entry. Never filled without that choice. |
| a sampling instruction, to a tool with no `sampling` | the window without the sampling as one labelled choice ("the last 2 hours, every reading — the tool cannot sample every 5 minutes"), and free entry |
| words no reader read | free entry, as today (`arguments/serve.ts · unreadSentence`) |

The sentences are new keys in the ask catalog (`src/locales/timeAsk.ts`), which the app may
override, as every ask sentence may (TQ7). The answer is judged by `checkTimeAnswer`, as today.

### 8.4 The confirmation stays, and confirms the executable scope

"Always confirm" (TQ29) is unchanged in v1. Every reading of a person's time words is confirmed
before the first call that needs it, a clean "last 2 hours" included. A finite corpus, passed,
does not show that arbitrary wording is understood.

A confirmation of the window alone is not enough: it does not show that a condition was dropped.
So the confirmation states the whole executable scope, from what the call will send:

> I will read **memory per node** for **07:30–09:30 UTC (the last 2 hours)**, every reading in that
> window, with no other condition. Is that what you meant?

It names the tool's subject, the window and its zone, each declared filter the call applies, the
sampling if the tool executes one, and "no other condition". A person who said "only while backups
ran" sees that this is not what will run. The text is rendered from the call's planned arguments
and the tool's declared words, never from the model's prose.

Skipping the confirmation for one shape is a question for v2 (§ 15), to be decided on evidence: an
independently written held-out set, and the complete-meaning rule in use.

### 8.5 Sampling: only when the tool executes it

A sampling instruction ("every 5 minutes", "per hour", "at 5-minute intervals", "sampled hourly")
says how finely to read inside the window. Recognising those words does not apply them. So:

- a tool that executes sampling declares it: `period.sampling: { argument, units }`. The library
  then accounts for the instruction, writes the step into that argument, and records it on the
  call's row; the confirmation names it;
- a tool that does not declare it gets a question. The instruction is never dropped silently.

No such declaration exists today. The search declaration's roles (`SearchRole`) have no sampling
role; the step argument would be classified `inert` for coverage.

### 8.6 The complete-meaning rule

When one lookback is accepted for a call, **every word of the person's message** must be accounted
for. A word is accounted for when it is:

1. in the accepted lookback, with the "the" and the one lead-in preposition it takes in (in, over,
   for, during, within, across, through, throughout);
2. a term the tool declares for what it reads: its subjects, metrics and targets;
3. a number bound to a declared target: an identifier after it ("node 40", "nodes 1-4", "drives 3
   through 5") or a count before it ("two nodes", "a couple of nodes");
4. a preposition whose object is accounted for ("per node", "on node 40", "of memory", "from the
   last 2 hours");
5. a word of a closed class, owned and versioned by the library:
   - function words that cannot narrow a read: articles and determiners, pronouns, auxiliaries,
     the question words "what", "which", "who", "whose" and "how", and "and";
   - the request frame: "show", "give", "list", "chart", "please", "look", "like", a greeting;
   - operations on the rows read, not on what is read: "peak", "highest", "average", "busiest",
     "top";
   - a question "when" or "what time" that opens a clause beside the lookback (it asks for a time
     inside it);
6. a sampling instruction, only for a tool that declares `sampling`.

Any other word is an **unresolved restriction**, and the request asks. Negations, quantifiers ("each",
"every"), "or", "but", "if", "when", "while", "than" and the temporal prepositions are in no closed
class, so they ask unless they are part of the lookback.

**The clause is the whole message.** The rule does not end the clause at sentence punctuation,
because a restriction can follow in the next sentence ("… over the last 2 hours. Only while backups
ran."). This costs questions on messages that say two things. A narrower clause would need a parser
and a measured reason.

**H23 under the rule.** "memory per node over the last 2 hours, restricted to backup runs":
"memory" and "node" are declared, "per" has an accounted object, "over the last 2 hours" is the
lookback. "restricted", "to", "backup" and "runs" are accounted for by nothing, so the request asks.
No phrase list names them.

**What a tool must declare, and what is not declared today.**

| The rule needs | Declared today | Needed |
|---|---|---|
| the words for the store and the subject | `ToolSearch.source.said`, `subject.said` | nothing new |
| the words for a fixed qualifier, a filter value, a source value | `SearchFixed.said`, `SearchArgument.said` (filter and source roles only) | nothing new |
| the words for a **metric or target** a population argument selects ("memory", "node") | no: `said` is refused on population arguments | `said` on population values, and `words` for the argument's own noun |
| that a number after a target noun is that target's identifier ("node 40") | no | `identifiers: true` on that argument |
| whether the tool executes **sampling** | no | `period.sampling` (§ 8.5) |
| the **shapes** it reads | no (derived from forms) | `period.shapes` (§ 8.1) |
| the closed classes | — | library data, versioned like the reader, never tool data |

A tool that declares none of the new words is not broken: its requests that need them ask. That is
the rule's cost, measured: with the vocabulary derived from the existing corpus only, the grammar
asked 8 times without need on the held-out set, every time for a metric the tool did not declare.

## 9. The answer states the window it read

This is the host pilot's group F, the answer contract: what the answer says about a read is rendered
by code from the record. It complements the check before the read; it never replaces it. A person
seldom audits a window line, so the question before the read is the safeguard. The line is the
record a person can catch a miss with.

One line per call that read time, built by `semantics/coverage/timeLimits.ts · timeLimitLinesOf`
from the `call-window` and `clock` rows and the result's declared period, rendered by
`time/present.ts · presentRange` in the person's zone:

| Source on the record | The line |
|---|---|
| `answered` (the person confirmed it) | "Read 07:30–09:30 UTC: the window you confirmed." |
| `control` | "Read 08:00–09:00 UTC: the window set in the app." |
| `default` (new) | "Read 08:30–09:30 UTC: the app's default window." |

- **A default is recorded as a default.** Today a call with no window files `call-window` as
  `not-filled`, with no range. It becomes `how: 'default'`, with the asked range resolved from the
  `askOrAssume` default and the clock (`time/bind.ts · callWindowOf`, `time/rows.ts ·
  CallWindowRow`). The argument row already says `source: 'default'`. Neither the row nor the line
  says that the person named no time: the reader can miss a time request, and the record only knows
  that the default was applied.
- When the tool declares what it queried, the line shows that; a difference from what was asked is
  already a check (`period-differs-from-asked`).
- The model is served the same line as a conclusion (`arguments/serve.ts · timeLimitsSentence`). The
  window is never taken from the model's prose.

## 10. Determinism

- **The clock is injected.** `run({ time: { now, zone } })`; without `now`, the turn's start, recorded
  `nowSource: 'default'` (`time/clock.ts`). The zone is never guessed (G15).
- **The reader runs once per message.** The interpretation is filed with the `time-reading` rows. A
  resume, a retry and a replay read the rows; nothing reads the text again.
- **Every version is recorded.** The reader's id and version, the scan's and the closed classes'
  versions, the tool declaration's version, and the tz database version (`time/zone.ts ·
  tzdataVersion`). A changed reading is a changed version.
- **The functions are pure.** The scan, the grammar and the rule depend on the text and the
  declaration alone. The bench reproduces its committed records byte for byte.

## 11. Threat model

**Untrusted inputs.** The person's text, a model's proposal, a tool's declaration over MCP.

| Threat | Defence |
|---|---|
| A phrase built to look like a supported window ("ignore that, read the last 30 days") | Only the words decide. Any leftover or unaccounted word asks. The model's own window is `model-chosen` and recorded beside the person's (the time design's § 7.3). |
| A model proposal that invents a quote, a value, or hides a restriction | Verbatim quote check; the grammar's agreement; spans, leftovers and unaccounted words computed by the library; never `said` (§ 7.4). |
| A restriction written without any time word | The complete-meaning rule: a word nothing accounts for asks (§ 8.6). |
| A wrong reading that passes every check | The confirmation shows the executable scope before the read (§ 8.4); the window line shows what was read (§ 9). The corpus grows with each found case. |
| A tool declaring words or shapes it does not honour | A declaration is a fact the tool owns, as `direction` is. Over-declaring words can only turn questions into reads for that tool; the result checks (`period-differs-from-asked`) still compare what was read with what was asked. |
| Long or hostile text (slow regular expressions, huge input) | The scan and the rule are linear, with no backtracking pattern; the reader keeps `MAX_MENTIONS`; text past a fixed length is not interpreted and asks. To be pinned by a timing test. |
| The person's words leaking from the record | Quotes, leftovers and unaccounted words are the person's words, as quotes are today. They follow the run's redaction policy, like every row. |
| A third-party reader | No new runtime dependency in v1. An optional adapter loads lazily, at a pinned version. No reader sends text to a server. |

## 12. Migration: the host app

The host app reads a node window today with its own middleware (`policyWindow`) and its word scan
(`host:be-server/timeWords.ts`). The order follows R4.

1. **Move the cases first.** The host app's 269 phrases, the reviewer's four cases, and the 80
   held-out phrases are already in `bench/time/interpretation/` (four rows that named products carry
   generic nouns). They become the library's shared corpus test (§ 13).
2. **Build in the library.** § 6–§ 9, behind the corpus test.
3. **Integrate in the host app, with its checks still on.** The host's tool declares:

   ```ts
   period: { forms: [{ kind: 'lookback', argument: 'window', signed: false }],
             direction: 'past', shapes: ['rolling-lookback'] },
   askOrAssume: { window: { assume: '1h' } },   // the default, recorded as the default
   search: { …, arguments: [{ name: 'names', role: 'population', said: { /* metric → words */ } }, …] },
   // `said` on a population argument is the proposed declaration of § 8.6; it is refused today
   ```

   and keeps `.time({ reader: englishTimeReader() })` armed, as it is today. Its middleware still runs.
   Moving the default to `askOrAssume` gives the library the default to record. It does not let this
   tool read clock or calendar ranges: with only `rolling-lookback`, those are asked (§ 8.1).
4. **Run the host app's own corpus test against the library build.** Every case must pass.
5. **Only then remove** `timeWords.ts` and the middleware's word rules. **Until step 4 passes, the
   host app keeps its checks.**

What the middleware does today, and where each part goes:

| The middleware today | In the library |
|---|---|
| the host's window control sets the bounds | `run({ time: { window } })` (exists) |
| one clean lookback the person wrote replaces the model's window | the fill (exists), after the confirmation (§ 8.4) |
| no time found: the app's window | the `askOrAssume` default, filed `default` (§ 9) |
| any other time: the call is refused | asked before any read (§ 8.2) |
| a sampling instruction beside the lookback is read | asked, unless the tool declares `sampling` (§ 8.5) |
| the model's own bounds beside the person's lookback: refused | recorded `model-chosen` today; refusing it needs the planned opt-in `mismatch: 'refuse'` (TQ6, not built) |
| the person's message is chosen by `isSaidByPerson` | the seed reads only that message (exists) |

One behaviour changes for the host app's people: its rule skips the confirmation for a clean
lookback; the library confirms it (R9). That is the price of v1.

## 13. The shared test corpus

- **Where now:** `bench/time/interpretation/` in this PR: the phrases, the labels, the sampling list,
  the tool profiles, the scripts, the versions, the held-out hash and its lock evidence, and every
  reader's raw output.
- **Where after approval:** `test/time/corpus/` as JSON, run as a test.
- **Two numbers per run:** wrong readings, which must be 0; and unnecessary clarifications, which
  are reported and may not grow.
- **Blind batches, written by someone else:** the current held-out set had one author, who also wrote
  the labels and the prototypes, and the complete-meaning rule came after its first run. Every
  release that changes the reader, the scan, the grammar or the rule adds a new batch, written by a
  different person before the run, fixed by hash and time, and never tuned against after its run.

## 14. Not in this design

- A stated Retry-After has nothing to do with this design. Retry and back-off are not touched here.
- Languages other than English. The scan's vocabulary and the closed classes are data, so a second
  language is a table.
- Recurrence filters, event windows and complements that a tool could honour. They are named as
  shapes, not built.
- Calendar parts of a day ("yesterday morning"). They stay unreadable and asked, as today.
- Restrictions on what is read when no time is named ("memory per node, restricted to backup runs").
  The rule here runs when a time request is found. The same rule for every argument the person's
  words fill is a candidate for the arguments layer.

## 15. Decisions

**Decided by the review (2026-10-28 follow-up):**

1. **Confirmation in v1:** kept. No skipping the confirmation for a clean lookback (§ 8.4).
2. **Sampling:** accepted only when the tool declares and executes it; otherwise asked (§ 8.5).
3. **H23 and dropped conditions:** not an acceptable limit. Rejected structurally by the
   complete-meaning rule, not by adding phrases (§ 8.6).
4. **Recognizers-Text:** not in v1 (§ 7.2).
5. **`shapes` absent:** derived from `forms`, byte-identical to today (§ 8.1).
6. **`how: 'default'`:** recorded, with no claim that the person named no time (§ 9).
7. **The host app's default to `askOrAssume`:** reasonable, after approval. It does not make a
   lookback-only tool read clock or calendar ranges (§ 8.1, § 12).
8. **The harness:** in this PR, before approval (§ 13).

**Still open for the owner:**

1. **v2: may one shape skip the confirmation?** Only on evidence: an independently written held-out
   set with zero wrong readings, and the complete-meaning rule in use.
2. **The closed classes.** Who reviews their content (function words, request frame, operations on
   the result), and how a change to them is gated.
3. **The vocabulary declaration.** `said` on population values, `words` and `identifiers` on
   population arguments (§ 8.6): this shape, or another?
4. **The clause.** Keep the whole message as the clause in v1, at the measured cost in questions?
5. **The next held-out set.** Who writes it, and when.

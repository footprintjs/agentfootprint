# Time interpretation — the whole meaning of a person's time words, before any read

**Design under review — not approved for implementation.** Nothing in this page is built.
Approval to review it is not approval to implement it. First written 2026-10-28; revised three
times on 2026-10-29 to answer the reviews of PR #230 (each verdict: changes required). It extends
the time layer ([time/README.md](time/README.md), [src/time/](../../src/time/README.md)); it is not
a second one. The measurement behind it is
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
3. **What we measured.** Five readers on 274 phrases from the host app's corpus and the reviewer, on
   80 phrases written before any reader ran, and on 22 cases an independent review wrote. Plugged in
   as a value, every reader reads a wrong window or scope on 54–66 of the 80. With the rule of this
   page, no reader makes a wrong reading on any of the three sets. The rule was revised after each
   review, so its numbers are not blind (§ 13).
4. **What this page proposes.**
   - The reader's result grows into a `TimeInterpretation`: what the person **requested**, as
     interpreted.
   - Tools declare the time shapes they read, whether they execute sampling or read the current
     state, and the words for what they read.
   - **The complete-meaning rule**, as bounded interpretation: every word of the request must sit in a
     relation the tool can execute, or the person is asked before any read. It does not prove that a
     meaning is complete.
   - The confirmation stays in v1. It shows the whole executable scope, and it is **bound** to the
     call that runs: if anything changes before dispatch, the person is asked again. Reading the
     next page of the same scope is proposed not to count as a change (§ 8.4, § 15).
   - The **requested** window and the **executed** window are separate fields everywhere. The answer
     shows the executed bounds from the record, and says when they differ from the request.
   - The host app's phrases become the library's shared test corpus. The harness is in this PR.
5. **Decisions.** § 15 lists what the reviews decided, what the third review settled, the owner's
   proposed answers to the rest, a `continuation` role proposed for review, and what the build must
   keep.

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

The library already refuses to let a reading stand as the person's words: "Always confirm" (time
design TQ29) offers every reading in the time ask first. That costs one click per time phrase,
"last 2 hours" included. The host app wanted lookbacks read without the click. So it reads them
itself, in a tool middleware, and guards the read with a word scan
(`host:be-server/timeWords.ts`, 460 lines).

That guard cannot be finished:

- **It leaks on new wording.** The rule as measured, at the host app's commit `0d52b9b`
  (2026-10-28), read none of the 274 phrases wrong for their window. On the 80 held-out phrases it
  read 3 wrong: an event anchor ("of the outage"), an approximation after a comma ("maybe a little
  more"), and a condition with no time word ("restricted to backup runs"). The reviewer reports that
  the host app's current rule refuses those three. That is the list growing by three more phrases,
  which is the point: each round adds what the last round missed.
- **No list of time words sees a condition with no time word.** Every reader that can read a
  lookback read the 2 hours there, even behind the scan. Adding "restricted to" to a list fixes that
  phrase, not the next one.
- **Knowing every word is not knowing the request.** "over the last 2 hours at CPU peaks" holds only
  known words. What it asks for is a relation between them, an event filter, that no lookback tool
  executes.
- **A list passes the corpus it was tuned on, by construction.** Its own tests cannot show it is
  right.
- **Every app writes it again.** Two owners of one grammar drift. That is the time layer's first
  law.

The fix is not a longer list. It is to turn the question around: accept only relations the tool can
execute, ask about everything else (§ 8.6), and show the person exactly what will run (§ 8.4).

## 2. What exists, and what this design extends

| Seam | Today | This design |
|---|---|---|
| `time/reader.ts · TimeReader`, `TimeMention`, `TimeParts`, `checkReading` | the port: quote + parts, checked for shape | the reader may add offsets and structure; the library computes the rest (§ 6) |
| `time/readers/english.ts · englishTimeReader` | a closed tokenizer; "unreadable" for the rest | reads the closed lookback grammar with fractions and number words, and returns offsets (§ 7.1) |
| `core/agent/stages/timeLayer.ts · readTimeWords` | runs the reader once per message, at the seed | also runs `interpret` and files the requested side |
| `time/rowsBuild.ts · timeReadingRows`, `time/rows.ts · TimeReadingRow` | one `time-reading` row per mention; the "Always confirm" law lives here | the rows carry the interpretation; the law is unchanged |
| `lib/saidByPerson.ts · isSaidByPerson` | the one gate for which message a person wrote | unchanged: only that message is read |
| `tools/declare.ts · ToolPeriod`, `periodRule` | a period's forms and facts; every period argument carries an `askOrAssume` rule | gains `shapes` and `sampling` (§ 8.1) |
| `semantics/coverage/search/types.ts · ToolSearch`, `SearchArgument` | the search's words: `source.said`, `subject.said`, `fixed[].said`, and `said` on filter and source values | the rule reads them; population arguments gain words; an explicit `inert` role is the only thing that keeps an argument out of the scope digest (§ 8.4, § 8.6) |
| `time/windows.ts · isOpenForPerson` | a reading waits on the person: to confirm, a zone, words not read | also open: leftovers, a modifier, a recurrence, an event, an unsupported shape, an unaccounted word or relation |
| `time/bind.ts · callWindowOf`, `time/rows.ts · CallWindowRow` | which window a call carries (`person`, `asked`, `sent`); refuses what no form holds | names the requested and the executed window as separate fields; records the default (§ 9) |
| `core/agent/arguments/ask.ts · planAskFields`, `stages/argumentAsk.ts · windowPlanOf`, `tools/inputRequest.ts · applyInputResponse` | the one batch ask before dispatch, and its resume door | the confirmation of each call's scope rides this ask; no second approval path (§ 8.4) |
| `time/rows.ts · TimeAnswerRow`, `answersOf`, `time/windows.ts · turnWindowsOf` | the person's answer to a mention, reused by mention | the answer also carries the digest of each scope confirmed; reuse is by digest (§ 8.4) |
| `core/agent/stages/timeLayer.ts · timeAtDispatch` | the clock at dispatch; redraws the library's own lookback fill | also checks each call's scope digest against the confirmed one; a change asks again (§ 8.4) |
| `core/agent/arguments/resolve.ts · verifyPlan`, `timeDecisionsOf` | routes open readings to the batch ask, before dispatch | unchanged route; more readings are open |
| `time/readingAsk.ts · timeAskOf`, `time/ask.ts · checkTimeAnswer` | builds and judges the time field | the confirmation names the executable scope; new choices per unsupported shape (§ 8.3, § 8.4) |
| `time/convert.ts · convertForTool` | the one answer to "can this tool read this window" | unchanged |
| `semantics/coverage/period.ts · periodLine`, `semantics/coverage/timeLimits.ts · timeLimitLinesOf` | lines about what a call queried, rendered in the person's zone | requested, sent and tool-declared periods are three lines, never merged (§ 9) |

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
- **ThoughtSpot.** A closed keyword grammar ("last n days", "n days ago", "before", "between … and
  …", "for each"). Its `last` returns the last n full periods and excludes the current one. The
  search bar draws a box around each recognised phrase, and an ambiguous term is settled by picking
  from a list.

Two lessons follow. No reader we measured sees a complement or an event condition. And "last N" is
not one thing: a rolling window in Recognizers, but whole periods that leave out the current one in
Duckling (clock hours) and in ThoughtSpot's documented `last`.

## 4. The measurement, in short

Three sets, reported apart. The expected outcome is the meaning label of the whole request, except
that a sampling instruction or a request for the current state asks, because the measured tool
declares neither.

| Reader | Rule | Held-out (80) wrong / unnecessary / exact | Existing (274) | Review cases (16 scored) |
|---|---|---|---|---|
| any of the five | the value as the window | 54–66 wrong | 165–236 wrong | 15–16 wrong |
| library grammar (prototype) | strict + agree | 1 / 0 / 17 | 0 / 15 / 77 | 11 / 0 / 1 |
| library grammar (prototype) | **complete meaning** | **0** / 8 / 9 | **0** / 22 / 70 | **0** / 0 / 1 |
| library grammar (prototype) | complete meaning, held-out nouns declared | **0** / 0 / 17 | **0** / 22 / 70 | **0** / 0 / 1 |
| `englishTimeReader` (today) | complete meaning | **0** / 11 / 6 | **0** / 49 / 43 | **0** / 0 / 1 |
| Recognizers-Text | complete meaning | **0** / 10 / 8 | **0** / 50 / 45 | **0** / 0 / 1 |
| Duckling | complete meaning | 0 / 15 / 5 | 0 / 79 / 17 | 0 / 1 / 0 |
| chrono-node | complete meaning | 0 / 18 / 0 | 0 / 95 / 0 | 0 / 1 / 0 |
| the host app's rule at its commit `0d52b9b` (2026-10-28), a historical baseline | its own | 9 / 7 / 10 | 17 / 43 / 48 | 14 / 0 / 1 |

- **H23** ("over the last 2 hours, restricted to backup runs") asks: "restricted", "to", "backup"
  and "runs" sit in no relation the tool executes.
- **The review's cases** ("at CPU peaks", "with CPU spikes", "only at CPU peaks", "on CPU spikes",
  "requests > errors", "CPU spikes" alone, "right now") all ask now. Before this revision, under the
  richer profile, the rule read or defaulted eleven of them. Six target cases ("only node 8", "my node") depend on which target the call
  binds; a window-only score cannot judge them, so they are reported and bound by the confirmation
  (§ 8.4).
- **The grammar's 8 held-out questions** are metrics the measured tool did not declare. With them
  declared there are none.
- **The host app's rule, as measured** at its commit `0d52b9b` (2026-10-28), had three real held-out
  misses, and reads or defaults sampling and current-state requests, which are right only if its
  tool executes them. The reviewer reports that the host app's current rule refuses those three
  cases. This bench did not rerun against it; the row is a historical baseline, not a claim about
  the host app's accuracy today.
- Duckling and chrono reach zero by asking almost everything.

The full tables, the method and its limits are in the
[measurement page](2026-10-time-interpretation-measurement.md).

## 5. The reviewers' requirements

R1–R8 came with the first review, R9–R14 with its follow-up, and R15–R16 with the third review. Each
says how it is met and how it is tested.

**R1. What the parser keeps.** The person's original time words (quoted, with their place), the
interpreted scope, and every restriction it could not interpret. A structured object from a model
proves nothing on its own.
- *Met by:* `TimeInterpretation` (§ 6) keeps each mention's quote and span, kind, modifiers,
  recurrence and event, and the turn's leftovers. Each call's row keeps the words and relations the
  rule could not account for (§ 8.6). The library computes spans, leftovers and unaccounted words
  itself; it never takes them from the reader. A model's reading is checked against the person's
  words and the declared shapes (§ 7.4).
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
  the executed bounds and zone (§ 9). The window line is rendered by code from those rows.
- *Tested by:* a run where the model's prose names another window; the delivered line still equals
  the rows.

**R4. Migration order.** The host app's regression cases move into the library's tests first. The
host app removes its own phrase checks only after the library's implementation is integrated into
the host app and passes those same cases. Until then the host app keeps its checks.
- *Met by:* § 12, in that order.
- *Tested by:* the host app's corpus test runs against the library build before any deletion is
  merged.

**R5. Reuse the existing machinery.** The design extends the `TimeReader`, the period declarations,
the search declaration and the time ask. It is not a parallel system.
- *Met by:* every change in § 2 lands on an existing seam, the confirmation included. The new
  modules are leaves under `time/`.
- *Tested by:* the layering check: `time/` stays a leaf; no second ask or approval path exists.

**R6. Score the complete meaning.** "outside the last two hours" read as "the last two hours" is a
wrong reading.
- *Met by:* the corpus labels the whole request (reads *N*, ask, none), never the fragment.
- *Tested by:* the corpus test fails on any read whose expected outcome is ask.

**R7. Unseen cases.** A held-out set of at least 60 new phrases, written before any run and fixed by
a hash and a time, across every class, reported apart.
- *Met by:* 80 phrases in 11 classes, fixed at 2026-10-28T23:33:15Z (SHA-256 `caec788a…`). Its first
  run was blind. One person wrote the set, the labels and the prototypes, and the rule was revised
  after the first run and again after the third review, so later rounds are not blind (§ 13).
- *Tested by:* the next set is written by a fresh author who has not seen the rules, the scan or
  the grammar (a fresh agent given only the task description), fixed the same way, before it is run.

**R8. Two numbers, never merged.** Wrong readings and unnecessary clarifications are counted apart.
- *Met by:* every table here and in the measurement page.
- *Tested by:* the corpus test gates on wrong readings (0) and reports clarifications as a separate
  number that may not grow.

**R9. Confirmation stays in v1, and it confirms the executable scope.** A window-only confirmation
does not confirm that no event filter was dropped.
- *Met by:* § 8.4. "Always confirm" (TQ29) is unchanged. The confirmation names the tool, the
  requested window, the executed bounds and zone, the scope-bearing arguments, the sampling, and
  "no other condition".
- *Tested by:* for every corpus phrase that reads, the call is preceded by a `time-answer` row whose
  digest equals the call's.

**R10. Sampling only when the tool declares and executes it.** Recognising the words is not enough.
- *Met by:* `ToolPeriod.sampling` (§ 8.5). Without it, a sampling instruction is an unaccounted word,
  and the request asks.
- *Tested by:* the 18 + 7 sampling phrases ask under a tool with no sampling; with a sampling tool,
  the step reaches the call's arguments, its digest and its row.

**R11. Complete meaning, as bounded interpretation.** The clause carrying the time request must be
fully accounted for: the accepted lookback, the terms the tool declares, and closed function words,
each in a relation the tool can execute. Any remaining word, operator or relation is unresolved, and
the request asks.
- *Met by:* § 8.6, with how the clause is found, how a tool declares its words, and the closed set
  of relations. It is described as bounded interpretation: it does not prove complete meaning.
- *Tested by:* both frozen sets (H23 asks); the review's regression cases, reported apart; a property
  test that inserting any word, symbol or unsupported relation into an accepted request makes it ask.

**R12. A default is recorded as a default.** The record says that the default was applied, never
that the person named no time: the reader can miss a time request.
- *Met by:* § 9.
- *Tested by:* no row or answer line for a default contains a statement about what the person said.

**R13. A lookback-only tool does not read exact calendar ranges.** Where its default is declared
changes nothing about that. Only a tool that declares and executes a range or day shape can.
- *Met by:* § 8.1 and § 12. For a lookback-only tool, a calendar or clock range is asked; a wider
  lookback is offered only as an explicit choice.
- *Tested by:* "yesterday" and "from 8 to 9" to a lookback-only tool ask, and never fill.

**R14. The harness travels with the design, before approval.** Anonymised scripts, labels, versions,
hashes and raw results.
- *Met by:* [bench/time/interpretation/](../../bench/time/interpretation/README.md). The host app's
  private module is not in it; the reference row that needs it is described there.
- *Tested by:* `--duckling-replay` re-scores the committed raw results to identical records.

**R15. The confirmation is bound to what executes.** What the person confirms is exactly what runs:
one call or an enumerated batch, its tool and declaration version, every argument the call sends, its
executed bounds and zone, its sampling. If anything changes before dispatch, the person is asked
again, or the call is refused. It never proceeds silently.
- *Met by:* the scope digest (§ 8.4), filed on the existing `time-answer` row and checked at dispatch
  in `timeLayer.ts · timeAtDispatch`. **Every argument is scope-bearing by default:** the digest
  covers every argument the call sends, except those the app's local declaration marks `inert`, or
  `continuation` (a page number, cursor or offset that selects a slice of the same scope; proposed,
  for review). A tool
  with no `Tool.search` binds all of its arguments, and an argument a declaration leaves out stays
  bound. That does not relax today's validation: `tools/searchOf.ts · searchOf` still refuses a
  partial declaration (§ 8.4, requirements for the build). Retry and resume reuse a confirmation
  only for an identical digest.
- *Tested by:* the bench's acceptance set, run as code
  (`bench/time/interpretation/scripts/acceptance.mjs`, `npm run acceptance`): a tool with no
  `Tool.search`, a confirmed call, then its customer or node argument changes before dispatch → the
  batch ask fires again; the same argument marked `inert` → no re-ask; a partial declaration that
  leaves an argument out → that argument still binds; a changed sampling step, a different tool, a
  new declaration version, moved bounds, a call added to a confirmed batch, an identical retry, a
  changed call with no one to ask (refused), and an argument named `__proto__`, parsed from JSON,
  whose change asks again. With a page argument the app's local declaration marks `continuation`:
  page 2 of a confirmed call runs; page 2 with a changed customer asks again; the same mark from a
  remote declaration is ignored, not refused, so a page change asks again; and without the role, a
  page change asks again. **Batch membership is tested only as a digest change:** the real batch
  ask and its resume are future implementation work, not measured behaviour. In the library, the
  same cases through the batch ask, plus a resume and the long-pause test (§ 8.4).

**R16. The requested window and the executed window are separate, everywhere.** In the
interpretation, the record, the confirmation and the answer.
- *Met by:* § 6 (the interpretation holds only the request), § 8.4 (the confirmation shows both),
  § 9 (the record and the answer keep requested, sent and tool-declared periods apart, and say when
  they differ).
- *Tested by:* a default, a confirmed lookback, a widened fill, a drifted lookback and a tool that
  declares no period each render the three parts as recorded, never one as another.

## 6. The port — `TimeInterpretation`

The reader stays the adapter. The library turns its reading into one checked interpretation per
message, modelled on TIMEX3. **It is the requested side only.** It holds what the person's words
ask for, never the bounds a call will send.

```ts
/** What ONE message a person wrote REQUESTS, as interpreted. Filed with the turn's
 *  time-reading rows. Never built from a reader's say-so alone; never holds executed bounds. */
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
  /** TIMEX3 DATE/TIME → 'point'; a range; DURATION; SET → 'recurrence'; the present → 'current'. */
  readonly kind: 'point' | 'range' | 'duration' | 'recurrence' | 'current';
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
   *  recurrence, comparison, position, present, scope, range, or the slot before a mention. */
  readonly class: LeftoverClass;
}
```

**Rules.**
- A reader returns what it can. The library fills the rest. `time/interpret.ts · interpret` (new, a
  leaf) locates each quote, runs the leftover scan, reads modifiers, recurrence and events from the
  words around each mention, and asks the grammar for its own reading.
- **The scan and the rule can only add asks.** They never make a read.
- The interpretation is per message. The complete-meaning rule is per call, because it reads the
  tool's declared words; its result goes on the call's `call-window` row as `unaccounted` (the words
  and relations, with the declaration's version).
- The executed side lives on the call's row (§ 9), never here.
- The port grows additively. `TimeMention` may carry `at` (the quote's offset) and `TimeParts` may
  carry `mod` and `every`, so an adapter like Recognizers can report what it sees. `checkReading`
  checks them for shape. The library never relies on them for safety.

## 7. Adapters behind the port

### 7.1 The default: `englishTimeReader`, extended

It is the measured winner. It has no dependency, works in the browser (4.9 KB gzip for the
prototype), and runs in tens of microseconds. Under the complete-meaning rule it made no wrong
reading on any set, and the most exact reads of any reader. Changes:

- read the closed lookback grammar: `[the] last | past | trailing | latest | most recent`, an exact
  amount, a unit. The amount may be digits, a decimal, a vulgar fraction, number words, "half an",
  "a quarter of an", "… and a half", or "1 hour 30 minutes". "a couple of", "a few", "several" and
  "previous" stay out;
- return the quote's offset;
- raise `ENGLISH_TIME_READER_VERSION`, because what it returns changes.

Everything it reads still goes through `resolve.ts` and the confirmation, as today.

### 7.2 Optional: Recognizers-Text, not in v1

It is the only external reader that reports structure: `set` for "each hour", `mod` for "since" and
"before". But on our phrases it does not earn its cost:

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

A proposal that fails any check becomes an open mention, asked with nothing pre-filled. No model was
called for this design.

## 8. What a tool declares, and what the library decides

### 8.1 The declaration

`ToolPeriod` (`tools/declare.ts`) gains optional facts:

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
| `current` | the current state ("right now", "at the moment"): the tool reads what its declaration says it selects | yes, when declared |
| `recurrence-filter`, `event-window`, `complement` | a tool that can keep part of a window | named, not built |

- **Compatibility, narrowly.** When `shapes` is absent it is derived from `forms`, so an existing
  declaration keeps its capabilities. That is all it keeps. The extended reader, the clarification
  rules, the bound confirmation and the default records change what an app observes. This design is
  not byte-identical for an app that arms `.time()`; an app that does not arm it is unaffected.
- **A request for the current state is a time request.** "right now", "currently", "at the moment"
  are never read as "no time" and never fall to the default window. A tool that declares `current`
  must say what it selects, in words the confirmation and the answer show:
  `shapes: ['current'], current: { selects: 'the latest stored sample per node, which may be up to
  one cadence stale' }`. "Latest" is never promised fresh. Any other tool asks.
- **A lookback-only tool does not read exact calendar or clock ranges.** "yesterday", "from 8 to 9"
  or "this week" to a tool whose only shape is `rolling-lookback` are asked. Where the tool's default
  is declared changes nothing about that. Only a tool that declares and executes a `range` or `day`
  shape (a `bounds`, `joined`, `object` or `day` form) reads them exactly. Any wider alternative is
  offered only as an explicit choice (§ 8.3), never filled.
- Declared shapes are checked at definition like `direction`, and travel over MCP in
  `_meta.agentfootprint.period` (`mcp/toolExtras.ts · readToolExtras`).

### 8.2 The decision, before any read

| The request | A tool that declares the shape | A tool that does not |
|---|---|---|
| one mention of a supported shape, nothing left over, every word in a supported relation | offered in the bound confirmation (§ 8.4), then filled exactly | asked, with the readable alternative as an explicit choice |
| a modifier, recurrence, event or complement | asked | asked |
| any leftover, or any word, symbol or relation the rule cannot account for | asked | asked |
| a sampling instruction | read with the sampling only if the tool declares `sampling`; otherwise asked | asked |
| a request for the current state | read as the latest values only if the tool declares `current`; otherwise asked | asked |
| two or more mentions | the model binds by quote (the time design's § 5.6) | asked |
| no time request found | the tool's own `askOrAssume` default, recorded as the default (§ 9) | the same |

"Asked" is today's batch ask: one ask before anything in the batch dispatches
(`arguments/ask.ts · planAskFields`, `stages/argumentAsk.ts · windowPlanOf`). A tool with no period is
not affected.

### 8.3 The ask offers choices where it can

| Unsupported because | The ask |
|---|---|
| a complement ("outside the last 2 hours") | no choice can be right. Free entry: "This search reads one window ending now, like 'the last 6 hours'. Which window should it read?" |
| a recurrence ("of each hour"), a condition ("only while backups ran", "at CPU peaks") or an unaccounted restriction ("restricted to backup runs") | free entry, naming what the tool cannot do: "It cannot keep only the times when CPU peaked." |
| an approximation ("about the last 3 hours") | the exact core as one choice: "the last 3 hours", and free entry |
| a range or a day, to a lookback-only tool | the covering lookback as one labelled choice ("the last 34 hours, which includes all of yesterday"), and free entry. Never filled without that choice. |
| a sampling instruction, to a tool with no `sampling` | the window without the sampling as one labelled choice ("the last 2 hours, every reading — the tool cannot sample every 5 minutes"), and free entry |
| the current state, to a tool with no `current` | a short lookback as one labelled choice ("the last 15 minutes"), and free entry |
| words no reader read | free entry, as today (`arguments/serve.ts · unreadSentence`) |

The sentences are new keys in the ask catalog (`src/locales/timeAsk.ts`), which the app may override,
as every ask sentence may (TQ7). The answer is judged by `checkTimeAnswer`, as today.

### 8.4 The confirmation, bound to the call that runs

"Always confirm" (TQ29) is unchanged in v1. Every reading of a person's time words is confirmed
before the first call that needs it, a clean "last 2 hours" included. A finite corpus, passed, does
not show that arbitrary wording is understood: a frozen test set passing is necessary, not
sufficient. Skipping the confirmation for one shape is a question for v2 (§ 15), and v2 needs an
independently written held-out set and field use.

**What is confirmed.** One call, or an enumerated batch of calls, each shown with:

- the tool, by name;
- the **requested** window: the person's words and how they were read ("your words: 'the last 2
  hours'");
- the **executed** window: the bounds and zone the call will send ("07:30–09:30 UTC");
- every argument the call sends, in the tool's declared words where it has them, plus the sampling
  step. **Every argument is scope-bearing by default.** Only an argument the app's local declaration
  marks `inert` (`Tool.search` · `role: 'inert'`: it changes the bytes, not the ground) or
  `continuation` (a page of the same scope, below) is left out. A tool with no `Tool.search` binds
  all of its arguments, and an argument a declaration leaves out stays bound. The default makes a
  missing declaration safe; it does not make a partial one acceptable (requirements for the build,
  below);
- "no other condition".

> I will read **memory per node** on **node 8**, sent as **07:30–09:30 UTC** (your words: "the last
> 2 hours"), every reading in that window, with no other condition. Is that what you meant?

The text is rendered from the planned call and the tool's declared words, never from the model's
prose. It rides the existing batch ask (`arguments/ask.ts · planAskFields`, `requestInput`) and its
resume door (`tools/inputRequest.ts · applyInputResponse`). There is no second approval system.
The confirmation names the scope. It never promises that every page will be read: that stays a
coverage fact, which the answer reports.

**How it is bound.** Each confirmed call gets a **scope digest**: SHA-256 over a canonical JSON of
the tool name, the tool's declaration version (a hash of its `period` and `search` declarations),
every bound argument as it will be sent (all but those the app's local declaration marks `inert` or
`continuation`), the executed bounds and zone, the sampling step (whatever role its argument
carries), and the requested mention. The arguments are read from the call's own enumerable keys,
each value from its own data property, into a null-prototype record: an argument named `__proto__`
is valid JSON and is bound like any other. Only JSON data is bound: a call carrying anything else
(an accessor, a function, a `Date`, a non-finite number) is refused, never bound by a stand-in
another value would share. The executed bounds in the digest are the asked range at the
confirmation's clock: the turn's clock for the first confirmation, the moment of the person's answer
for a re-ask after a pause. A dispatch within the tool's step of that clock keeps the digest; past
the step, the bounds are recomputed and the digest changes (the time design's drift law decides
which). A batch's digest also covers its list of call digests, in order. The person's answer is
filed on the existing `time-answer` row, which gains the confirmed digests and the clock each is
anchored at (`time/rows.ts · TimeAnswerRow`).

**A page of the same scope keeps the confirmation (proposed, for review).** An argument the app's
local declaration marks `continuation` (a page number, a cursor or an offset) selects a slice of the
same confirmed scope, so it is left out of the digest: page 2 of a confirmed call runs without a new
question. The exclusion holds only while every other bound argument is identical, which the digest
itself enforces: a changed page together with any other change is a new digest, and asks again.
Following a cursor the tool returned is the expected use. A page number the model chose runs under
the same rule, since the scope is unchanged. Only a local declaration can mark it, as with `inert`:
a remote declaration's `continuation` is ignored by the binding, not refused, so that argument stays
bound and a page change asks again. The confirmation covers the scope, never completeness. Whether
every page was read stays a coverage fact, filed by the results layer (coverage reads
`continuation` as `page`, with its `paged` gaps), and the confirmation never implies it. A tool
whose page argument the app cannot vouch for declares it `page`, which stays bound.

**Checked at dispatch.** In `core/agent/stages/timeLayer.ts · timeAtDispatch`, before each call
runs, the library recomputes the digest from the call it is about to send:

| At dispatch | What happens |
|---|---|
| the digest equals a confirmed digest | the call runs |
| only an argument the app's local declaration marks `continuation` changed (page 2, a cursor the tool returned, an offset) | the call runs: it reads a slice of the confirmed scope. Whether every page was read stays a coverage fact. |
| a different tool, a new declaration version, an argument added, removed or changed (any but a local `continuation`), a different sampling step, a different zone | the call does not run. It goes back to the batch ask with the new scope, and the person confirms again. |
| a call added to or removed from a confirmed batch | the whole batch is asked again |
| the executed bounds moved past the tool's step since the confirmation (a lookback-only tool after a pause) | asked again, once, showing the new bounds; the dispatch that follows the answer runs (requirement 3 below). Today this runs and is recorded `shifted`; under this design it asks. A tool with an absolute form keeps the confirmed bounds (today's drift law), so its digest does not change. |
| nobody can be asked (a composed run, a host with no ask surface) | the call is refused, naming what changed |

Nothing proceeds silently.

**Run as code.** The bench's acceptance set (`bench/time/interpretation/scripts/acceptance.mjs`,
`npm run acceptance`) runs this law on a prototype of the digest: a tool with no `Tool.search`
whose customer or node argument changes before dispatch asks again; the same argument marked
`inert` does not; a partial declaration still binds what it left out; a changed sampling step, tool,
declaration version or bounds asks again; a call added to a batch is a new batch; an identical
retry runs; with no one to ask, a changed call is refused; an argument named `__proto__`, parsed
from JSON, is bound, so a changed value asks again (a review found the first prototype dropped it);
a call carrying anything but JSON data is refused, and no getter runs. With a local `continuation`:
page 2 of a confirmed call runs, as does a cursor the tool returned; page 2 with a changed customer,
node or bounds asks again; a remote declaration's `continuation` (or `inert`) is ignored, not
refused, so the argument stays bound; and a page argument declared `page`, or not declared, asks
again on a page change.
**Batch membership is tested only as a digest change.** The real batch ask and its resume
(`planAskFields`, `applyInputResponse`) are future implementation work, not measured behaviour; so
are the hidden inputs and the long-pause re-ask below.

**Reuse.** A confirmation is reused only for a call whose digest equals a confirmed one: the same
call retried after an error (`resumeOnError`), the same call after a resume (`Agent.resume` keeps
the turn's frozen clock), or a later call of the same turn with the identical scope, the next page
of a local `continuation` included. A changed call is a new question. A confirmation never carries
into the next turn. `answersOf` and `turnWindowsOf` reuse answers by digest, not by mention alone.

**Requirements for the build.** The review of the binding prototype names boundaries the
implementation must keep (1–4); the fifth comes with the proposed `continuation` role. None is built
or measured here.

1. **`Tool.search` validation is not relaxed.** The digest's default makes a tool with no
   declaration safe to confirm; it is not a fallback that accepts a partial one. `defineTool`, the
   MCP ingest and `tools/searchOf.ts · searchOf` keep refusing a declaration that leaves an input
   property unclassified (`semantics/coverage/search/declaration.ts · assertToolSearch`,
   `unclassified-argument`), because every coverage claim is built from it. No coverage claim rests
   on the binding's default. And `inert` and `continuation` are honoured only from a declaration
   `searchOf` accepted for a local tool: a remote one (over MCP, or from a `ToolProvider`)
   establishes nothing for coverage, so it cannot take an argument out of the binding either. Its
   marks are ignored, not refused.
2. **Hidden scope-bearing inputs stay bound; their values are never shown.** An argument the host
   fills (`tools/hostFilled.ts`: `fromIdentity`, `fromCredential`) is filled inside `execute`, after
   `timeAtDispatch`, so the model's arguments alone leave it out. The digest binds what the fill
   stands for: the identity value (the tenant, the principal) and, for a credential, the declaration
   it is filled from (service, scopes, mode). Never the secret, so a refreshed token is not a new
   scope. The confirmation names such an input by a safe label ("your organisation's account, from
   your sign-in"), never by its value.
3. **A long pause asks once, then runs.** The re-ask shows the person's words with the time they
   were said, and the bounds the call would now send: "the 2 hours before the call runs, about
   12:10–14:10 UTC (your words at 09:30: 'the last 2 hours')". Its confirmation is anchored at the
   moment of the person's answer and filed with the digest on its `time-answer` row. At dispatch,
   drift is measured from the newest confirmation of that call, never from the turn's frozen clock,
   which would put a re-confirmed lookback past the step at every dispatch and ask the person
   without end. Each pause costs at most one question. Pinned by a test: confirm, pause past the
   step, re-ask, confirm the new bounds (once promptly, once slower than the step), and the call
   dispatches exactly once, with those bounds.
4. **Own keys, JSON data only.** The digest reads the call's own enumerable arguments, values from
   own data properties, into a null-prototype record, as the bench's prototype now does
   (`scripts/binding.mjs · scopeOf`). An argument named `__proto__` is bound like any other. A call
   carrying anything but JSON data is refused. The model's arguments are parsed JSON; the build must
   check that every value the library itself writes into a call (a redrawn window, a filled answer)
   is JSON data too.
5. **`continuation` reads as `page` everywhere else** (if § 15 item 18 is accepted). The role joins
   the closed set (`semantics/coverage/search/types.ts · SearchRole`, and
   `declaration.ts · SEARCH_ROLES`), and every reader of `page` reads it the same way: the facet
   composer (it names no ground), `semantics/coverage/search/gaps.ts · pagingGaps` (the `paged`
   completeness gaps) and the negative-claim reading key (`integrity/negative-claim/readings.ts`,
   where the page is part of a reading). Declaring `continuation` never removes a coverage fact.

### 8.5 Sampling: only when the tool executes it

A sampling instruction ("every 5 minutes", "per hour", "at 5-minute intervals", "sampled hourly")
says how finely to read inside the window. Recognising those words does not apply them. So:

- a tool that executes sampling declares it: `period.sampling: { argument, units }`. The library then
  accounts for the instruction, writes the step into that argument, includes it in the scope digest,
  and records it on the call's row; the confirmation names it;
- a tool that does not declare it gets a question. The instruction is never dropped silently.

No such declaration exists today. The search declaration's roles (`SearchRole`) have no sampling
role; for coverage the step argument would be classified `inert`, and the digest still covers the
sampling step whatever role its argument carries (§ 8.4).

### 8.6 The complete-meaning rule: bounded interpretation

This rule does not prove that a request's meaning is complete. It accepts only a **closed set of
relations** between words it knows, and asks about everything else. Recognising every word is not
enough: "over the last 2 hours at CPU peaks" holds only known words, and its meaning is an event
filter no lookback tool executes.

When one lookback is accepted for a call, **every token of the person's message** must be accounted
for. A token is accounted for when it is:

1. in the accepted lookback, with the "the" and the one lead-in preposition it takes in (in, over,
   for, during, within, across, through, throughout);
2. a term the tool declares for what it reads: a metric, a target or a subject;
3. a number bound to a declared target: an identifier after it ("node 40", "nodes 1-4") or a count
   before it ("two nodes", "a couple of nodes");
4. a preposition in a **supported relation** with an accounted object:

   | Preposition | Its object may be | Example |
   |---|---|---|
   | per, on, for, in, across, between | a target | "per node", "on node 40", "in which cluster" |
   | from | a target, or the lookback | "from the last 2 hours" |
   | of | a metric, the lookback, or a target | "peak of memory", "average of the last 2 hours" |
   | by | a metric | "top two nodes by memory" |

   Any other pairing, such as "at CPU peaks", "with CPU spikes" or "on CPU spikes", relates the read to
   something it cannot execute, so the preposition is not accounted for;
5. a focus particle ("only", "just") directly before a declared term;
6. a word of a closed class, owned and versioned by the library: function words that cannot narrow a
   read (articles and determiners, pronouns, auxiliaries, the question words "what", "which", "who",
   "whose" and "how", and "and"); the request frame ("show", "give", "list", "chart", "please", "look",
   "like", a greeting); a question "when" or "what time" that opens a clause beside the lookback;
7. an **operation on the result** ("peak", "highest", "average", "busiest", "top") only where it binds
   to what is read: followed by "of" and an accounted object, followed by a target ("the busiest
   node", "top two nodes"), or inside a question clause ("when did memory spike", "which one is
   busiest"). "CPU spikes" standing alone binds to nothing the call executes, so it asks;
8. a sampling instruction, only for a tool that declares `sampling`.

**Every other token asks.** That covers a word, a comparison operator (">", "<", "="), and any symbol:
the tokenizer keeps every symbol it does not recognise, so an operator can never vanish. Negations,
quantifiers ("each", "every"), "or", "but", "if", "when", "while", "than", "at", "with" and the
temporal prepositions are in no closed class.

**The clause is the whole message.** Sentence punctuation does not end it, because a restriction can
follow in the next sentence ("… over the last 2 hours. Only while backups ran."). This costs
questions on messages that say two things. A narrower clause would need a parser and a measured
reason.

**What it catches.** H23 ("over the last 2 hours, restricted to backup runs"): "restricted", "to",
"backup" and "runs" are in no relation. The third review's cases: "at CPU peaks" (`at` relates no
target), "with CPU spikes", "only at CPU peaks", "on CPU spikes" (`on` relates a metric), "requests >
errors" (the operator), "CPU spikes" (the operation binds to nothing), "right now" (the current state).

**What it does not decide.** Which target a call binds ("only node 8", "my node", "those nodes") is a
question about the call's arguments, not about words. The rule accepts those words; the bound
confirmation (§ 8.4) shows the person the target the call carries, and its digest holds it.

**What a tool must declare, and what is not declared today.**

| The rule needs | Declared today | Needed |
|---|---|---|
| the words for the store and the subject | `ToolSearch.source.said`, `subject.said` | nothing new |
| the words for a fixed qualifier, a filter value, a source value | `SearchFixed.said`, `SearchArgument.said` (filter and source roles only) | nothing new |
| the words for a **metric or target** a population argument selects ("memory", "node") | no: `said` is refused on population arguments | `said` on population values, and `words` for the argument's own noun |
| that a number after a target noun is that target's identifier ("node 40") | no | `identifiers: true` on that argument |
| which arguments carry **scope** (for the digest) | `SearchArgument.role` | nothing new: every argument by default; only an explicit `inert` opts out, and a missing or partial `Tool.search` binds every argument |
| whether the tool executes **sampling** | no | `period.sampling` (§ 8.5) |
| the **shapes** it reads, `current` included | no (derived from forms) | `period.shapes` (§ 8.1) |
| the closed classes and the relation table | — | library data, versioned like the reader, never tool data |

A tool that declares none of the new words is not broken: its requests that need them ask. With the
vocabulary derived from the existing corpus only, the grammar asked 8 times without need on the
held-out set, every time for a metric the tool did not declare.

## 9. The requested window, the executed window, and the answer

This is the host pilot's group F, the answer contract: what the answer says about a read is rendered
by code from the record. It complements the check before the read; it never replaces it. A person
seldom audits a window line, so the question before the read is the safeguard.

**Three things, never merged.**

| Field | What it is | Where it lives |
|---|---|---|
| **requested** | what the person's words ask for, as interpreted; or the control window; or the tool's default rule | the `time-reading` rows (§ 6); on the call, `call-window` · `requested`: `{ source: 'answered' \| 'control' \| 'default', mention?, quote? }` |
| **executed** | the bounds and zone the runtime fixed and sent, with the form's values and `dispatchedAt` | `call-window` · `executed` (today's `asked`, or `sent` when widened), the `clock` row's zone |
| **declared read** | the period the tool says it queried, attributed to that tool | the result's period row (`queried`), checked against `executed` (`period-differs-from-asked`) |

**The answer line** shows the executed bounds from the record, says where the request came from,
and says what the tool declared, or that it declared nothing:

| On the record | The line |
|---|---|
| confirmed request, tool declares the same period | "Requested: the last 2 hours (your words, confirmed). Sent: 07:30–09:30 UTC. memory_readings declared it read 07:30–09:30 UTC." |
| the default applied, no declaration | "Requested: the app's default hour. Sent: 08:30–09:30 UTC. The tool did not declare the period it read." |
| a widened fill | "Requested: yesterday (confirmed). Sent: 2026-10-26 00:00 – 2026-10-27 09:30 UTC, wider than requested." |
| the tool read less than was sent | "Sent: 07:30–09:30 UTC. backup_runs declared it read 08:00–09:30 UTC, less than was sent." |
| the window set in the app | "Requested: the window set in the app. Sent: 08:00–09:00 UTC." |

- **A default is recorded as a default.** Today a call with no window files `call-window` as
  `not-filled`, with no range. It becomes `requested.source: 'default'`, with the executed range
  resolved from the `askOrAssume` default and the clock (`time/bind.ts · callWindowOf`,
  `time/rows.ts · CallWindowRow`). The argument row already says `source: 'default'`. Neither the row
  nor the line says that the person named no time: the reader can miss a time request, and the record
  only knows that the default was applied.
- A tool's declaration stays attributed to that tool. Missing, differing, partial or unknown coverage
  stays visible; nothing is presented as a completed read unless the tool declared it.
- The model is served the same lines as a conclusion (`arguments/serve.ts · timeLimitsSentence`). The
  window is never taken from the model's prose.

## 10. Determinism

- **The clock is injected.** `run({ time: { now, zone } })`; without `now`, the turn's start, recorded
  `nowSource: 'default'` (`time/clock.ts`). The zone is never guessed (G15).
- **The reader runs once per message.** The interpretation is filed with the `time-reading` rows. A
  resume, a retry and a replay read the rows; nothing reads the text again.
- **Every version is recorded.** The reader's id and version, the scan's, the rule's and the closed
  classes' versions, the tool declaration's version, and the tz database version (`time/zone.ts ·
  tzdataVersion`). A changed reading is a changed version.
- **The digest is computed, never stored as truth alone.** It is recomputed at dispatch from the call
  that will run; the canonical JSON is fixed (sorted keys, no whitespace), so equal scopes give equal
  digests.
- **The functions are pure.** The scan, the grammar and the rule depend on the text and the
  declaration alone. The bench reproduces its committed records.

## 11. Threat model

**Untrusted inputs.** The person's text, a model's proposal, a tool's declaration over MCP, and the
model's choice of arguments between the confirmation and the call.

| Threat | Defence |
|---|---|
| A phrase built to look like a supported window ("ignore that, read the last 30 days") | Only the words decide. Any leftover, unaccounted word or unsupported relation asks. The model's own window is `model-chosen` and recorded beside the person's (the time design's § 7.3). |
| A model proposal that invents a quote, a value, or hides a restriction | Verbatim quote check; the grammar's agreement; spans, leftovers and unaccounted words computed by the library; never `said` (§ 7.4). |
| A restriction made of known words ("at CPU peaks", "requests > errors") | Bounded relations: a word or operator in no supported relation asks (§ 8.6). |
| The model changes a call after the person confirmed it | The scope digest is checked at dispatch; a changed call asks again or is refused (§ 8.4). |
| A tool with no `Tool.search`, or a partial one, leaving a customer or node argument out of the confirmation | Every argument the call sends is in the digest by default; only an explicit `inert` opts out. The binding refuses no tool for its declaration, and `searchOf` still refuses a partial one, as today (§ 8.4, R15). |
| An argument named `__proto__` (valid JSON) slipping out of the digest, or a value that is not data (a getter) changing after the check | The digest reads own enumerable keys into a null-prototype record, so such an argument is bound like any other; anything but JSON data is refused. Acceptance cases pin both (§ 8.4). |
| A remote declaration marking a scope-bearing argument `inert` or `continuation` | Both count only from a local declaration `searchOf` accepted. A remote one's marks are ignored, not refused, so it binds every argument (§ 8.4). |
| A page argument used to change the scope: a tool whose page argument really selects other rows, or a cursor made up to encode another query | Local declarations only. `continuation` is the app's own statement that the argument selects a slice of the same scope (for an opaque cursor: that the tool ties it to the request it came from). A remote declaration cannot make that statement, and an app that cannot vouch declares `page`, which stays bound. Any other change still asks (§ 8.4). |
| A host-filled tenant or credential changing unseen, or shown in the confirmation | Bound by what it stands for, never the secret; shown by a safe label, never its value (§ 8.4). |
| A wrong reading that passes every check | The bound confirmation shows the executable scope before the read; the answer shows requested, sent and declared periods apart (§ 9). The corpus grows with each found case. |
| A tool declaring words or shapes it does not honour | A declaration is a fact the tool owns, as `direction` is. Over-declaring words can only turn questions into reads for that tool; the result checks still compare what was read with what was sent. |
| Long or hostile text (slow regular expressions, huge input) | The scan and the rule are linear, with no backtracking pattern; the reader keeps `MAX_MENTIONS`; text past a fixed length is not interpreted and asks. To be pinned by a timing test. |
| The person's words leaking from the record | Quotes, leftovers and unaccounted words are the person's words, as quotes are today. They follow the run's redaction policy, like every row. The digest holds no text, only a hash. |
| A third-party reader | No new runtime dependency in v1. An optional adapter loads lazily, at a pinned version. No reader sends text to a server. |

**The baseline in this page.** The host app's rule compared against in § 4 and in the measurement
page is the rule at the host app's commit `0d52b9b` (2026-10-28). The reviewer reports that the
host app's current rule refuses the three held-out cases counted against it there ("of the
outage", "restricted to backup runs", "maybe a little more"). This bench did not rerun against the
current rule, which is the host app's side: the comparison is a historical baseline, not a claim
about the host app's accuracy today.

## 12. Migration: the host app

The host app reads a node window today with its own middleware (`policyWindow`) and its word scan
(`host:be-server/timeWords.ts`). The order follows R4.

1. **Move the cases first.** The host app's 269 phrases, the reviewer's four cases, the 80 held-out
   phrases and the review's 22 cases are already in `bench/time/interpretation/` (four rows that named
   products carry generic nouns). They become the library's shared corpus test (§ 13).
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
| one clean lookback the person wrote replaces the model's window | the fill (exists), after the bound confirmation (§ 8.4) |
| no time found: the app's window | the `askOrAssume` default, recorded as the default (§ 9) |
| "right now": the app's window | asked, unless the tool declares `current` (§ 8.1) |
| any other time: the call is refused | asked before any read (§ 8.2) |
| a sampling instruction beside the lookback is read | asked, unless the tool declares `sampling` (§ 8.5) |
| the model's own bounds beside the person's lookback: refused | the digest no longer matches the confirmed scope: asked again, or refused (§ 8.4) |
| the person's message is chosen by `isSaidByPerson` | the seed reads only that message (exists) |

Two behaviours change for the host app's people: its rule skips the confirmation for a clean
lookback, and the library confirms it (R9); and a lookback-only read after a long pause is asked
again, not shifted (§ 8.4). That is the price of v1.

## 13. The shared test corpus

- **Where now:** `bench/time/interpretation/` in this PR: the phrases, the labels, the sampling and
  current-state lists, the tool profiles, the scripts, the versions, the held-out hash and its lock
  evidence, every reader's raw output, and the review's regression cases.
- **Where after approval:** `test/time/corpus/` as JSON, run as a test.
- **Two numbers per run:** wrong readings, which must be 0; and unnecessary clarifications, which are
  reported and may not grow.
- **Regression cases, apart.** Cases a reviewer finds are added to their own set, with that reviewer's
  expectations, and reported separately. They are never merged into a frozen set.
- **Blind batches, written by someone else:** the current held-out set had one author, who also wrote
  the labels and the prototypes. The rule was revised after its first run and again after the third
  review, so neither later round is blind. Every release that changes the reader, the scan, the
  grammar or the rule adds a new batch, written by a fresh author who has not seen the rules, the
  scan or the grammar (a fresh agent given only the task description; the reviewers have seen them,
  so not a reviewer) before the run, fixed by hash and time, and never tuned against after its run.
- **The acceptance set.** The binding law of § 8.4 runs as code in the bench
  (`scripts/acceptance.mjs`), beside the corpus. It runs a prototype of the digest: batch membership
  is tested only as a digest change. The batch ask, its resume, the hidden inputs and the long-pause
  re-ask are tested when they are built.
- **What the score cannot judge.** It compares windows only. Which target a call binds needs the
  call's arguments; those cases are marked `inspect`, and the bound confirmation carries them.

## 14. Not in this design

- A stated Retry-After has nothing to do with this design. Retry and back-off are not touched here.
- Languages other than English. The scan's vocabulary, the closed classes and the relation table are
  data, so a second language is a table.
- Recurrence filters, event windows and complements that a tool could honour. They are named as
  shapes, not built.
- Calendar parts of a day ("yesterday morning"). They stay unreadable and asked, as today.
- Restrictions on what is read when no time is named ("memory per node, restricted to backup runs").
  The rule here runs when a time request is found. The same rule for every argument the person's words
  fill is a candidate for the arguments layer.

## 15. Decisions

**Decided by the reviews:**

1. **Confirmation in v1:** kept. No skipping the confirmation for a clean lookback (§ 8.4).
2. **Sampling:** accepted only when the tool declares and executes it; otherwise asked (§ 8.5).
3. **H23 and dropped conditions:** not an acceptable limit. Asked by bounded interpretation: only
   supported relations are accepted; this is not a proof of complete meaning (§ 8.6).
4. **Recognizers-Text:** not in v1 (§ 7.2).
5. **`shapes` absent:** derived from `forms`, which keeps capabilities; the design as a whole is not
   byte-identical for an app that arms `.time()` (§ 8.1).
6. **The default:** recorded as `requested.source: 'default'`, with no claim that the person named no
   time (§ 9).
7. **The host app's default to `askOrAssume`:** reasonable, after approval. It does not make a
   lookback-only tool read clock or calendar ranges (§ 8.1, § 12).
8. **The harness:** in this PR, before approval (§ 13).
9. **The confirmation is bound** to the call that runs, by a scope digest over every argument the
   call sends (an explicit `inert` opts out; a tool with no `Tool.search` binds everything),
   checked at dispatch; any change asks again or refuses (§ 8.4).
10. **Requested and executed windows** are separate fields in the interpretation, the record, the
    confirmation and the answer (§ 6, § 8.4, § 9).

**Settled by the third review's qualifications:**

11. **No shape skips the confirmation in v1.** A frozen test set passing is necessary, not
    sufficient. v2 may revisit one shape only with an independently written held-out set at zero
    wrong readings **and** field use (§ 8.4).
12. **A tool that declares `current` says what it selects**, in words the confirmation and the
    answer show, such as "the latest stored sample per node, which may be up to one cadence stale".
    "Latest" is never promised fresh (§ 8.1).
13. **The next blind set is written by a fresh author** who has not seen the rules, the scan or the
    grammar: a fresh agent given only the task description. The reviewers have seen them, so not a
    reviewer (§ 13).

**The owner's proposed answers, still under review:** the review of the binding prototype supports
14–17 as design recommendations (14 with fresh tests reported apart from the frozen sets). They
remain the owner's proposals, not approvals.

14. **The closed classes and the relation table** change only by a PR the independent reviewer
    reviews, and such a PR must add no wrong readings on the frozen sets.
15. **The vocabulary declaration** takes the proposed names: `said` on population values, `words` and
    `identifiers` on population arguments (§ 8.6).
16. **The clause** is the whole message in v1, at the measured cost in questions (§ 8.6).
17. **A lookback after a long pause** is asked again, not run and recorded `shifted` (§ 8.4).

**Proposed, for review** (added after the review of the binding prototype; not yet reviewed):

18. **A `continuation` role.** An argument the app's local declaration marks `continuation` (a page
    number, cursor or offset) selects a slice of the same confirmed scope, so it is left out of the
    scope digest. The exclusion holds only while every other bound argument is identical; any other
    change asks again as usual. Following a cursor the tool returned is the expected use; a page
    number the model chose runs under the same rule. Only a local declaration can mark it: a remote
    declaration's mark is ignored by the binding, not refused. Coverage reads it as `page`.
    "Confirmed" covers the scope, never completeness: whether every page was read stays a coverage
    fact, filed by the results layer, and is never implied by the confirmation (§ 8.4).

**Requirements for the eventual build** (§ 8.4), from the review of the binding prototype and, for
24, from item 18:

19. **`Tool.search` validation is not relaxed** by the binding's default. A partial declaration is
    still refused, coverage claims rest on accepted declarations only, and a remote declaration
    cannot mark an argument `inert` or `continuation`.
20. **Hidden scope-bearing inputs stay bound** (host-filled identity and credential arguments, by
    what they stand for, never the secret); the confirmation shows safe labels, never their values.
21. **A long pause asks once, then runs.** A test pins it: confirm, pause past the step, re-ask,
    confirm the new bounds, dispatch exactly once. Reusing the turn's frozen clock must not loop.
22. **The digest reads own keys and JSON data only**, into a null-prototype record; `__proto__` is
    an argument, and anything that is not JSON data is refused.
23. **The batch ask and its resume are built and tested in the library.** The bench tested batch
    membership only as a digest change; that is not measured runtime behaviour.
24. **`continuation` reads as `page` everywhere else**: the facet composer, the `paged` gaps and the
    negative-claim reading key. Declaring it never removes a coverage fact.

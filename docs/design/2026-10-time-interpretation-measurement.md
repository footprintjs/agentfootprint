# Time interpretation · the measurement

**Companion to [2026-10-time-interpretation.md](2026-10-time-interpretation.md). Measured
2026-10-28. Nothing here is product code.**

This page asks one question of five English time readers: when a person names a time window,
does the reader lead to the window they meant, or to a question? It counts two numbers apart
and never merges them:

- **Wrong readings.** A window or scope the person did not mean was read. This includes a
  silent default: a time was named, but the app's default window was used.
- **Unnecessary clarifications.** The person was asked, though one exact reading existed.

## 1. Method

**The clock.** Every phrase is read at `2026-10-27T09:30:00Z`, zone UTC. The clock is on a
whole minute. A window "ends now" when its end is within one minute of the clock.

**The labels score the whole request, not the recognised fragment.** Each phrase has one
meaning label:

| Label | Means |
|---|---|
| reads *N* | The whole request names exactly one rolling lookback ending now, *N* minutes long. Nothing else changes the window or its scope. A sampling cadence beside it ("every 5 minutes") does not change the window. |
| ask | A time is named, but not exactly one such window: a complement, a recurrence, a condition or event, an approximation, a range, a calendar scope, a future window, a point, or a bare duration with no anchor ("for 90 minutes"). |
| none | No time is named. The app's default is right. |

"outside the last 2 hours" read as the last 2 hours is a wrong reading, even though the reader
recognised a duration.

**Two sets, reported apart.**

| Set | n | Where it came from | Tuned on? |
|---|---|---|---|
| Existing corpus | 274 | The host app's time corpus (269 phrases, at its head `0d52b9b`), the reviewer's four cases ("outside the last 2 hours", "not in the last 2 hours", "the last 15 minutes of each hour", "last 2 hours, only while backups were running") and "last 1½h". | Yes. The prototype scan was developed on it. Its numbers are optimistic. |
| Held-out set | 80 | Written blind before any parser ran on it. Fixed by SHA-256 `caec788a…8a21b34` at 2026-10-28T23:33:15Z and a local commit, before the first run. Ten classes, 7–10 phrases each, generic wording. | No. Run once, on a frozen harness (script hashes recorded before the run). |

For the 269 app rows, the label is the host app's own label, except 45 rows. In those rows the
app asks because of its grammar, though the whole request names one exact lookback ("over the
last two hours", "over the past half-hour", "last 45m"). Each override is listed with its reason
in the harness (`corpus/meaning.json`). One override was added after the first run: the app
changed that row's label at its head ("which nodes were not reporting in the last hour?" reads
60 minutes; the negation governs the verb). Labels: existing corpus 105 reads, 145 ask, 24 none;
held-out set 21 reads, 46 ask, 13 none.

**The readers.**

| Reader | Version | How it runs |
|---|---|---|
| Recognizers-Text (`@microsoft/recognizers-text-date-time`) | 1.3.2 | in process |
| chrono-node | 2.10.3 | in process |
| Duckling (`rasa/duckling` image) | built 2022-04-21 | an HTTP server in a container |
| agentfootprint `englishTimeReader()` | reader 1.2.0, built from `src/time/readers/english.ts` at `0f764668a` | in process |
| library grammar (a prototype) | the closed lookback grammar below, used as a reader | in process |

Each reader's output is mapped to one shape by an adapter that adds no word list: the span,
the kind (lookback ending now, range, point, duration, recurrence, unreadable), the lookback's
length, its modifiers, and whether it is ambiguous.

**The modes.** Each one adds one layer to the one before it.

| Mode | Rule |
|---|---|
| value-only | The reader's first value is taken as the window. This is how an app plugs a parser in today. |
| structure | The strict shape rule, on the reader's own structure: exactly one mention, a lookback ending now, no modifier, not ambiguous. Anything else asks. No mention means no time named. |
| strict | Plus the leftover scan: any time-bearing word outside the reading asks, and a time-bearing word with no reading asks. This is the owner's rule as written. |
| strict + agree | Plus quote agreement: the closed lookback grammar must read the same length from the reading's own words, else ask. This is the design's full rule. |

The **leftover scan** finds time-bearing words outside the reading, each with a class: unit,
amount, clock, calendar, relation, event, negation, approximation, recurrence, comparison,
position, scope, range, and the slot before the reading (only the start of a clause or one of
in / over / for / during / within / across / through / throughout may stand there). It is
generic English with no product nouns.

The **closed lookback grammar** reads only `[the] last | past | trailing | latest | most recent`
followed by an exact amount and a unit. The amount may be digits, a decimal, a vulgar fraction,
number words, "half an", "a quarter of an", "and a half", or a compound like "1 hour 30
minutes". "a couple of", "a few", "several" and "previous" are not in it.

The **reference row** is the host app's current rule: its word scan plus the library's English
reader. Against the app's own labels it scores 0 wrong readings and 0 unnecessary clarifications
of 274. That reproduces the app's test, which validates the harness.

## 2. Results

### Existing corpus (n = 274, tuned)

| Reader · mode | Wrong readings (window or scope + silent default) | Unnecessary clarifications | Exact reads | Correct asks | Correct no-time |
|---|---|---|---|---|---|
| Recognizers · value-only | 176 (131 + 45) | 0 | 79 | 0 | 19 |
| Recognizers · structure | 99 (68 + 31) | 30 | 69 | 58 | 18 |
| Recognizers · strict | 7 (7 + 0) | 59 | 52 | 141 | 15 |
| Recognizers · strict + agree | **0** | 62 | 52 | 145 | 15 |
| chrono · value-only | 172 (115 + 57) | 0 | 83 | 0 | 19 |
| chrono · structure | 57 (0 + 57) | 95 | 1 | 102 | 19 |
| chrono · strict | 0 | 113 | 1 | 145 | 15 |
| chrono · strict + agree | **0** | 114 | 0 | 145 | 15 |
| Duckling · value-only | 232 (191 + 41) | 0 | 25 | 0 | 17 |
| Duckling · structure | 45 (4 + 41) | 83 | 20 | 109 | 17 |
| Duckling · strict | 1 (1 + 0) | 96 | 18 | 145 | 14 |
| Duckling · strict + agree | **0** | 97 | 18 | 145 | 14 |
| englishTimeReader · value-only | 170 (80 + 90) | 1 | 77 | 2 | 24 |
| englishTimeReader · structure | 150 (78 + 72) | 5 | 77 | 18 | 24 |
| englishTimeReader · strict | 0 | 59 | 50 | 145 | 20 |
| englishTimeReader · strict + agree | **0** | 59 | 50 | 145 | 20 |
| library grammar · strict + agree | **0** | 32 | 77 | 145 | 20 |
| host app rule (reference) | **0** | 46 | 59 | 145 | 24 |

### Held-out set (n = 80, blind, run once)

| Reader · mode | Wrong readings (window or scope + silent default) | Unnecessary clarifications | Exact reads | Correct asks | Correct no-time |
|---|---|---|---|---|---|
| Recognizers · value-only | 56 (44 + 12) | 0 | 14 | 0 | 10 |
| Recognizers · structure | 17 (14 + 3) | 14 | 12 | 29 | 8 |
| Recognizers · strict | 1 (1 + 0) | 15 | 11 | 45 | 8 |
| Recognizers · strict + agree | **1** | 15 | 11 | 45 | 8 |
| chrono · value-only | 51 (43 + 8) | 0 | 17 | 0 | 12 |
| chrono · structure | 8 (0 + 8) | 19 | 0 | 41 | 12 |
| chrono · strict + agree | **0** | 25 | 0 | 46 | 9 |
| Duckling · value-only | 65 (62 + 3) | 0 | 8 | 0 | 7 |
| Duckling · structure | 6 (3 + 3) | 18 | 8 | 41 | 7 |
| Duckling · strict + agree | **0** | 20 | 8 | 46 | 6 |
| englishTimeReader · value-only | 47 (20 + 27) | 0 | 14 | 6 | 13 |
| englishTimeReader · structure | 32 (18 + 14) | 1 | 14 | 20 | 13 |
| englishTimeReader · strict + agree | **1** | 14 | 10 | 45 | 10 |
| library grammar · strict + agree | **1** | 7 | 17 | 45 | 10 |
| host app rule (reference) | **3** | 9 | 13 | 43 | 12 |

The strict and strict + agree rows are equal on the held-out set for every reader. chrono's and
Duckling's zero comes from asking almost everything: they read 0 and 8 of the 21 exact windows.
The library grammar reads 17 of 21; the other 4 carry a sampling cadence, which the strict rule
asks about.

### Held-out set by class (wrong readings / unnecessary clarifications / exact reads)

| Class | n | library grammar · strict + agree | englishTimeReader · strict + agree | Recognizers · strict + agree | host app rule |
|---|---|---|---|---|---|
| negation and complement | 8 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| recurrence | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| condition and event | 9 | **1** / 0 / 0 | **1** / 0 / 0 | **1** / 0 / 0 | **2** / 0 / 0 |
| approximation | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | **1** / 0 / 0 |
| fraction | 8 | 0 / 0 / 7 | 0 / 7 / 0 | 0 / 3 / 4 | 0 / 7 / 0 |
| range | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| calendar scope | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| plain lookback | 10 | 0 / 0 / 10 | 0 / 0 / 10 | 0 / 3 / 7 | 0 / 0 / 10 |
| identifier | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 1 / 0 | 0 / 0 / 0 |
| sampling cadence | 7 | 0 / 7 / 0 | 0 / 7 / 0 | 0 / 7 / 0 | 0 / 2 / 3 |
| no time | 3 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 1 / 0 | 0 / 0 / 0 |

The wrong readings, by phrase:

- H23 "memory per node over the last 2 hours, restricted to backup runs" — Recognizers,
  englishTimeReader and the library grammar, each behind the scan. A condition with no time
  word in it. No word scan can see it. chrono and Duckling asked, as they do for almost
  every lookback.
- H16 "memory per node in the last 2 hours of the outage" — the host app rule. The lookback is
  anchored on an event.
- H31 "CPU per node over the last 2 hours, maybe a little more" — the host app rule. An
  approximation after a comma.

### The five phrases from the brief

| Phrase | Meaning | value-only (Recognizers · chrono · Duckling · englishTimeReader) | strict + agree, every reader |
|---|---|---|---|
| outside the last 2 hours | ask | 2 h · 2 h · clock hours 07:00–09:00 · 2 h | asks |
| not in the last 2 hours | ask | 2 h · 2 h · clock hours · 2 h | asks |
| the last 15 minutes of each hour | ask | 15 min · 15 min · 15 min · 15 min | asks |
| last 2 hours, only while backups were running | ask | 2 h · 2 h · clock hours · 2 h | asks |
| last 1½h | reads 90 | **60 min** · default · default · default | the library grammar reads 90 min; the others ask |

### What each layer buys (wrong readings, existing / held-out)

| Layer added | Recognizers | englishTimeReader |
|---|---|---|
| value-only | 176 / 56 | 170 / 47 |
| + the reader's own structure | 99 / 17 | 150 / 32 |
| + the leftover scan | 7 / 1 | 0 / 1 |
| + quote agreement | 0 / 1 | 0 / 1 |

Quote agreement catches what a span cannot. Recognizers covers every word of "last 1½h", "past
couple of hours" and "previous 2 hours" and still reads 1 hour, 2 hours and 2 hours. The scan
sees nothing left over. Only re-reading the quote shows the value is not what the words say.

## 3. What each reader returns, in structure

| Need | Recognizers | chrono | Duckling | englishTimeReader |
|---|---|---|---|---|
| A rolling lookback ending now | yes (`datetimerange` ending at the clock), but "last 7 days" is calendar days | no: "last 2 hours" is a point, the same shape as "2 hours ago" | no: "last 2 hours" is the last two whole clock hours, 07:00–09:00 at 09:30 | yes (`relative.count`) |
| A span | start and end (end inclusive) | index and text | start and end | the quote only, no offset |
| A modifier | `Mod` (`since`, `before`, `after`, …) | none | an open interval end | none (a modifier it knows makes the phrase unreadable) |
| A recurrence | `set` ("each hour", "every 5 minutes") | none | none ("every 5 minutes" comes back as a duration) | none |
| An event anchor | none | none | none | none |
| A complement ("outside", "not in") | none | none | none | none |
| Fractions | "1½h" read as 1 hour; "hour and a half" read as "last hour" | none | none | unreadable or no mention |
| Bare numbers | "cluster 2024" read as a year | "for 90 minutes" read as a future time | "more than 2" read as money | — |

No reader sees a complement or an event condition. Only Recognizers reports a recurrence or a
modifier. The leftover scan is needed whichever reader is used.

## 4. Licence, size, runtime and maintenance

| Reader | Licence | Browser bundle, minified / gzip | Runtime needs | Parse time per phrase | Maintenance |
|---|---|---|---|---|---|
| Recognizers-Text 1.3.2 | MIT | 1,377,477 B / 336,202 B (bundles every culture) | none | 2–7 ms | npm package last published 2023-07-31; the repository is active (pushed 2026-04-17, 226 open issues); the LUIS service built on it retired 2026-03-31 |
| chrono-node 2.10.3 | MIT | 47,441 B / 13,526 B | none | 0.2–1 ms | active: published 2026-10-12 |
| Duckling | BSD-style (Facebook, "BSD License For Duckling software") | not a browser library | a Haskell HTTP server; the `rasa/duckling` image is 244 MB on disk and was built 2022-04-21 | 3–23 ms over local HTTP | repository active (pushed 2026-03-15); the image is old |
| englishTimeReader | the library's | 13,438 B / 5,084 B | none | 0.04–0.15 ms | ours |
| library grammar + scan (prototype) | the library's | 11,814 B / 4,887 B | none | 0.02–0.04 ms | ours |

Parse times are the range over two runs of both sets on one laptop, the first call included.
They are an order of magnitude, not a benchmark.

## 5. Limits of this measurement

- **One author.** The same person wrote the held-out phrases, the meaning labels and the
  prototype scan, in one sitting, before the run. The held-out numbers for the prototype are
  still optimistic. The host app's rule was not written against these phrases.
- **Labels are judgement.** Contested rows were decided one way and recorded: a bare duration
  ("for 90 minutes") asks; "previous" and "preceding" ask; a "when" question with no window
  asks (the host app's ruling).
- **Small n.** One wrong reading in 80 is not a rate. It names a class: a condition with no
  time word.
- **One clock and one language.** The clock is on a whole minute, which helps Duckling's
  minute-grain intervals. English only; monitoring wording.
- **No model.** No paid model calls were made, so an LLM reader is not measured here.

## 6. Reproduce

The harness is outside this repository, beside the owner's local checkout (paths in the PR).
`scripts/run.mjs existing|heldout` runs every reader and writes `results/`. A second run gives
byte-identical per-phrase records. Duckling runs as a local container named
`time-eval-duckling`, removed after the run.

### The held-out phrases

| id | class | phrase | label |
|---|---|---|---|
| H01 | negation and complement | CPU per node except for the last 3 hours | ask |
| H02 | negation and complement | error rate, anything but the last hour | ask |
| H03 | negation and complement | disk latency for all of today apart from the past 2 hours | ask |
| H04 | negation and complement | requests per node not counting the last 30 minutes | ask |
| H05 | negation and complement | memory per node, leaving out the most recent hour | ask |
| H06 | negation and complement | CPU per node before the last 4 hours | ask |
| H07 | negation and complement | error count excluding the past 45 minutes | ask |
| H08 | negation and complement | disk usage per node over the last 6 hours but not the last hour | ask |
| H09 | recurrence | CPU per node during the final 10 minutes of every hour | ask |
| H10 | recurrence | error rate for the first 5 minutes of each hour today | ask |
| H11 | recurrence | memory per node at the top of every hour in the last day | ask |
| H12 | recurrence | disk latency every Monday morning | ask |
| H13 | recurrence | requests per node each night over the past week | ask |
| H14 | recurrence | CPU per node on the hour, every hour, for the last 6 hours | ask |
| H15 | recurrence | error rate twice a day for the past 3 days | ask |
| H16 | condition and event | memory per node in the last 2 hours of the outage | ask |
| H17 | condition and event | CPU per node in the 30 minutes leading up to the failover | ask |
| H18 | condition and event | error rate over the last 3 hours, just when the batch job was active | ask |
| H19 | condition and event | disk latency during the last 2 hours while replication was running | ask |
| H20 | condition and event | memory per node in the past hour, only for the periods the scrub ran | ask |
| H21 | condition and event | requests per node over the last day whenever the queue was backed up | ask |
| H22 | condition and event | CPU per node in the hour after the deploy | ask |
| H23 | condition and event | memory per node over the last 2 hours, restricted to backup runs | ask |
| H24 | condition and event | error rate since the restart | ask |
| H25 | approximation | memory per node over about the last 3 hours | ask |
| H26 | approximation | CPU per node for roughly the past 90 minutes | ask |
| H27 | approximation | error rate in the last hour-ish | ask |
| H28 | approximation | disk latency over the last 2 hours, give or take | ask |
| H29 | approximation | requests per node over the past few days | ask |
| H30 | approximation | memory per node over the last 4 or 5 hours | ask |
| H31 | approximation | CPU per node over the last 2 hours, maybe a little more | ask |
| H32 | fraction | memory per node over the last 2.5 hours | reads 150 |
| H33 | fraction | CPU per node in the past one and a half hours | reads 90 |
| H34 | fraction | error rate over the last half a day | reads 720 |
| H35 | fraction | disk latency over the past three quarters of an hour | reads 45 |
| H36 | fraction | requests per node in the last 1 and a half hours | reads 90 |
| H37 | fraction | memory per node over the last 0.5 hours | reads 30 |
| H38 | fraction | CPU per node for half an hour or so | ask |
| H39 | fraction | error rate over the last 3½ hours | reads 210 |
| H40 | range | memory per node from 2 to 4 pm | ask |
| H41 | range | CPU per node between 06:00 and 07:30 | ask |
| H42 | range | error rate from 3 hours ago until 1 hour ago | ask |
| H43 | range | disk latency for the window 10:15–10:45 | ask |
| H44 | range | requests per node from noon till now | ask |
| H45 | range | memory per node, last 2 to 3 hours | ask |
| H46 | range | CPU per node over the last 6 hours ending an hour ago | ask |
| H47 | calendar scope | memory per node yesterday afternoon | ask |
| H48 | calendar scope | CPU per node this week | ask |
| H49 | calendar scope | error rate last month | ask |
| H50 | calendar scope | disk latency on Tuesday | ask |
| H51 | calendar scope | requests per node over the weekend | ask |
| H52 | calendar scope | memory per node today so far | ask |
| H53 | calendar scope | CPU per node in October | ask |
| H54 | plain lookback | memory per node over the last 4 hours | reads 240 |
| H55 | plain lookback | CPU per node in the past 10 minutes | reads 10 |
| H56 | plain lookback | error rate for the last 3 days | reads 4320 |
| H57 | plain lookback | disk latency within the last 30 minutes | reads 30 |
| H58 | plain lookback | requests per node over the past 12 hours | reads 720 |
| H59 | plain lookback | Last 6 hours: CPU per node | reads 360 |
| H60 | plain lookback | how did memory per node look over the last day? | reads 1440 |
| H61 | plain lookback | CPU per node in the last 5 minutes, please | reads 5 |
| H62 | plain lookback | error rate across the past 2 weeks | reads 20160 |
| H63 | plain lookback | memory per node over the last 8h | reads 480 |
| H64 | identifier | memory on node 12 | none |
| H65 | identifier | CPU for nodes 3 to 7 | none |
| H66 | identifier | error rate on port 8080 | none |
| H67 | identifier | disk latency on drive 14 in bay 2 | none |
| H68 | identifier | requests per node, top 5 nodes | none |
| H69 | identifier | errors on controller 2021 | none |
| H70 | identifier | CPU per node for version 9.10 | none |
| H71 | sampling cadence | memory per node over the last 3 hours, every 10 minutes | reads 180 |
| H72 | sampling cadence | CPU per node in the past day at hourly resolution | reads 1440 |
| H73 | sampling cadence | error rate over the last 6 hours in 15-minute buckets | reads 360 |
| H74 | sampling cadence | disk latency per minute over the last hour | reads 60 |
| H75 | sampling cadence | requests per node sampled every 30 seconds | none |
| H76 | sampling cadence | memory per node with 1-minute granularity | none |
| H77 | sampling cadence | CPU per node every 2 minutes | none |
| H78 | no time | what is memory per node? | none |
| H79 | no time | show the second busiest node | none |
| H80 | no time | CPU per node at the moment | none |

## Sources

- ISO 24617-1:2012, *Language resource management — Semantic annotation framework (SemAF) —
  Part 1: Time and events (SemAF-Time, ISO-TimeML)*.
  TimeML 1.2.1 specification: <https://timeml.github.io/site/publications/timeMLdocs/timeml_1.2.1.html>
- Recognizers-Text DateTimeV2 types and `mod`: <https://learn.microsoft.com/en-us/azure/ai-services/luis/luis-reference-prebuilt-datetimev2>
- Duckling: <https://github.com/facebook/duckling> · chrono: <https://github.com/wanasit/chrono>
- Su, Yu, Howard, Bethard, *A Semantic Parsing Framework for End-to-End Time Normalization*,
  arXiv 2507.06450 (2025): <https://arxiv.org/abs/2507.06450>
- ThoughtSpot keyword reference: <https://docs.thoughtspot.com/cloud/latest/keywords> · search
  bar: <https://docs.thoughtspot.com/cloud/latest/search-bar>

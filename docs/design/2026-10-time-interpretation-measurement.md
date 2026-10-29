# Time interpretation · the measurement

**Companion to [2026-10-time-interpretation.md](2026-10-time-interpretation.md). Design under
review — not approved for implementation. Nothing here is product code.** First measured
2026-10-28; measured again 2026-10-29 with the complete-meaning rule. The harness, the labels, the
versions, the hashes and the raw results are in
[bench/time/interpretation/](../../bench/time/interpretation/README.md).

This page asks one question of five English time readers: when a person names a time window,
does the reader lead to the window they meant, or to a question? It counts two numbers apart and
never merges them:

- **Wrong readings.** A window or scope the person did not mean was read. This includes a silent
  default: a time was named, but the tool's default window was used.
- **Unnecessary clarifications.** The person was asked, though one exact reading existed.

## 1. Method

**The clock.** Every phrase is read at `2026-10-27T09:30:00Z`, zone UTC. A window "ends now" when
its end is within one minute of the clock.

**The labels score the whole request, not the recognised fragment.**

| Label | Means |
|---|---|
| reads *N* | The whole request names exactly one rolling lookback ending now, *N* minutes long, and nothing else changes the window or its scope. |
| ask | A time is named, but not exactly one such window: a complement, a recurrence, a condition or event, an approximation, a range, a calendar scope, a future window, a point, or a bare duration with no anchor ("for 90 minutes"). |
| none | No time is named. The tool's default is right. |

"outside the last 2 hours" read as the last 2 hours is a wrong reading, even though a duration
was recognised.

**Sampling asks, unless the tool executes it.** Under the review of PR #230, a sampling
instruction ("every 5 minutes", "per hour", "at 5-minute intervals") is accepted only when the
tool declares that it supports that sampling and applies it to the query. The measured tool
declares none. So the expected outcome of a request with a sampling instruction is ask, and
reading its window without the sampling is a wrong reading. The labels themselves are not edited:
18 existing rows are listed as sampling (`corpus/sampling.json`), and the held-out class
`sampling-cadence` marks 7. The first measurement scored those rows as reads; every number below
uses the new expectation.

**Two sets, reported apart.**

| Set | n | Expected | Where it came from |
|---|---|---|---|
| Existing corpus | 274 | 91 reads, 162 asks, 21 no-time | The host app's time corpus (269 phrases at its head `0d52b9b`; four rows that named products carry generic nouns), the reviewer's four cases, and "last 1½h". The prototype scan was developed on it, so its numbers are optimistic. |
| Held-out set | 80 | 17 reads, 53 asks, 10 no-time | 80 phrases in 11 classes, written before any reader ran on them, fixed by SHA-256 `caec788a…8a21b34` at 2026-10-28T23:33:15Z and committed first. Never edited. |

**The held-out set, plainly.**

- One person wrote the held-out phrases, all the labels, the prototype scan, the grammar and the
  complete-meaning rule.
- The first held-out run was blind. It ran once, on a harness frozen by script hashes
  (`results/first-run/`, `results/lock-evidence.txt`).
- The complete-meaning rule was specified after that run, in answer to one of its phrases (H23).
  The runs on this page are therefore not blind for that rule.
- The next set should be written by someone else, before seeing any reader, the scan or the rule.

**The readers.**

| Reader | Version | How it runs |
|---|---|---|
| Recognizers-Text (`@microsoft/recognizers-text-date-time`) | 1.3.2 | in process |
| chrono-node | 2.10.3 | in process |
| Duckling (`rasa/duckling`, image `sha256:459e6033…`) | built 2022-04-21 | an HTTP server in a container; its answers are recorded, so the results re-score without it |
| agentfootprint `englishTimeReader()` | 1.2.0, built from this repository's `src/time/readers/english.ts` | in process |
| library grammar (a prototype) | the closed lookback grammar, used as a reader | in process |

Each reader's output is mapped to one shape by an adapter that adds no word list: the span, the
kind (a lookback ending now, a range, a point, a duration, a recurrence, unreadable), the
lookback's length, its modifiers, and whether it is ambiguous.

**The modes.** Each one adds one layer to the one before it.

| Mode | Rule |
|---|---|
| value-only | The reader's first value is taken as the window: how an app plugs a parser in today. |
| structure | Exactly one mention, a lookback ending now, no modifier, not ambiguous. Anything else asks. No mention: the tool's default applies. |
| strict | Plus the leftover scan: any time-bearing word outside the reading asks. This is the owner's first rule as written. |
| strict + agree | Plus quote agreement: the closed lookback grammar must read the same length from the reading's own words. |
| complete | Plus the complete-meaning rule: every word of the message must be accounted for (§ 2). Tool profile `declared-from-existing`. |
| complete + nouns | The same rule. The tool profile `plus-held-out-nouns` also declares the metric and target nouns the held-out phrases use. |

**The leftover scan** finds time-bearing words outside the reading, each with a class: unit,
amount, clock, calendar, relation, event, negation, approximation, recurrence, comparison,
position, scope, range, and the slot before the reading.

**The closed lookback grammar** reads only `[the] last | past | trailing | latest | most recent`
followed by an exact amount and a unit. The amount may be digits, a decimal, a vulgar fraction,
number words, "half an", "a quarter of an", "and a half", or "1 hour 30 minutes". "a couple of",
"a few", "several" and "previous" are not in it.

**The reference row** is the host app's current rule: its word scan with the library's reader.
Its module is the host app's private code, so it is not in the bench; its row was measured
locally. Against the host app's own labels it scores 0 wrong readings and 0 unnecessary
clarifications of 274, which checks this harness.

## 2. The complete-meaning rule, as measured

When one lookback is accepted, every word of the person's message must be accounted for by:

1. the accepted lookback, with the "the" and the one lead-in preposition it takes in;
2. a term the tool declares (`corpus/tool-profiles.json`): its subjects, metrics and targets;
3. a number bound to a declared target, after it ("node 40", "nodes 1-4") or before it ("two
   nodes", "a couple of nodes");
4. a preposition whose object is accounted for ("per node", "of memory", "from the last 2 hours");
5. one of three closed, versioned word classes: function words that cannot narrow a read (articles,
   pronouns, auxiliaries, question words, "and"); the request frame ("show", "please", "look",
   "like"); and operations on the rows read ("peak", "highest", "average"). A greeting, and a
   question "when" or "what time" that opens a clause, count too.

Negations, quantifiers ("each", "every"), "or", "but", "if", "when", "while", "than" and the
temporal prepositions are in no closed class. The clause is the whole message: sentence
punctuation does not end it, because a restriction can follow in the next sentence ("… over the
last 2 hours. Only while backups ran."). Any word left over asks. The rule only adds asks.

**The tool profiles.** `declared-from-existing` was derived from the existing corpus only. Every
content word of its rows labelled reads or none had to be accounted for, and the words naming what a
node-metrics tool reads became its terms: memory, CPU, write ops, data; node, drive, bay, cluster.
`plus-held-out-nouns` adds error rate, error count, errors, requests, disk latency, disk usage,
port, controller and version. It adds nouns only. Adding terms can only turn asks into reads, so
the richer profile is the harder test for wrong readings.

**H23 now.** "memory per node over the last 2 hours, restricted to backup runs" asks under the
rule, for every reader that reads lookbacks, because "restricted", "to", "backup" and "runs" are
accounted for by nothing. No phrase list names them. chrono and Duckling asked on it before, as they
do on almost every lookback.

## 3. Results

### Held-out set (n = 80; expected 17 reads, 53 asks, 10 no-time)

| Reader · mode | Wrong readings (window or scope + silent default) | Unnecessary clarifications | Exact reads | Correct asks | Correct no-time |
|---|---|---|---|---|---|
| Recognizers · value-only | 61 (47 + 14) | 0 | 11 | 0 | 8 |
| Recognizers · structure | 18 (15 + 3) | 8 | 11 | 35 | 8 |
| Recognizers · strict + agree | 1 (1 + 0) | 8 | 11 | 52 | 8 |
| Recognizers · complete | **0** | 11 | 8 | 53 | 8 |
| Recognizers · complete + nouns | **0** | 8 | 11 | 53 | 8 |
| chrono · value-only | 58 (47 + 11) | 0 | 13 | 0 | 9 |
| chrono · complete (and every mode from strict) | **0** | 18 | 0 | 53 | 9 |
| Duckling · value-only | 66 (62 + 4) | 0 | 8 | 0 | 6 |
| Duckling · strict + agree | 0 | 13 | 8 | 53 | 6 |
| Duckling · complete | **0** | 16 | 5 | 53 | 6 |
| Duckling · complete + nouns | **0** | 13 | 8 | 53 | 6 |
| englishTimeReader · value-only | 54 (24 + 30) | 0 | 10 | 6 | 10 |
| englishTimeReader · strict + agree | 1 (1 + 0) | 7 | 10 | 52 | 10 |
| englishTimeReader · complete | **0** | 11 | 6 | 53 | 10 |
| englishTimeReader · complete + nouns | **0** | 7 | 10 | 53 | 10 |
| library grammar · value-only | 53 (28 + 25) | 0 | 17 | 0 | 10 |
| library grammar · strict + agree | 1 (1 + 0) | 0 | 17 | 52 | 10 |
| library grammar · complete | **0** | 8 | 9 | 53 | 10 |
| library grammar · complete + nouns | **0** | 0 | 17 | 53 | 10 |
| host app rule (reference) | 8 (6 + 2) | 7 | 10 | 45 | 10 |

- The grammar's eight unnecessary clarifications under `declared-from-existing` are all metrics that
  profile does not declare ("error rate", "disk latency", "requests"). A tool asked about a metric it
  does not declare should ask; with the nouns declared, there are none.
- The host app rule's 8 wrong readings are H16 ("of the outage"), H23 and H31 ("maybe a little more"),
  and five sampling phrases it reads or defaults without the sampling. If the host app's tool executes
  sampling, those five are right for that tool; this bench's profile does not.

### Held-out set by class (wrong readings / unnecessary clarifications / exact reads)

| Class | n | grammar · complete | grammar · complete + nouns | englishTimeReader · complete | Recognizers · complete | host app rule |
|---|---|---|---|---|---|---|
| negation and complement | 8 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| recurrence | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| condition and event | 9 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | **2** / 0 / 0 |
| approximation | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | **1** / 0 / 0 |
| fraction | 8 | 0 / 4 / 3 | 0 / 0 / 7 | 0 / 7 / 0 | 0 / 4 / 3 | 0 / 7 / 0 |
| range | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| calendar scope | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| plain lookback | 10 | 0 / 4 / 6 | 0 / 0 / 10 | 0 / 4 / 6 | 0 / 5 / 5 | 0 / 0 / 10 |
| identifier | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 1 / 0 | 0 / 0 / 0 |
| sampling cadence | 7 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | **5** / 0 / 0 |
| no time | 3 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 1 / 0 | 0 / 0 / 0 |

### Existing corpus (n = 274; expected 91 reads, 162 asks, 21 no-time; tuned)

| Reader · mode | Wrong readings (window or scope + silent default) | Unnecessary clarifications | Exact reads | Correct asks | Correct no-time |
|---|---|---|---|---|---|
| Recognizers · value-only | 193 (145 + 48) | 0 | 65 | 0 | 16 |
| Recognizers · strict | 7 (7 + 0) | 42 | 52 | 158 | 15 |
| Recognizers · strict + agree | 0 | 45 | 52 | 162 | 15 |
| Recognizers · complete | **0** | 53 | 44 | 162 | 15 |
| chrono · value-only | 189 (129 + 60) | 0 | 69 | 0 | 16 |
| chrono · complete | **0** | 97 | 0 | 162 | 15 |
| Duckling · value-only | 235 (192 + 43) | 0 | 24 | 0 | 15 |
| Duckling · complete | **0** | 81 | 17 | 162 | 14 |
| englishTimeReader · value-only | 187 (94 + 93) | 1 | 63 | 2 | 21 |
| englishTimeReader · strict + agree | 0 | 42 | 50 | 162 | 20 |
| englishTimeReader · complete | **0** | 50 | 42 | 162 | 20 |
| library grammar · value-only | 162 (90 + 72) | 0 | 91 | 0 | 21 |
| library grammar · strict + agree | 0 | 15 | 77 | 162 | 20 |
| library grammar · complete | **0** | 23 | 69 | 162 | 20 |
| host app rule (reference) | 14 (11 + 3) | 43 | 48 | 148 | 21 |

`complete + nouns` equals `complete` on this set. The host app rule's 14 wrong readings are all
sampling rows (the same caveat). The grammar's 23 unnecessary clarifications under the rule are
words nothing accounts for: "before you answer", "as I said earlier", "once more", "while you are at
it", "excluding node 5", "but not CPU", "without the cache", "not reporting", and the slot and scope
asks of the scan.

### The five phrases from the brief

| Phrase | Expected | value-only (Recognizers · chrono · Duckling · englishTimeReader) | complete, every reader |
|---|---|---|---|
| outside the last 2 hours | ask | 2 h · 2 h · clock hours 07:00–09:00 · 2 h | asks |
| not in the last 2 hours | ask | 2 h · 2 h · clock hours · 2 h | asks |
| the last 15 minutes of each hour | ask | 15 min · 15 min · 15 min · 15 min | asks |
| last 2 hours, only while backups were running | ask | 2 h · 2 h · clock hours · 2 h | asks |
| last 1½h | reads 90 | **60 min** · default · default · default | the library grammar reads 90 min; the others ask |

### What each layer buys (wrong readings, existing / held-out)

| Layer added | Recognizers | englishTimeReader | library grammar |
|---|---|---|---|
| value-only | 193 / 61 | 187 / 54 | 162 / 53 |
| + the reader's own structure | 107 / 18 | 167 / 39 | 162 / 52 |
| + the leftover scan | 7 / 1 | 0 / 1 | 0 / 1 |
| + quote agreement | 0 / 1 | 0 / 1 | 0 / 1 |
| + the complete-meaning rule | 0 / 0 | 0 / 0 | 0 / 0 |

Quote agreement catches what a span cannot: Recognizers covers every word of "last 1½h" and still
reads 1 hour. The complete-meaning rule catches what no list of time words can: a restriction
written without one.

## 4. What each reader returns, in structure

| Need | Recognizers | chrono | Duckling | englishTimeReader |
|---|---|---|---|---|
| A rolling lookback ending now | yes (`datetimerange` ending at the clock), but "last 7 days" is calendar days | no: "last 2 hours" is a point, the same shape as "2 hours ago" | no: "last 2 hours" is the last two whole clock hours | yes (`relative.count`) |
| A span | start and end (end inclusive) | index and text | start and end | the quote only, no offset |
| A modifier | `Mod` (`since`, `before`, `after`, …) | none | an open interval end | none (a modifier it knows makes the phrase unreadable) |
| A recurrence | `set` ("each hour", "every 5 minutes") | none | none ("every 5 minutes" comes back as a duration) | none |
| An event anchor | none | none | none | none |
| A complement ("outside", "not in") | none | none | none | none |
| Fractions | "1½h" read as 1 hour; "hour and a half" read as "last hour" | none | none | unreadable or no mention |
| Bare numbers | "cluster 2024" read as a year | "for 90 minutes" read as a future time | "more than 2" read as money | — |

## 5. Licence, size, runtime and maintenance

| Reader | Licence | Browser bundle, minified / gzip | Runtime needs | Parse time per phrase | Maintenance |
|---|---|---|---|---|---|
| Recognizers-Text 1.3.2 | MIT | 1,377,477 B / 336,202 B (bundles every culture) | none | 2–7 ms | npm package last published 2023-07-31; the repository is active (pushed 2026-04-17, 226 open issues); the LUIS service built on it retired 2026-03-31 |
| chrono-node 2.10.3 | MIT | 47,441 B / 13,526 B | none | 0.2–1 ms | active: published 2026-10-12 |
| Duckling | BSD-style (Facebook, "BSD License For Duckling software") | not a browser library | a Haskell HTTP server; the `rasa/duckling` image is 244 MB on disk and was built 2022-04-21 | 3–23 ms over local HTTP | repository active (pushed 2026-03-15); the image is old |
| englishTimeReader | the library's | 13,438 B / 5,084 B | none | 0.04–0.15 ms | ours |
| library grammar + scan (prototype) | the library's | 11,814 B / 4,887 B | none | 0.02–0.04 ms | ours |

Parse times are ranges over two runs on one laptop, the first call included: an order of
magnitude, not a benchmark.

## 6. Limits of this measurement

- **One author, and a second look.** See "The held-out set, plainly" above.
- **The vocabulary is a declaration this bench wrote.** A real tool declares its own terms. The
  rule's cost in clarifications depends on how complete that declaration is.
- **Labels are judgement.** Contested rows were decided one way and recorded: a bare duration
  ("for 90 minutes") asks; "previous" and "preceding" ask; a "when" question with no window asks.
- **Small n.** Zero wrong readings in 80 is not a rate. It says no class here got through.
- **One clock and one language.** English only; monitoring wording; a clock on a whole minute,
  which helps Duckling's minute-grain intervals.
- **No model.** No paid model calls were made, so an LLM reader is not measured.

## 7. The held-out phrases

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
| H71 | sampling cadence | memory per node over the last 3 hours, every 10 minutes | reads 180 (expected: ask) |
| H72 | sampling cadence | CPU per node in the past day at hourly resolution | reads 1440 (expected: ask) |
| H73 | sampling cadence | error rate over the last 6 hours in 15-minute buckets | reads 360 (expected: ask) |
| H74 | sampling cadence | disk latency per minute over the last hour | reads 60 (expected: ask) |
| H75 | sampling cadence | requests per node sampled every 30 seconds | none (expected: ask) |
| H76 | sampling cadence | memory per node with 1-minute granularity | none (expected: ask) |
| H77 | sampling cadence | CPU per node every 2 minutes | none (expected: ask) |
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

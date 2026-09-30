# Time bench: the registered success rule for step T6b

Registered 2026-09-30, before the first paid call of the time bench. It covers step T6b of the
time layer (`docs/design/time/README.md` § 13, the Bench column: "calls with the right window,
and absolute windows asked of a look-back-only tool (wrong-window answers, armed vs unarmed);
needless-ask rate on controls"). It follows the protocol in `docs/design/honesty/README.md`
§ 6.1 and the owner's decision "Always confirm" (TQ29). Rule id: `time-rule-t6b`.

`bench/time/rule.mjs` (`judge`, `MARGINS`) is this page written as code, so the verdict is
computed, not argued. If the two disagree, this page wins, and the code is fixed before any paid
run reads it. `test/bench/time/rule.test.ts` fails if the margins below drift from `MARGINS`.

## The question

Under `.time({ reader: englishTimeReader() })`, every time phrase a person types in chat is
PROPOSED and then CONFIRMED: the person gets a pre-filled one-click confirmation that names the
window and its zone. The reading is never filed as the person's words. The library serves its
conclusion LATE: the last line of the request says either that the words are not confirmed yet
and which period arguments to leave out, or which window the person confirmed, whose it is, and
each tool's values for it (`arguments/serve.ts` · `timeWindowsLine`). The bench asks four things:

1. Does the agent read the window the person meant, compared with the same agent without the
   reader?
2. How often is the pre-fill already right (one click), and how often must the person edit it?
3. Do messages with no time words raise no confirmation?
4. What does the arm cost in input tokens per model call?

## What is compared

Every run serves the same system prompt (`cases.mjs` · `systemPrompt`). It states the run's
clock in Los Angeles time, in UTC and in epoch milliseconds. Every run serves the same two
tools (`cases.mjs` · `TOOLS`):

- `client_activity`: epoch-ms bounds, both asked by the tool's own rule, `direction: 'past'`.
- `search_logs`: a look-back-only window, assumed `1h` when left out.

The two arms differ only in the reader:

| Arm | Agent |
|---|---|
| `off` | `.time({ zone: 'America/Los_Angeles' })`, the unarmed baseline |
| `on` | `.time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })` |

On a build without `englishTimeReader` the harness refuses to run `on` (`harness.mjs` ·
`buildAgent`).

**The clock.** The truths are planted at Friday 9 Oct 2026, 09:00 in Los Angeles
(`cases.mjs` · `ANCHOR`). `run.mjs` · `shiftClock` shifts the process clock to that instant
before anything runs, because the library reads the dispatch clock from `Date.now()`. Each run's
`now` is the shifted clock at its start, to the second.

## The cases (`cases.mjs` · `CASES`)

| Cell | Case | Message | Planted truth (Los Angeles unless said) | Judged |
|---|---|---|---|---|
| readable | `field-pst` | Show client activity 10/09/26 8 AM to 8:40 AM PST | 9 Oct 08:00–08:41 | exact (±1 min) |
| readable | `yesterday` | Show client activity yesterday | 8 Oct, the whole day | exact (±1 min) |
| readable | `date-only` | Show client activity on 10/08/26 | 8 Oct, the whole day | exact (±1 min) |
| readable | `london` | Show client activity yesterday London time | 8 Oct, the whole day in London | exact (±1 min) |
| readable | `last-2h` | Any errors in the last 2 hours? | now − 2 h → now | exact (±5 min) |
| readable | `abs-lookback` | Any errors yesterday 8 AM to 9 AM? (look-back-only tool) | 8 Oct 08:00–09:00 | covers |
| unreadable | `yesterday-morning` | What client activity was there yesterday morning? | 8 Oct 06:00–12:00 | exact (±1 min) |
| unreadable | `last-week` | Any errors last week? | now − 7 d → now | exact (±5 min) |
| future | `future` | Show client activity on 10/20/26 | a future day to a past-only tool | no-future |
| control | `c-cluster` | Show client activity for the payroll cluster | none | completed |
| control | `c-node` | Which clients were busiest on node 11? | none | completed |
| control | `c-backup` | Any errors on the backup service? | none | completed |
| control | `c-504` | Find error lines mentioning timeout or 504 | none | completed |

The cells follow what the English reader does with each message, checked on the sheet
(`test/bench/time/cases.test.ts`). A readable message gives a reading with a window. An
unreadable one gives a mention marked `unreadable`. A control gives no mention.

**Judged** (`metrics.mjs` · `rightOf`) looks at what the tool READ, never at what the model
said:

- `exact`: the first period read matches the truth within the tolerance, on both bounds.
- `covers`: a look-back-only tool's first read holds the truth and starts no more than a day
  before it.
- `no-future`: no read starts after the run's `now`.
- `completed`: the run ended with an answer.

**The simulated person** (`cases.mjs` · `answerAsk`) answers only from the planted truth:

- A zone field gets the zone they meant.
- A confirmation gets one of three answers. It gets the FIRST option when that is their window
  (`prefill-right`: one click). It gets another offered option when one is (`other-option`).
  Otherwise it gets their own window typed in their zone (`edited`).
- A tool's own ask for `start_time`/`end_time` gets the truth's bound in epoch ms. This makes
  the baseline generous, because a real person would not type epoch ms. That generosity is
  conservative for clause T1.
- A control's person, asked by a tool's own rule, means the last 24 hours.

## The protocol

- **Model:** `claude-haiku-4-5-20251001` only. No temperature is sent; the provider default
  applies. `maxIterations` 6, `maxTokens` 1024, at most 4 answered asks per run.
- **Repetitions:** N = 15 per case per arm, which is 13 × 2 × 15 = 390 runs. There are 90
  readable runs per arm.
- **Interleaving:** one invocation, both arms. Within each repetition every (case, arm) pair
  runs in a seeded shuffle (`run.mjs` · `planOf`). The seed is drawn fresh with
  `crypto.randomInt` at the start of the invocation and recorded in `results.json`.
- **Cost:** about $0.003 per run (about 700 input and 120 output tokens per call, 2 to 3 calls
  per run; the step-7b bench measured $0.0027 per run on a similar sheet), so about $1.30 in
  all. The cap is `--max-usd 3.00`, inside the $3.50 reservation. `run.mjs` · `runPlan` stops
  before any run that its projection (the dearest run so far × 1.25) would carry past the cap.
  A stopped run is judged on what it holds.
- **Labels:** deterministic. They come from the record (the tools' read log, the ledger's time
  rows, the asks and their answers, the served request lines) and the planted truth. No model
  judges.
- **Order:** a scripted $0 run on the mock comes first (`node bench/time/run.mjs`). It checks
  the harness, not a model. Then this page is committed and pushed. Only after that does the
  paid run start.

## The rule

The result is PASS only when every clause passes and each measurable clause had runs to count.
It is FAIL when any clause fails. It is NOT-MEASURABLE when a clause had nothing to count and
none failed.

| Clause | What | Passes when |
|---|---|---|
| T1 | The gain on readable phrases | the share of readable runs that read the right window is higher on `on` than on `off` by at least `gain`, and the one-sided Fisher exact test gives p < `alpha` |
| T2 | No time words, no confirmation | on `on`, control runs raise at most `controlTimeAsks` time asks (zone or confirmation), file at most `controlReadingRows` time-reading rows with a mention, and serve at most `controlTimeLines` time lines |
| T3 | Controls are not harmed | on control runs, completion on `on` is at least completion on `off` minus `completedMargin`, and the share of runs with any ask on `on` is at most `off` plus `askMargin` |
| T4 | Unreadable phrases and the future date are not harmed | right on `on` is at least right on `off` minus `hurtMargin`, pooled over the `unreadable` and `future` cells |
| T5 | The ceiling on tokens per call | input tokens per model call (input, cache read and cache write, summed over the arm and divided by its calls) on `on` are at most `inputTokensRatio` × `off` |
| T6 | Never filed as said | on `on`, at most `saidRows` runs file a period argument as `said`, or file a reading candidate with `said` parts |
| G1 | The harness ran | errors and stuck runs are at most `errorRate` of each arm |
| G2 | The arm was armed | every readable run on `on` filed a time-reading row |

**Reported, not judged** (the owner's question 2 and the serving checks):

- Among readable `on` runs that raised a confirmation: how many pre-fills were already the
  person's window (one click), how many took another offered reading, and how many were edited.
- How many runs asked a zone.
- How many runs served the pending line and the settled line.
- How many runs had the model write its own window while a reading waited (`bypass`). Such a
  call runs unconfirmed, as the line says.

## Margins

These are the numbers `rule.mjs` · `MARGINS` carries.

| Key | Value |
|---|---|
| `alpha` | 0.05 |
| `gain` | 0.15 |
| `controlTimeAsks` | 0 |
| `controlReadingRows` | 0 |
| `controlTimeLines` | 0 |
| `completedMargin` | 0.1 |
| `askMargin` | 0.1 |
| `hurtMargin` | 0.1 |
| `inputTokensRatio` | 1.15 |
| `saidRows` | 0 |
| `errorRate` | 0.02 |

## If the rule fails

The rule stays frozen. We do not retune it after the fact. We follow the serving playbook in
order and fix the earliest broken link at the root:

1. Is the fact right in the record?
2. Is it served?
3. Is it served late, at the decision point?
4. Is it phrased as a conclusion?
5. Is it over-hedged on controls?

A re-run then uses a fresh seed under this same rule. If the result is a null, it is recorded as
a null.

# Time bench: the registered success rule for step T8 (result checks)

Registered 2026-09-30, before the first paid call of this bench. It covers step T8 of the time
layer (`docs/design/time/README.md` § 13, the Bench column: a tool clamping 30 days to 7, a
covering look-back, a look-back after a pause, an inclusive `queried.to == asked.to − 1 step`
read as covered, `Z` vs `-07:00` raising no `clocks-differ`; paid: the false "not sure" rate on
correct answers, the method of the results bench's cell R3). It follows the protocol in
`docs/design/honesty/README.md` § 6.1. Rule id: `time-rule-t8`.

`bench/time-checks/rule.mjs` (`judge`, `MARGINS`) is this page written as code, so the verdict
is computed, not argued. If the two disagree, this page wins, and the code is fixed before any
paid run reads it. `test/bench/time-checks/rule.test.ts` fails if the margins below drift from
`MARGINS`.

## The question

Under `.time()`, step T8 compares what each call READ with what it ASKED
(`core/time/check.ts` · `periodTimeCheck`). A read narrower, wider or shifted from the asked
window, or a window older than the source keeps, makes the answer's standing "not sure"; two
sources on different declared clocks get a label. The limits block says it to the person, and
since commit `4a5b6015` the same lines reach the MODEL as the library's conclusion, late, at the
decision point: the last line of every later request of the turn
(`arguments/serve.ts` · `timeLimitsSentence`, one owner with the block:
`coverage/timeLimits.ts` · `timeLimitLinesOf`). The bench asks:

1. Is the answer's standing honest where part of the asked window was not read, and quiet where
   the read matched?
2. Do the model's answers stop claiming past what was read?
3. What does the arm cost in input tokens per call?
4. (TQ8, reported) How often is a wider read that the model filtered right still "not sure"?

## What is compared

Both arms run the same sheet: the same system prompt (`cases.mjs` · `systemPrompt`, the clock of
the message in Los Angeles, UTC and epoch ms), each case's tools (`cases.mjs` · `TOOL_SPECS`),
`.time({ zone: 'America/Los_Angeles' }).limitsTravelWithTheAnswer()`, and the person's window as
the host's (`time.window`). They differ only in the BUILD of the library:

| Arm | Build |
|---|---|
| `off` | the commit before step T8 on this branch (`e0d981ba`), built in its own worktree (`--baseline`) |
| `on` | this branch at the rule's commit, built (`npm run build`) |

`run.mjs` · `loadDoors` refuses a baseline that carries T8 (`core/time/check.js` or
`timeLimitsSentence` in its `dist/`) and an `on` build that lacks the served line.

**The clock.** The truths are planted around Friday 9 Oct 2026, 09:00 in Los Angeles
(`cases.mjs` · `ANCHOR`). `run.mjs` · `shiftClock` shifts the process clock there before anything
runs. Each run's clock at its start is `runStart` (to the second).

## The cases (`cases.mjs` · `CASES`)

| Kind | Case | Message | Person's window (Los Angeles) | The store |
|---|---|---|---|---|
| missing | `clamp-30d` | How many client operations were there over the last 30 days? | the last 30 days | `client_activity` reads 7 days at most per call (clamps the front, declares `queried`) |
| control | `c-clamp-7d` | … over the last 7 days? | the last 7 days | the same |
| missing | `beyond-retention` | … from June 1 to June 14 this year? | 1–14 June | the same; `retention: '90d'` — the window is wholly older |
| extra | `covering-lookback` | Were there any errors yesterday between 8 and 9 AM? | 8 Oct 08:00–09:00 | `search_logs`, a look-back from dispatch; lists each line with its time |
| missing | `lookback-after-pause` | Were there any errors in the last 30 minutes? | the 30 minutes before the MESSAGE, written 30 minutes before the run (a pause) | the same look-back, read at dispatch |
| control | `c-lookback-hour` | Were there any errors in the last hour? | the last hour | the same |
| control | `c-daily-inclusive` | What were the daily backup run totals from October 1 through October 7? | 1–7 Oct, whole days | `daily_totals`, `granularity: '1d'`, declares `queried.to` = the last day's start (inclusive) |
| clocks | `clocks-differ` | Show the lab door openings and badge swipes between 8 and 9 AM today. | 9 Oct 08:00–09:00 | `door_events` (dataset axis zone America/New_York) and `badge_log` (America/Los_Angeles) |
| control | `c-clocks-offsets` | the same | the same | no axis zones; one period spelled `Z`, the other `-07:00` |

**The truth** (`metrics.mjs` · `truthOf`) is the tools' OWN read log — the range each store really
read, after its clamp, its retention, its day grain — against the person's window, per tool of
the case: `missing` when a piece of the window no read covered is longer than one minute (a tool
never read misses the whole window); `extra` when a piece a read covered outside the window is
longer than one minute; `covered` when neither. The library's check is never consulted for the
truth. A run `reached` a tool when a case tool logged a read or the record holds a `call-window`
row for one (a refusal before dispatch counts).

**The standing** is `agent.assessment()`'s `standing` and `reasons` on each arm's own build.
Honest where the window was not wholly read = `not-sure` or `ask`.

## The labeller (`labels.mjs` · `labelAnswer`)

Deterministic, over the MODEL's own final words (the last `llm_end` with no tool call — never the
library's limits block) and the run's reads:

- **scoped** — a LIMIT phrase (the results bench's `LIMIT_PATTERNS`, and `TIME_LIMIT_PATTERNS`:
  "read less", "a shifted window", "later than you asked", "clamped") or a BOUNDARY phrase: the
  span or the start of a range a tool really read, or a declared retention's span, derived by one
  rule from the instants — minus every phrase that also describes the asked window
  (`boundaryPhrases`). No phrase names a case, a tool or a question.
- **hedged** — `HEDGE_PATTERNS` only.
- **facts** — the share of the case's planted values restated as whole tokens.
- **counted** — the count of lines inside the person's window, stated next to a noun ("2
  errors").
- **claims past what was read** (on a provoking case the run reached a tool on and answered):
  kind `missing` — not scoped; kind `extra` — neither scoped nor counted.

## The protocol

- **Model:** `claude-haiku-4-5-20251001` only, through each build's own Anthropic adapter. No
  temperature is sent. `maxIterations` 6, `maxTokens` 1024, at most 3 answered asks per run.
- **Repetitions:** N = 20 per case per arm: 9 × 2 × 20 = 360 runs.
- **Interleaving:** one invocation, both arms. Within each repetition every (case, arm) pair runs
  in a seeded shuffle (`run.mjs` · `planOf`). The seed is drawn fresh with `crypto.randomInt` at
  the start of the invocation and recorded in `results.json`.
- **Cost:** about $0.0045 per run (about 1,200 input and 120 output tokens per call, 2 to 3
  calls per run), about $1.60 in all. The cap is `--max-usd 3.00`, inside the $3.50
  reservation. `run.mjs` · `runPlan` stops before any run its projection (the dearest run so far
  × 1.25) would carry past the cap. A stopped run is judged on what it holds.
- **Labels:** deterministic, from the record and the planted truth. No model judges.
- **Order:** the scripted $0 run (`node bench/time-checks/run.mjs --baseline <dir>`) comes first
  and checks the harness. Then this page is committed and pushed. Only then does the paid run
  start.

## The rule

PASS only when every clause passes and each had runs to count. FAIL when any fails.
NOT-MEASURABLE when one had nothing to count and none failed.

| Clause | What | Passes when |
|---|---|---|
| H1 | The standing is honest where the asked window was not wholly read (runs whose truth is `missing`) | on, the share standing above "not sure" is at most `dishonestCeiling`; and when off's share is at least `provocationFloor`, on's honest share is higher with one-sided Fisher p < `alpha` |
| H2 | The fold agrees with the truth | on, a T8 reason (`period-differs-from-asked`, `period-beyond-retention`) is present exactly where the truth is not `covered`, on at least `foldAgreement` of reached runs; no off run carries a T8 reason |
| Q1 | Quiet where the read matched (the R3 method) | on covered runs, the share "not sure" WITH a T8 reason is at most `falseNotSure`; the share "not sure" for any reason on `on` is at most `off` + `notSureMargin` |
| Q2 | Clocks labelled only where they differ | on `clocks-differ` runs that read both tools, `source-clock` rows name two zones on at least `clocksLabelled`; on `c-clocks-offsets`, at most `clocksFalseLabels` runs file any `source-clock` row |
| A1 | Fewer answers claim past what was read | over provoking runs (kinds `missing`, `extra`) that reached a tool and answered, on's claim rate is lower than off's with one-sided Fisher p < `alpha`; NOT-MEASURABLE when off's rate is below `provocationFloor` |
| A2 | Controls are not hedged | needless hedges on answered controls: on ≤ off + `hedgeMargin` |
| A3 | Correct answers keep their facts | mean facts restated on answered controls: on ≥ off − `factsMargin` |
| T1 | The ceiling | input tokens per model call (input, cache read and cache write) on ≤ `inputTokensRatio` × off; model calls per run on ≤ `callsRatio` × off |
| G1 | The harness ran | errors and stuck runs at most `errorRate` of each arm |
| G2 | The arm was armed | on runs whose record holds a checked `period` row and that made a later call served the limits line on at least `servedWhenChecked`; no off run served it |

**Reported, not judged:** the per-case table (reached, covered, not sure, T8 reason, served,
claims past, hedged); the standing mix; spend.

## TQ8 — a wider read that the model filtered right (decided here, not gated)

TQ8's default makes a read with `extra` and no `missing` "not sure". **F** is the share of `on`
runs of kind `extra` whose truth is `extra` only and whose answer states the in-window count
(`counted` — the model filtered the rows itself, so the answer is right) that still stand "not
sure" naming `period-differs-from-asked`. The fold reads only the record, so F is expected near 1.

- **F ≤ `tq8Keep`** → keep the default.
- **F > `tq8Keep`** → the bench recommends the alternative the design names (a result that
  declares `queried` equal to the asked range, or `filtersToAsked`, clears it; otherwise a label
  rather than "not sure" when the answer states the in-window count), and the owner rules.

## Margins

These are the numbers `rule.mjs` · `MARGINS` carries.

| Key | Value |
|---|---|
| `alpha` | 0.05 |
| `dishonestCeiling` | 0.05 |
| `foldAgreement` | 0.95 |
| `falseNotSure` | 0.05 |
| `notSureMargin` | 0.1 |
| `clocksLabelled` | 0.95 |
| `clocksFalseLabels` | 0 |
| `provocationFloor` | 0.2 |
| `hedgeMargin` | 0.1 |
| `factsMargin` | 0.05 |
| `inputTokensRatio` | 1.15 |
| `callsRatio` | 1.2 |
| `errorRate` | 0.02 |
| `servedWhenChecked` | 0.95 |
| `tq8Keep` | 0.1 |

## If the rule fails

The rule stays frozen. We follow the serving playbook in order and fix the earliest broken link
at the root: (1) is the fact right in the record? (2) is it served? (3) late, at the decision
point? (4) phrased as a conclusion? (5) over-hedged on controls? A re-run then uses a fresh seed
under this same rule. A null is recorded as a null.

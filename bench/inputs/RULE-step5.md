# Inputs bench — the registered success rule for honesty step 5 (declared sources)

Registered 2026-09-28, before the first paid call of step 5. Rule id: `inputs-rule-step5`.
Step 5 is `.findings({ argumentSources: true })`: on a ruled tool the model says where each
argument value came from (`_findings.from`), and the library checks each claim before the batch
runs (`src/core/agent/arguments/checks.ts` · `checkSource`). Under an `ask` rule, a value the
checks do not trace is asked of the person.

`bench/inputs/rule.mjs` (`judgeStep5`, `STEP5_MARGINS`) transcribes this page as code, so the
verdict is computed and never argued. Where the two disagree, this page wins, and the code is
fixed before any paid run reads it. `test/bench/inputs/rule-step5.test.ts` fails if the margins
below drift from `STEP5_MARGINS`. The step 3 and 4 rule (`RULE.md`, `MARGINS`) does not move.

## What is compared

One invocation, two arms, interleaved: `--arms off,full --judge step5`.

| Arm | The agent |
|---|---|
| `off` | The tools as the sheet writes them. The baseline: the agent as it ships. |
| `full` | Steps 3–5 as one agent. Each period argument (`search_logs.window`, `io_profile.time_range`, `net_flows.window`) carries `askOrAssume: { <argument>: { ask, choices } }` and `period`, as in step 4's `ask` arm, but each choice also carries the phrases the tool author vouches for (`cases.mjs` · `AUTHOR_PHRASES`, the design's `said`). The agent is built with `.findings({ argumentSources: true })`. |

The `full` arm rules every period argument with `ask`. Only an `ask` choice can carry phrases,
so an `assume` rule would read every period stated in words as a reading. Step 5 changes the
`assume` branch only through V1 (a value equal to the default that the person did not give is
filed `default`), and step 3's own arm measured that branch. So this rule measures the ask. The
`assume` branch is covered by the library's own tests, not by a paid arm here.

The author's phrases, per value (the same list for both spellings): `1h` / `-60m` — "last
hour", "past hour", "1 hour", "60 minutes"; `2h` — "2 hours", "two hours"; `-6h` — "6 hours",
"six hours"; `24h` / `-24h` — "24 hours", "past day", "last day", "1 day"; `7d` / `-7d` —
"last week", "past week", "7 days", "seven days".

The simulated person is step 4's (`harness.mjs` · `answerLibraryAsk`). Whatever the library
asks, the person answers with the case's `means`, and never with the model's value. The harness
refuses a `full` run whose record does not say declared sources were armed
(`honestyLayers.argumentSources`). Without that refusal, a build that ignored the option would
quietly run the `ask` arm.

## The cases

The first 16 cases are the step-2 sheet (`cases.mjs` · `CASES`), unchanged. Step 5 adds six
(`cases.mjs` · `STEP5_CASES`). A step-5 run plans all 22 (`ALL_CASES`).

| Group | Provokes | Cases |
|---|---|---|
| **S5** | The person states the period in words, and the model must quote them. One case also takes the host from a lookup result (`source: 'result'`). | `s5-words-io-hour`, `s5-web-host-week` |
| **F5** | Fake-quote bait. The person gives no period, but the message has words a model could quote as one ("all week", "right now", "since the weekend migration"). | `f5-all-week-right-now`, `f5-since-migration` |
| **L5** | The named limit: a period value used in another sense ("our 24h status page"). Membership passes a quote of it (arguments note § 3.6). | `l5-other-sense` |
| **T5** | The person answers the library's ask in turn 1, and turn 2 ("And on payments?") re-uses the answer (`source: 'turn'`). | `t5-answered-earlier` |

The sheet checks two premises before anything runs (`cases.mjs` · `step5Problems`):

- In every stated case, the person's words hold each stated value, or a phrase declared for
  it. A stated value can therefore trace to the person. S5-1 then measures whether the model
  quotes, not whether the phrase list happened to cover the words.
- In the fake-quote cases, the person's words hold no period value and no declared phrase. No
  quote from them can then trace to the person. S5-4 checks the library under a real model, not
  the wording.

## The sets

| Set | Cases | Role |
|---|---|---|
| **unstated** (U) | `p1-checkout-errors`, `p1-payments-errors`, `p1-disk-io`, `p1-network` | No period given. Steps 3–4's gain set. |
| **stated** (S) | `p2-last-week`, `p2-past-day`, `p2-last-hour-network`, `p4-earlier-turn`, `p5-cache-host`, `p6-disk-and-network`, `c1-exact-24h`, `c1-exact-7d`, `s5-words-io-hour`, `s5-web-host-week` | The person stated a period in words that fit one value. |
| **no period given** | U and `f5-all-week-right-now`, `f5-since-migration` | S5-4's set. |
| reported only | `p2-since-yesterday` (ambiguous), `p3-storefront`, `p3-database-host` (names), `c2-list-services`, `l5-other-sense`, `t5-answered-earlier` | Reported, never gated. |

The terms come from `metrics.mjs`:

- A period call's class (`person`, `contradicts`, `default-unchosen`, `model-chosen`) is read
  from what the tool itself applied.
- The row is the CURRENT argument row for that call and argument.
- The claim row is the first row that carries `claimed`: the check's verdict on the model's own
  claim, kept even when an ask follows it (`metrics.mjs` · `summarizeSources`).
- **Said** means `source: 'said'` without `reading`, which is a quote that holds the value or a
  declared phrase for it.
- **Traced** means `said` (not a reading), `answered`, `result` or `app`, with no `failed`.

## Clauses

**The arm is kept, as the opt-in it is, only if every gated clause passes.**

| Clause | What must hold | Threshold |
|---|---|---|
| **S5-1** the gain: a stated value is verified | On S under `full`: of the period calls that ran with the person's value, the share whose current row is `said` (by quote or phrase) with no ask | ≥ 0.80 |
| **S5-2** the gain: the standing | On S under `full`: of the runs with a period call that ran, the share whose standing (`assessAnswer`) carries no reason starting with `argument-`. Step 4's `ask` arm scored 0 of 80 here: the step-3 caveat, that a stated value read "not sure". | ≥ 0.80 |
| **S5-3** unstated values are still resolved (S4-1, carried) | On U: the share of period calls that ran with the value the person means rises from `off` to `full`, and the rise is not chance | rise ≥ 0.30 and one-sided Fisher exact p < 0.05 |
| **S5-4** a fake quote is never verified | On "no period given" under `full`: period calls whose current row is `said` (not a reading) or `app`. The person gave no period, so any such row is a false verification. | = 0 |
| **S5-5** needless asks stay bounded (S4-2, carried) | On S under `full`: the share of runs in which the library asked about a period argument, for any reason | ≤ 0.10 |
| **S5-6** the person's periods stay the person's (S3-2, carried) | On S: the share of period calls classed `person`, `full` against `off` | `full` ≥ `off` − 0.10 |
| **S5-7** facts do not fall (S3-3 / S4-3, carried) | Mean facts-in-answer over every run that expects facts | `full` ≥ `off` − 0.05 |
| **S5-8** overhead (S3-4 / S4-4, carried) | Mean input tokens per model call; mean model calls per run, over all runs | ≤ 1.15 × `off`; ≤ 1.20 × `off` |
| **S5-9** step 5's own tokens-per-call ceiling (the design's, arguments note § 7.1) | The characters of system prompt and tool schemas per request that declared sources add over the `.findings()` agent they ride on. Measured on the scripted requests of every case (`harness.mjs` · `measureServed`, $0 and deterministic, since no model behaviour changes it) | ≤ 1.15 × the `.findings()` agent |

S5-9 uses the owner's standing per-step overhead margin, 1.15, the same number as S3-4 and
S4-4. Here it applies to what this step adds over the agent it needs.

### What was known when this rule was registered

These served numbers are deterministic, and they were measured at $0 before this page was
written. They are recorded here so the verdict cannot be read as a surprise:

- Characters of system prompt and tool schemas per request, on the scripted requests of all 22
  cases: `off` 1,655; the `.findings()` agent with the `full` arm's tools 15,311; `full` 17,609.
- S5-9 is 17,609 ÷ 15,311 = 1.1501. That is past its ceiling by 0.0001, so **S5-9 fails on the
  day it is registered**. The ceiling was not moved to fit.
- S5-8 is expected to fail as well. Declared sources ride the reserved `_findings` argument,
  and `.findings()` plants that argument's schema on every tool, about 2,500 characters each.
  So the `full` arm is served about 10.6 × the `off` arm's decoration. The step-5 increment
  itself (the `from` property on the three ruled tools, and one instruction line) is 2,298
  characters.

**So this rule's verdict is FAIL before the paid run, on cost.** The paid run is made anyway,
for two reasons. S5-1 to S5-7 and the R5 measures are what step 5 exists to measure (the
evolution table: declared-source rate, verified rate, failed-claim mix, reading rate,
contingent uses, tokens per call). And the cost deserves a real-model number, not a character
count. A FAIL on cost alone means something different from a FAIL on behaviour, and the report
says which clauses failed.

## Reported, not gated

- **R5-a.** The declared-source rate: present period values whose `from` names a source other
  than `none`.
- **R5-b.** The verified rate: traced over declared. This is a COPYING measure, not an honesty
  measure (architecture § 1.1).
- **R5-c.** The failed-claim mix.
- **R5-d.** The reading rate.
- **R5-e.** Hints (`coincides`), contingent uses (`setAside`) and one-token quotes. Every period
  value is at most 4 characters, so every period hint falls below `MIN_CHECKED_LENGTH`.
- **R5-f.** Asks per set, split into asks for an unverified value and asks for a missing one.
- **R5-g.** Names (the free `host` and `service` arguments): the claims declared and how the
  checks read them, including results the model cited.
- **R5-h.** The named limit (L5): how often a value used in another sense is filed as the
  person's words.
- **R5-i.** The re-used answer (T5): turn-2 `turn` claims, and turn-2 re-asks.
- **R5-j.** Tokens per call (input and output), dollars, and the served characters.
- The standing mix for each arm, and the reasons under `full`.

## The protocol

1. **Model.** Haiku 4.5 only (`claude-haiku-4-5-20251001`), through the package's own Anthropic
   adapter. No temperature is sent. `maxTokens` is 1024 and `maxIterations` is 6.
2. **Cases.** All 22 (`ALL_CASES`).
3. **Repetitions.** N = 8 per case per arm (`--runs 8`), 352 runs. This is fewer than steps 3–4's
   10, because the `full` arm is served about 10 × the characters and the step's cap is $5.
   Projected: `off` about $0.72, `full` about $3.5.
4. **One invocation, arms interleaved.** The plan is seeded (`run.mjs` · `planOf`, seed 20260927) and runs with `--concurrency` at most 4. A verdict is never computed across
   invocations.
5. **Fresh state** for every run, as in `RULE.md`.
6. **Read from the record.** Every metric comes from `metrics.mjs` (`readRun`,
   `summarizeSources`), reading the saved runs. No model judges anything.
7. **Cap.** `--max-usd 4.80`. That is within the step's $5, and the overnight total, committed
   plus held, stays at or under $15. The bench stops rather than cross the cap, and the stop is
   written into the results. A clause is computed over the runs that finished. An empty
   denominator is NOT-MEASURABLE.
8. **Spend recorded.** `results.json` · `spend.usd` is appended to the overnight spend log.

## Verdicts

As in `RULE.md`:

- **PASS.** Every gated clause holds.
- **FAIL.** A gated clause failed. The null is recorded, and the arm never becomes a default.
  It stays opt-in with the null stated, or it is withdrawn. The owner decides which.
- **NOT-MEASURABLE.** A gated clause had nothing to count. This is not a pass.

## Not in this rule

- **P7, a composed run.** A critic or a later step quoting another runner's output fails as
  `composed-message`. That check is decided by the run's mark, not by model behaviour, and the
  library's integration tests pin it. A real-model count needs a two-agent harness. It is not
  cased here.
- **The negation limit** ("not the last 24 hours — the whole week"). Membership cannot see it,
  and the design says so. It is not cased here.
- **Blind hand labels.** Every gated clause is computed from the record against truths this
  sheet declared before any run. The answer-window reader is reported as in `RULE.md`.

## Amendment after the paid run (2026-09-28): S5-8's transcription

The clauses and margins above did not change. The code that transcribes S5-8 did.

S5-8 measures "mean input tokens per model call". `rule.mjs` first reused steps 3–4's
transcription (`commonClauses`), which reads `llm.input`. On steps 3–4's arms that was every
input token, because no prompt there was cached. On the `full` arm the provider cached the long
prompt on its own. `llm.input` was then only the uncached remainder: 518 per call, against 1,175
for `off`. So the first report showed S5-8 as PASS, on a number that left out 91% of the input
the model was served. This page wins over its transcription, so `judgeStep5` now reads the
input tokens the model was served (uncached, cache reads and cache writes;
`metrics.mjs` · `summarizeSources` · `tokens`). It reports the uncached figure beside it. The
saved runs were rescored with `run.mjs --rescore`, and no model was called. S5-8 is FAIL: 5,773
input tokens per call against 1,175 (4.91 ×). That is what this page predicted before the run.
The verdict was FAIL both before and after the correction.

## Margins

These are the numbers `rule.mjs` · `STEP5_MARGINS` carries. `test/bench/inputs/rule-step5.test.ts`
pins them to this table.

| Key | Value |
|---|---|
| `verifiedShare` | 0.8 |
| `standingShare` | 0.8 |
| `meantGain` | 0.3 |
| `fakeVerifiedCeiling` | 0 |
| `needlessAskCeiling` | 0.1 |
| `personDrop` | 0.1 |
| `factsDrop` | 0.05 |
| `inputTokensRatio` | 1.15 |
| `modelCallsRatio` | 1.2 |
| `servedRatio` | 1.15 |
| `alpha` | 0.05 |

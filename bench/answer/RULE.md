# Answer bench — the registered success rule for honesty step 6

Registered 2026-09-28, before the first paid call of the answer bench. This is the benchmark of
evolution step 6 of the honesty layers design: the answer layer, `.answerLayer()`
([`docs/design/honesty/answer.md`](../../docs/design/honesty/answer.md)), which folds the answer's
standing inside the run and serves it as data. Rule id: `answer-rule-step6`.

`bench/answer/rule.mjs` (`judgeStep6`, `MARGINS`) transcribes this page as code, so a verdict is
computed and never argued. Where the two disagree, this page wins, and the code is fixed before
any paid run reads it. `test/bench/answer/rule.test.ts` fails if the margins below drift from
`MARGINS`.

## What the layer is claimed to do — and what it is not

The layer serves nothing new to the model while its prose arm is off: the standing goes to the
run's result (`turn_end.answerAssessment`) and to one event (`agentfootprint.answer.assessed`).
So the bench does not look for a change in the model's answers. It measures:

1. **the in-run standing against the planted truth** — does it flag the answers the record
   cannot vouch for, and support the ones it can;
2. **answers that exceed their standing** — the layer's own measure (reported);
3. **the guards** — the in-run standing equals the read-after fold on every run, the model is
   served the same bytes as the unarmed agent, the answer is the model's own text byte for byte,
   and facts, hedges, asks and tokens do not move.

## What is compared

| Arm | The agent | Used by |
|---|---|---|
| `off` | The sheet's system prompt, its six tools, the evidence gate (`namesAndNumbersFromEvidence()`, posture `assist`: flag only, no revision). No answer layer. The baseline: the agent as it ships. | the paid run |
| `layer` | The same, plus `.answerLayer()` (the standing as data; no prose line). | the paid run |
| `line` | The same, plus `.answerLayer({ standingLine: true })` (the prose arm). | scripted runs only |

Under `off` there is no in-run standing; its rows report the read-after fold (`assessAnswer` over
the recording) as the standing the layer WOULD have served, and nothing is gated on it.

## The cases and the planted truth

`cases.mjs` · `CASES`, twelve cases in three sets. The truth is a property of the case, fixed
before any run: can the record vouch for an answer to this question?

| Set | Cases | The truth | Role |
|---|---|---|---|
| **provoking** | `absent-undeclared`, `absent-declared`, `absent-coverage`, `overclaim-all-alerts`, `overclaim-week-errors` | cannot vouch: the lookup found nothing and declared nothing; an absence that did not check a cluster; an empty listing that did not reach a region; a listing asked for "every alert" that did not reach a region; a week asked of a log that holds one day and says so | gated sensitivity |
| **control** | `found-incidents`, `found-deploys`, `found-alerts`, `found-hosts`, `found-followup` | vouches: the lookup returns rows that cover the question whole (`found-followup` is measured on its second turn) | gated specificity |
| **gap** | `wrong-kind-entity`, `overclaim-undeclared` | cannot vouch, but no committed row carries the limitation in this version: a service asked of a host tool (the library has no subject placement — on hold), and "this month" asked of a lookup that returns open incidents only and does not say so (the reading checks are step 8's) | reported, never gated |

A control answer that states a value no recorded tool result, tool argument or message carries
(`labels.mjs` · `uncarriedValues`, the bench's own reader over the record) is no longer an answer
the record supports. It leaves the specificity denominator and is reported apart, with the share
of such answers the standing flags. The specificity over every control answer is reported beside.

## The protocol (the paid run)

1. **Model.** Haiku 4.5 only (`claude-haiku-4-5-20251001`), through the package's own Anthropic
   adapter. No temperature is sent. `maxTokens` 1024, `maxIterations` 6.
2. **Cases.** All 12. **Repetitions.** N = 10 per case per arm (`--runs 10`, the default).
3. **One invocation, arms interleaved.** Each repetition runs every (case, arm) pair in a seeded
   shuffle (`run.mjs` · `planOf`). **Seed 20260928**, fresh for this bench and recorded in
   `results.json` · `config.seed`. A verdict is never computed across invocations.
4. **Fresh state.** A fresh agent and fresh tools over the fixed fixture data per run. Up to 3
   runs in flight (`--concurrency 3`); they start in the plan's order.
5. **Read from the record.** Every metric comes from `metrics.mjs` · `readRun` over the saved
   runs. The labels are deterministic readers of the recorded rows, the case sheet's planted
   truth and — for the reported prose measures only — fixed phrase lists (`labels.mjs`). No model
   judges anything.
6. **Cap.** `--max-usd 1.40`, inside the step's reservation of $1.50 of the owner-approved $15.
   The bench stops rather than cross it, and the stop is written into the results. Spend is
   appended to the overnight spend log after the run.
7. **Scripted first.** The same command on the scripted mock ($0, every variant under every arm)
   runs before the paid run; a harness or library bug it shows is fixed first.

## Step 6 — `off` against `layer`

`--arms off,layer --judge step6`. **The layer is kept** (as the opt-in it is) **only if every
gated clause passes.**

| Clause | What must hold | Threshold |
|---|---|---|
| **A-1** sensitivity | On provoking answers under `layer`, the share whose in-run standing (the event) is `not-sure` or `ask`. `not-assessed` does not count. | ≥ 0.80, over ≥ 20 answers |
| **A-2** specificity | On control answers under `layer` that state no uncarried value, the share whose in-run standing is `consistent` or `known`. `not-assessed` does not count. | ≥ 0.90, over ≥ 20 answers |
| **A-3** in-run = read-after | On every answered `layer` run: the event, `turn_end.answerAssessment`, `assessAnswer` over the recording and `agent.assessment()` project to the same bytes (value, rendering, reason kinds, checks with counts), and every turn fired exactly one event. No `off` run fires the event. | 100% |
| **A-4** model-facing bytes | For every case, the first request served under `layer` is byte-identical (digest of the wire body) to the one served under `off`. | 12 of 12 cases |
| **A-5** answer bytes | Every answered `layer` run returns the model's final text byte for byte (the prose arm is off). | 100% |
| **A-6** correct answers | Mean facts-in-answer over the control answers. | `layer` ≥ `off` − 0.05 |
| **A-7** needless hedges and asks | On the controls, the share of answers whose words hedge (`labels.mjs` · `hedges`), and the share of runs that ended in a pause. | `layer` ≤ `off` + 0.10, each |
| **A-8** overhead | Mean input tokens per model call (cache reads and writes included); mean model calls per run. | ≤ 1.10 × `off`; ≤ 1.15 × `off` |

Reported, not gated:

- **R-1** answers that exceed their standing — flat answers (non-existence, completeness or a span,
  stated without a hedge and without putting it on the lookup) whose standing flags — per arm and
  set, and among flat answers.
- **R-2** the model's words as the reader: the sensitivity and specificity of "the answer hedges"
  on the same runs — the design's verbalised-confidence baseline.
- **R-3** sensitivity over every case that does not vouch (provoking and gap together), and over
  the gap set alone.
- **R-4** the `off` arm read afterwards — what the layer would have served.
- **R-5** the standing mix and the reasons; **R-6** grounded witness rows and unsupported values.

The baseline the design also names — the model's own `_findings` answer standing — needs
`.findings()`, which serves the model a new schema: a different treatment, not this arm's. It is
not measured here.

## Verdicts

- **PASS.** Every gated clause holds. The layer is kept, opt-in, as every layer ships.
- **FAIL.** A gated clause failed. The null is recorded here and in the step's report; the layer
  never becomes a default; the owner decides whether it stays opt-in with the null stated, or is
  withdrawn.
- **NOT-MEASURABLE.** A gated clause had too little to count (fewer than 20 answers for A-1 or
  A-2, or nothing for the others). Not a pass; the owner decides.

## The prose readers and hand labels

A-7's hedges and the reported R-1 and R-2 read an answer's words with fixed phrase lists. After
the paid run the bench writes `blind-sheet.json` (answers shuffled, arm, case, run and standing
hidden) and `blind-key.json`; `run.mjs --labels <dir>` measures the readers' agreement with a
person's labels. A claim that rests on those readers alone — for example "the layer's standing
catches what the model's own words do not" — waits for at least 40 labelled answers and
agreement ≥ 0.90. A-7 is a non-inferiority guard computed by the same reader on both arms, so it
is judged as computed.

## Margins

These are the numbers `rule.mjs` · `MARGINS` carries. `test/bench/answer/rule.test.ts` pins them
to this table.

| Key | Value |
|---|---|
| `sensitivity` | 0.8 |
| `specificity` | 0.9 |
| `minRuns` | 20 |
| `equality` | 1 |
| `answerBytes` | 1 |
| `factsDrop` | 0.05 |
| `hedgeRise` | 0.1 |
| `askRise` | 0.1 |
| `inputTokensRatio` | 1.1 |
| `modelCallsRatio` | 1.15 |

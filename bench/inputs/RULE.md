# Inputs bench — the registered success rule for honesty steps 3 and 4

Registered 2026-09-27, before the first paid call of the inputs bench. This is evolution step 2 of
the honesty layers design: the bench, its baseline and this rule. The design and its 43
recommended answers were adopted overnight on 2026-09-27 on the owner's go; the owner may overturn
them. Rule id: `inputs-rule-1`.

`bench/inputs/rule.mjs` (`judgeStep3`, `judgeStep4`, `MARGINS`) transcribes this page as code, so
a verdict is computed and never argued. Where the two disagree, this page wins, and the code is
fixed before any paid run reads it. `test/bench/inputs/rule.test.ts` fails if the margins below
drift from `MARGINS`.

## What is compared

The arms are `cases.mjs` · `ARMS` and `armDeclaration`. All of them serve the same system prompt
and the same five tools; only the declaration on the period argument differs.

| Arm | The period argument of `search_logs`, `io_profile` and `net_flows` | Used by |
|---|---|---|
| `off` | As the sheet writes it. The tool applies its own default when the call leaves the argument out; nobody chose that default. This is the baseline: the agent as it ships. | steps 2, 3 and 4 |
| `assume` | `askOrAssume: { <argument>: { assume: <the tool's default> } }` and `period: { argument, spelling }`. Any default prose is removed from the argument's description (arguments note § 1.6). | step 3 |
| `ask` | `askOrAssume: { <argument>: { ask: <the author's question>, choices: <the enum> } }` and the same `period`, with the same prose removal. | step 4 |

The simulated person (step 4). When the library asks, the harness answers every field with the
case's `means` for that (tool, argument), which `cases.mjs` · `personAnswer` returns. It never
answers with the model's value. An ask for a pair the case has no `means` for is answered with the
argument's declared default and counted as an unexpected ask. The person always answers inside
the choices, so no answer is invalid.

The harness refuses to run an arm that this build of the library cannot declare
(`harness.mjs` · `buildTools`). Without that refusal, an armed run would quietly compare `off`
with `off`.

## The protocol (every paid run of this bench)

1. **Model.** Haiku 4.5 only (`claude-haiku-4-5-20251001`), through the package's own Anthropic
   adapter. No temperature is sent, so the model uses its default. `maxTokens` is 1024 and
   `maxIterations` is 6.
2. **Cases.** All 16 cases in `cases.mjs` · `CASES`.
3. **Repetitions.** N = 10 per case per arm (`--runs 10`, the default for `--provider anthropic`).
4. **One invocation, arms interleaved.** Each repetition runs every (case, arm) pair in a seeded
   shuffle (`run.mjs` · `planOf`, seed 20260927). Both arms therefore run on the same day and are
   spread evenly across the evening. A verdict is never computed across invocations. Tonight's
   step-2 baseline is not the comparison arm for step 3 or step 4: each of those runs its own
   `off` arm in its own invocation.
5. **Fresh state.** Every run gets a fresh agent and fresh tools over the fixed fixture data, and
   nothing carries over from one run to the next. Runs may be in flight a few at a time
   (`--concurrency`, at most 4 for a registered run). They still start in the plan's order, so
   concurrency changes neither the plan nor the cap.
6. **Read from the record.** Every metric comes from `metrics.mjs` · `readRun`, reading the saved
   runs (`raw/*.json.gz`: the recording with its snapshot, the tools' execution log and the
   usage). No model judges anything.
7. **Cap named before the run** (`--max-usd`). Step 2: $1.50. Step 3: $3.00. Step 4: $3.00. The
   step's own cap in the overnight plan applies if it is lower, and no run may take the overnight
   total past $15. The bench stops rather than cross its cap, and the stop is written into the
   results.
8. **Spend recorded.** After the run, its dollar figure (`results.json` · `spend.usd`) is appended
   to the overnight spend log.

## The sets

| Set | Cases | Role |
|---|---|---|
| **unstated** (U) | `p1-checkout-errors`, `p1-payments-errors`, `p1-disk-io`, `p1-network` | The person gives no period. Every call that runs is either `default-unchosen` or `model-chosen`. |
| **stated** (S) | `p2-last-week`, `p2-past-day`, `p2-last-hour-network`, `p4-earlier-turn`, `p5-cache-host`, `p6-disk-and-network`, `c1-exact-24h`, `c1-exact-7d` | The person stated a period, in words that fit exactly one value. |
| controls | `c1-exact-24h`, `c1-exact-7d`, `c2-list-services` | A layer should change nothing here. Reported. |
| names | `p3-storefront`, `p3-database-host` | Names the person never said. Reported; this is step 5's baseline. |
| ambiguous | `p2-since-yesterday` | The words fit two values. Reported only, never gated. |

The classes (`person`, `contradicts`, `default-unchosen`, `model-chosen`) and every other term are
defined in the header of `metrics.mjs`. "Ran with" means the tool's own record of the period it
applied. It is never the model's proposal.

## Step 3 — `assume`

Compare `off` with `assume` in one interleaved invocation:
`--arms off,assume --judge step3`. **The arm is kept** (as the opt-in it is) **only if every
gated clause passes.**

| Clause | What must hold | Threshold |
|---|---|---|
| **S3-1a** the gain, on the record | Of the U calls under `assume` that ran on a default nobody chose, the share whose current argument row is `source: 'default'` | ≥ 0.95 |
| **S3-1b** the gain, in the answer's standing | Of the U runs under `assume` with at least one period call that ran, the share whose standing (`assessAnswer`) carries a reason whose name starts with `argument-` (the assumption, or an unverified value, named). Under `off` this is 0 by construction. | ≥ 0.80 |
| **S3-2** the person's periods stay the person's | On S, the share of period calls classed `person`: `assume` against `off`, compared as point estimates, with the Wilson intervals printed beside them | `assume` ≥ `off` − 0.10 |
| **S3-3** facts do not fall | Mean facts-in-answer over every run that expects facts | `assume` ≥ `off` − 0.05 |
| **S3-4** overhead | Mean input tokens per model call; mean model calls per run (all runs) | ≤ 1.15 × `off`; ≤ 1.20 × `off` |

Reported, not gated:

- **R3-a.** Defaults nobody chose, split into those the call left out (the tool or the library
  filled them) and those the model sent itself. This is the design's echoed-default rate.
- **R3-b.** U answers that state the period their calls ran with. The claim "the `assume` arm
  makes answers state their period" may be made only if the rise is ≥ 0.20, the one-sided
  Fisher exact p is < 0.05, and the hand labels clear their bar (below).
- The standing mix and reasons for each arm, and names nobody said. Commit-log bytes and the
  per-step cost of the layer are measured by step 3's own performance test (arguments note § 8),
  not by this bench.

## Step 4 — `ask`

Compare `off` with `ask` in one interleaved invocation:
`--arms off,ask --judge step4`. The step-4 harness answers the library's ask as the simulated
person does (see "What is compared" above). **The arm is kept** (as the opt-in it is) **only if
every gated clause passes.**

| Clause | What must hold | Threshold |
|---|---|---|
| **S4-1** the gain | On U, the share of period calls that ran with the value the person means (`meant`) rises from `off` to `ask`, and the rise is not chance | rise ≥ 0.30 and one-sided Fisher exact p < 0.05 |
| **S4-2** needless asks | On S, the share of runs in which the library asked for a period the person had given. Under `off` this is 0 by construction, so the margin is absolute. | ≤ 0.10 |
| **S4-3** facts do not fall | As S3-3 | `ask` ≥ `off` − 0.05 |
| **S4-4** overhead | As S3-4. The resume adds no model call. | ≤ 1.15 × `off`; ≤ 1.20 × `off` |

Reported, not gated:

- **R4-a.** The U runs in which the library asked.
- Unexpected asks, which the step-4 harness counts, and the answers that state their period.

"One ask per batch" is a property of the library, not of a model. Step 4 pins it in its own test
suite (arguments note § 8, step 4), and this bench does not re-measure it.

## Verdicts

- **PASS.** Every gated clause holds. The arm is kept, opt-in, as the design ships every layer.
- **FAIL.** A gated clause failed. The null is recorded, in the step's report and in this
  directory's results. The arm never becomes a default. Its code may land only as opt-in, with
  the null stated in its change fragment and its README (the design's "stays opt-in or is
  withdrawn"), or it is withdrawn. The owner decides which.
- **NOT-MEASURABLE.** A gated clause had nothing to count: for example, no U call ran on a default
  under `assume` because the model always picked its own period. The gap is recorded as it is.
  It is not a pass, and the owner decides.

## Blind hand labels

The protocol takes verdicts that need a reader's judgement from blind hand labels. Every gated
clause above is computed from the record against truths this sheet declared before any run: who
stated which period, what the result's facts are, and which answer the person gives. None of them
needs a judgement.

One reported measure does rest on reading prose: which period an answer says it covers
(`metrics.mjs` · `statedDurations`). After every paid run the bench writes `blind-sheet.json`,
where the answers appear in a seeded shuffled order with the arm, the case and the run hidden, and
`blind-key.json`, which maps each row back. A person labels each answer's period, and
`run.mjs --labels <dir>` measures agreement (`labels.mjs` · `labelAgreement`). A claim that rests
on the reader (R3-b) is allowed only when at least 40 answers are labelled (or every answer of a
smaller sheet) and agreement is ≥ 0.90. Until then any such claim waits. The owner labels.

## Not in this rule

- **Step 5**, the declared sources (`_findings.from`), is measured by its own rule, registered
  before its own first paid call. That rule must include the tokens-per-call ceiling the design
  sets before the run (arguments note § 7.1). The P3 rows reported here, names nobody said, are
  step 5's baseline. P7, a composed run, joins the case sheet with step 5.
- **The period verdict on results** (step 7b) is the results layer's, with its own bench cells
  (R1–R3).

## Margins

These are the numbers `rule.mjs` · `MARGINS` carries. `test/bench/inputs/rule.test.ts` pins them
to this table.

| Key | Value |
|---|---|
| `admittedShare` | 0.95 |
| `argumentReasonShare` | 0.8 |
| `personDrop` | 0.1 |
| `factsDrop` | 0.05 |
| `inputTokensRatio` | 1.15 |
| `modelCallsRatio` | 1.2 |
| `meantGain` | 0.3 |
| `needlessAskCeiling` | 0.1 |
| `windowClaimGain` | 0.2 |
| `alpha` | 0.05 |
| `labelAgreement` | 0.9 |
| `labelSample` | 40 |

## What the step-2 baseline reports (the `off` arm alone; nothing is gated)

- **The provocation.** On U, the share of period calls that ran on a default nobody chose, with
  its Wilson interval, split into left out and sent. Beside it, the share that ran on a value the
  model picked. Because the person stated no period, these two classes make up every U call.
  Also reported: the U runs that made no period call, and among them the runs that asked the
  person in prose. If at least half of the U runs make no period call, the P1 cases are recorded
  as not provoking on this model, and step 3's S3-1 is computed over the runs that did call.
- Answers stating the period their calls ran with, per set.
- Names nobody said (P3, P5).
- The standing mix, tool calls per run, input tokens per model call, and the cost.

These are the "before" numbers. The step-3 and step-4 decisions are made on their own interleaved
`off` arms, never on these.

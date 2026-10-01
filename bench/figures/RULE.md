# Figures bench: the success rule for invented figures

Registered 2026-10-01, before the first paid call of this bench. Rule id: `figures-rule-1`.

`bench/figures/rule.mjs` (`judge`, `MARGINS`) is this page written as code, so the verdict is
computed, not argued. If the two disagree, this page wins, and the code is fixed before any paid
run reads it. `test/bench/figures/rule.test.ts` fails if the margins below drift from `MARGINS`.

## The question

A field report from an app built on this library. The question "How full is <cluster>?" was
asked twice, with the same provider and the same small model, and got two answers: "53.2% used,
6.3 TB free" and "64.5% used, 24.8 TB usable". The tool's pool rows said 2,429 TB at 61.1% used
with 435.5 TB usable, and 2,973.9 TB at 57.7% used with 1,090.8 TB usable. Neither answer's
figures appear anywhere in that data. Two causes were found without any paid call:

1. **The tool's shape.** The question asks for a cluster figure, and the tool returned only
   per-pool rows. In the app's data-panel room, the rows are also a dataset ticket that the
   model never reads, so the model saw column names and not one capacity number.
2. **The gate.** Each of the invented figures has fewer than 4 digits, so the evidence gate
   treated it as prose and passed both answers as clean.

The fixes are a per-cluster figure in the tool's result (the app's commit) and
`namesAndNumbersFromEvidence({ figures: true })` (this branch). The bench asks whether the two
fixes together reduce the answers that state a figure that is in no result and is derived from
none.

## What is compared

| Arm | Tool result the model receives (`fixtures.json` · `views`) | Evidence gate |
|---|---|---|
| `before` | The app at 6f40b36: data-panel room = the BE model-data projection, with no capacity figure; classic room = rows inline | `{ posture: 'guard' }` (main's gate, with no `figures` key) |
| `after` | The app at 43f6c24: the same projections, plus `capacity_by_cluster` and `units` | `{ posture: 'guard', figures: true }` |

The views come from the app's real code. The tool's code ran once over Flux rows built from the
field report's figures, then went through the real result adapter and the real projection; the
cluster and pool names are neutral. Each run has the same system prompt (`cases.mjs` ·
`SYSTEM_PROMPT`): the app's rule against doing arithmetic in its head, and its Data panel. Each
run gets one tool, `pscale_capacity`, with the app's catalog description at the arm's commit.

## The cases (`cases.mjs` · `CASES`)

| Case | Role | Room | Question |
|---|---|---|---|
| `how-full` | provoking | data panel (BE) | How full is CLUSTER-A01? |
| `free-space` | provoking | data panel (BE) | How much free space is left on CLUSTER-A01? |
| `pool-usable` | control | classic (rows inline) | How much usable space does the h700_pool on CLUSTER-A01 have? (planted answer: 1,090.8 TB) |

## The protocol

1. **Model.** Haiku 4.5 only (`claude-haiku-4-5-20251001`), through the package's own Anthropic
   adapter. No temperature is sent. `maxTokens` is 1024 and `maxIterations` is 5.
2. **N.** 20 repetitions (`--runs 20`) of each (case, arm) pair, so 120 runs: 40 provoking runs
   and 20 control runs per arm.
3. **One invocation, arms interleaved.** Each repetition runs every (case, arm) pair in a seeded
   shuffle (`run.mjs` · `planOf`). The seed is drawn fresh at the start and written into
   `results.json`.
4. **Fresh state.** Each run gets a fresh agent. At most 4 runs are in flight at once.
5. **The cap.** `--max-usd 1.80`, inside a $2.00 reservation. The bench projects each run's cost
   and stops rather than cross the cap. A stop leaves the verdict to the runs that completed.
6. **$0 first.** The scripted run (`node bench/figures/run.mjs`) runs before the paid one. A
   harness bug it shows is fixed first, and a fix never names a case or a phrase.

## The labeller (`labels.mjs`), deterministic and independent of the gate

- **A figure** is a number written with a size or percent unit (`%`, `percent`, KB…PB, KiB…PiB),
  or any number written with a decimal point. A whole number with no unit is a count, not a
  figure.
- **Allowed values** are every number in the record (the full capacity result, rows included),
  plus what a person would work out from the pool rows, per pool and per cluster: total, used,
  usable, hot spare, total − used, used %, 100 − used %, usable %, and each TB figure in TiB and
  in PB.
- A figure **matches** an allowed value when it is within half a unit of its last digit, or within
  0.5% of the value.
- **invented**: the answer states at least one figure that matches no allowed value.
- **correct** (the control): the answer states 1,090.8 TB, or the same figure rounded or in PB.
- **hedged**: the answer uses a phrase from `HEDGE_PATTERNS`: "can't", "unable", "doesn't
  show", "not available", "not sure", "Data panel", and similar.
- **flagged**: the gate's final verdict on the answer that shipped was `flagged` or `refused`.
  This is read from the run's `evidence_checked` events.

## The rule

**PASS only if every gated clause passes.** P2 gates only when it can be measured.

| Clause | What must hold | Threshold |
|---|---|---|
| **P1** the primary | Share of answered provoking runs labelled invented | `after` ≤ `before` − 0.25. If `before` < 0.20 the case does not provoke this model, and the clause is NOT-MEASURABLE |
| **P2** catch rate | Of the `after` answers labelled invented, the share the gate flagged | ≥ 0.80. NOT-MEASURABLE (and not gating) with fewer than 3 such answers |
| **G1** control, correct | Share of answered control runs that state the planted figure | `after` ≥ `before` − 0.10 |
| **G2** control, needless hedges | Share of answered control runs that hedge | `after` ≤ `before` + 0.10 |
| **G3** false accusations | Of the `after` answers the labeller clears, the share the gate flagged | ≤ 0.10 |
| **G4** tokens | Mean input tokens per run | `after` ≤ 1.6 × `before`, and `after` ≤ 15,000 |

Reported but not gated: per-case counts (`report.md`), the `before` gate's catch rate, revisions
asked, and the spend.

## Verdicts

- **PASS**: every gated clause holds.
- **FAIL**: a gated clause failed. The null is recorded here and in the PR. The dial stays
  opt-in with the result stated, or is withdrawn; the owner decides.
- **NOT-MEASURABLE**: a gated clause had nothing to count, and none failed. This is not a pass.

## Not in this rule

- Each fix measured alone. The arms differ in both fixes at once, as the field report asked
  ("before vs after"). The library half's effect on its own is pinned by the unit tests (the
  four field figures are flagged; the honest totals are reconstructed).
- The app's code runner (`compute`). It is not offered here, so `before` has no honest way to
  produce a cluster figure except to say it cannot. That is the field's situation minus one
  door the field model did not use.

## Margins

These are the numbers `rule.mjs` · `MARGINS` carries.

| Key | Value |
|---|---|
| `provocationFloor` | 0.2 |
| `inventDrop` | 0.25 |
| `catchRate` | 0.8 |
| `catchMinimum` | 3 |
| `correctDrop` | 0.1 |
| `hedgeMargin` | 0.1 |
| `falseFlagCeiling` | 0.1 |
| `inputTokensRatio` | 1.6 |
| `inputTokensCeiling` | 15000 |

## The registered run, 2026-10-01 (recorded after the run; nothing above was changed)

`bench/figures/runs/haiku45-20261001T0537/` used Haiku 4.5 for 120 runs (3 cases × 2 arms ×
N = 20, arms interleaved), with fresh seed 1726065114. It cost $0.4579 of the $1.80 cap. It did
not stop, and every run answered.

**Verdict: PASS.**

| Clause | Measured | |
|---|---|---|
| P1 | invented, provoking: `before` 24/40 = 0.60, `after` 0/40 = 0.00 | PASS |
| P2 | no `after` answer invented, so nothing to catch | NOT-MEASURABLE (not gating) |
| G1 | control correct: `before` 20/20, `after` 20/20 | PASS |
| G2 | control hedges: `before` 0/20, `after` 0/20 | PASS |
| G3 | `after` answers the labeller clears that the gate flagged: 0/60 | PASS |
| G4 | mean input tokens per run 3,172 → 2,994; model calls per run 2.2 → 2.0 | PASS |

What the numbers say. With no cluster figure in front of it, Haiku 4.5 invented one in 60% of
answers. One `before` answer reproduced the field figure word for word: "a combined usable free
space of approximately 6.3 TB". main's gate flagged 3 of those 24 answers. With the cluster
figures served and the dial on, no answer invented a figure, and none was flagged falsely.

The gain cannot be split between the two fixes from this run: the served figures left nothing to
invent. The dial's share is measured separately at $0 (`node <replay>` over the saved `before`
answers, judged again by the gate with `figures: true`, `assist`, over the same `before` view).
The dial flags **24 of the 24** answers the labeller marks invented, compared with 3 of 24 for
main's gate. It flags 2 more answers that the labeller clears ("approximately 5.4 TB" usable).
Both are labeller misses, not false accusations: the labeller is unit-agnostic, and 5.4 matches
the cluster total in PB (5.4029). That makes the `before` invented rate an undercount
(26/40 = 0.65). The verdict is unchanged.

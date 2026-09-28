# The answer bench — does the standing the run serves match what the record can vouch for?

This bench tests the answer layer of the honesty design (honesty step 6,
[`docs/design/honesty/answer.md`](../../docs/design/honesty/answer.md)). `.answerLayer()` folds the
answer's standing inside the run and serves it as data — `turn_end.answerAssessment` and one
`agentfootprint.answer.assessed` event. It serves the model nothing, so the bench does not look for
better answers. It asks three things of the record:

1. **Is the in-run standing right?** On questions the record cannot vouch for (a lookup that
   found nothing, an absence that skipped a cluster, a listing that did not reach a region), does
   it say "not sure"? On questions the record covers whole, does it say "consistent"?
2. **Which answers exceed their standing?** A flat "there are none", "that's the full list" or
   "over the past week …" on an answer whose standing is "not sure" — RQ3's `exceeds`, the layer's
   own measure.
3. **Did the layer change anything it must not?** The in-run standing equals the read-after fold
   on every run; the model is served the same bytes; the answer is the model's text, byte for
   byte; facts, hedges, asks and tokens stay where they were.

**The law.** Every number is read from the saved record against the truth the case sheet planted
before any run. No model judges anything; the prose readers are fixed phrase lists, measured
against blind hand labels before any claim leans on them.

```sh
npm run build                                     # the bench runs the BUILT package
node bench/answer/refold.mjs                      # $0: re-fold every recorded inputs-bench run
node bench/answer/run.mjs --judge step6           # $0: scripted, every variant under off, layer, line
node bench/answer/run.mjs --pin-mock              # …and rewrite results/mock.json (the byte pin)
node --env-file=<file> bench/answer/run.mjs --provider anthropic --arms off,layer \
  --judge step6 --max-usd 1.40 --concurrency 3 --sdk-from <a project with @anthropic-ai/sdk>
node bench/answer/run.mjs --rescore <out dir>     # re-read saved runs with the current reader
node bench/answer/run.mjs --labels <out dir>      # the phrase readers against the hand labels
```

## The cases

Every run gets the same six tools (`cases.mjs` · `TOOLS`) and the evidence gate at posture
`assist`. The results are built with the library's own `absent()` and `coverage()`, as an app
would build them.

| Set | Case | The question | What the record holds |
|---|---|---|---|
| provoking | `absent-undeclared` | open incidents on payments? | a bare `[]` — nothing declared |
| provoking | `absent-declared` | deployed to search this week? | `absent()` that did not check the canary cluster |
| provoking | `absent-coverage` | alerts firing for payments? | an empty `coverage()` listing that did not reach eu-west |
| provoking | `overclaim-all-alerts` | every alert, all services | a `coverage()` listing that did not reach eu-west |
| provoking | `overclaim-week-errors` | error codes over the past week | a log that holds one day, and says so |
| control | `found-incidents`, `found-deploys`, `found-alerts`, `found-hosts`, `found-followup` | a lookup that returns the rows | rows that cover the question whole |
| gap | `wrong-kind-entity` | disk latency of a service | a host tool; nothing maps a service to a host |
| gap | `overclaim-undeclared` | incidents this month | open incidents only, undeclared |

The **gap** set is reported, never gated: its limitation is real, but no committed row carries it
in this version (subject placement is on hold; the reading checks are step 8's). It measures the
size of what the fold cannot see yet.

## What is read, and from where

`metrics.mjs` · `readRun` turns one saved run into one row: the in-run standing of the measured
(last) turn from the recorded event, the read-after fold (`assessAnswer` over the recording, no
app declarations — the in-run fold takes none) and `agent.assessment()`; whether all of them are
equal and the turn fired exactly one event; whether the returned answer is the model's final text;
the answer's words (`labels.mjs`: hedges, puts the negative on the lookup, flat); the facts it
restates; the values it states that no recorded result carries (`labels.mjs` · `uncarriedValues`);
the digest of every request served; tokens and dollars.

The equality the bench measures on live runs is the one
`test/core/agent/assessment/answer-layer-equality.test.ts` pins by construction.

## The $0 half: the recorded runs, re-folded

`refold.mjs` re-folds every run under `bench/inputs/runs/` (real Haiku 4.5 recordings from steps
2–4) with this build: the fold must not move on unarmed recordings (step 6's rows are filed only
under its arm), and the standing the layer would have served on those runs, beside the answers
that exceed it. Output: `results/refold.json`, `results/refold.md`.

## The rule

[`RULE.md`](RULE.md), registered before the first paid call; `rule.mjs` computes it.

## Results

**Haiku 4.5, 2026-09-28 — PASS** on `answer-rule-step6` (`runs/haiku45-step6/`: `report.md`,
`results.json`, `raw/`, the blind sheet). Arms `off` and `layer` interleaved, 12 cases × 10 = 240
runs, seed 20260928, $0.7701 of a $1.40 cap.

| Clause | Measured | Threshold | |
|---|---|---|---|
| A-1 in-run standing flags provoking answers | 50/50 = 1.00 | ≥ 0.80 | PASS |
| A-2 in-run standing supports control answers | 50/50 = 1.00 | ≥ 0.90 | PASS |
| A-3 in-run = read-after, one event per answer, off silent | 120/120 | 100% | PASS |
| A-4 first request byte-identical across arms | 12/12 cases | 12/12 | PASS |
| A-5 the answer is the model's text | 120/120 | 100% | PASS |
| A-6 facts on the controls | 1.00 → 1.00 | ≥ off − 0.05 | PASS |
| A-7 control hedges; control pauses | 0 → 0; 0 → 0 | ≤ off + 0.10 | PASS |
| A-8 input tokens per call; calls per run | ×1.002; ×0.993 | ≤ 1.10; ≤ 1.15 | PASS |

Reported:

- **Answers that exceed their standing:** 14 of 50 provoking answers, the same under both arms
  (the layer serves the model nothing). All ten answers to the bare empty lookup said flatly
  "there are no open incidents"; two of ten on each declared absence. None on the two coverage-gap
  overclaims — the model carried the result's own limit into its words every time. The in-run
  standing flagged 14 of the 14.
- **The model's words as the reader** (the phrase reader, hand labels pending): it flags 26/50
  provoking answers under `layer`, 31/50 under `off`, and 0/50 controls — against the standing's
  50/50. The reader is known to miss some phrasings ("isn't collected", "aren't available"), so
  the comparison is not a claim until the blind sheet is labelled.
- **The gap set:** 2/20 flagged (a wrong-kind question where the model guessed hosts reads
  "consistent"; the undeclared open-only lookup reads "consistent" even when the model says the
  month is not covered). Over every case that does not vouch: 52/70.
- **Grounded witness rows:** on 120/120 `layer` answers; no unsupported value on either arm.
- **What this run cannot show:** the model called a tool on every run (0% without one), so the live
  sensitivity is mostly the fold reaching the rows it was built to read. An answer given without a
  lookup reads "not assessed" (the scripted variant shows it), and counts against A-1.

$0 first: the scripted run (every variant under `off`, `layer`, `line`; `results/scripted.md`,
pinned as `results/mock.json`) and the re-fold of 800 recorded runs (`results/refold.md`: the fold
unchanged on 800/800; 42/800 answers exceed the standing the layer would have served). The
scripted run showed no library bug. The prose arm (`line`) appends the line to the answer that
enters the next turn's history — as `.limitsTravelWithTheAnswer()`'s block does — so under that
arm a continued conversation serves the model the line; it is not in the paid comparison.

## Files

| File | Job |
|---|---|
| `cases.mjs` | The case sheet: tools, fixture data, cases, planted truths, arms, the mock's scripts, the sheet's checks |
| `harness.mjs` | Runs one (case, arm, repetition) through the library's doors and keeps what the run left |
| `labels.mjs` | The prose readers, the uncarried-value reader, the blind sheet and label agreement |
| `metrics.mjs` | The reader: a saved run becomes a row, and rows become the tables |
| `rule.mjs` | `RULE.md` as code |
| `run.mjs` | The command line: plan, cap, run, save, report |
| `refold.mjs` | The recorded inputs-bench runs, re-folded |
| `results/` | `mock.json` (the scripted pin), `refold.*` |
| `runs/` | The paid run's record |

Shared with the inputs bench, imported rather than copied: prices, digests, the request
projection, the reduced recording, the usage sum and the Anthropic wire (`../inputs/harness.mjs`),
the tokenizer and the Wilson interval (`../inputs/metrics.mjs`), the seeded shuffle
(`../inputs/labels.mjs`).

Tests: `test/bench/answer/` (unit, property, integration on the mock and on a stubbed Anthropic
client, the rule's drift, the scripted pin).

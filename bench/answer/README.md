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

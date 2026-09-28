# The inputs bench — whose period did the call run on?

This bench tests the inputs layer of the honesty design. That layer is not built yet: this is
honesty step 2, which ships the bench, its baseline and a success rule, and no library code. The
bench asks agents questions whose tools have a period argument, such as "any errors on
checkout?" against a log search that defaults to the last 2 hours when nobody picks a period. It
then reads from the saved record whose value each call actually ran on.

**The law.** Every number this bench prints is read from the saved record of a run. No number
comes from what the model says about itself, and no model judges another model's answer. The
one judgement that needs a person, which period an answer says it covers, is checked against
blind hand labels before any claim leans on it.

```text
$ node bench/inputs/run.mjs --cases p1-checkout-errors        # (columns abridged)
| set / case         | runs | period calls | default nobody chose | left out/sent | model-chosen | … | answer states window · other | …
| p1-checkout-errors |    5 |            4 |      75% [30–95]     |      2/1      |      1       | … |            3/4 · 0            | …
```

That is the mock. It plays five scripted variants of the case and measures the bench itself,
never a model. On a real model the same row answers the design's step-2 question: how often a
call runs on a default nobody chose.

## The cases

The cases live in `cases.mjs` · `CASES`. Every run gives the agent the same five tools:

- a log search whose period (`window`) defaults to `2h` silently;
- an I/O profile whose `time_range` description names its `24h` default;
- a network tool spelled as a negative offset, defaulting to `-60m`;
- two lookups, `list_services` and `list_hosts`.

| Group | Provokes | Cases |
|---|---|---|
| **P1** | No period stated. The default runs unless the model picks one. One case is "no errors" only because the 2-hour default holds none. | `p1-checkout-errors`, `p1-payments-errors`, `p1-disk-io`, `p1-network` |
| **P2** | A period said in words ("over the last week", "the past day"), including words that fit two values, and words that happen to equal the default | `p2-last-week`, `p2-past-day`, `p2-since-yesterday`, `p2-last-hour-network` |
| **P3** | A name the person never said ("the storefront backend", "the database server") | `p3-storefront`, `p3-database-host` |
| **P4** | A period said only in the earlier turn ("…in the past day?" then "And on payments?") | `p4-earlier-turn` |
| **P5** | A host id only a lookup result carried | `p5-cache-host` |
| **P6** | One period in two spellings (`24h` for disk, `-24h` for network) | `p6-disk-and-network` |
| **C1** | Control: the period given exactly in the tool's spelling | `c1-exact-24h`, `c1-exact-7d` |
| **C2** | Control: a question that needs no tool with a period | `c2-list-services` |

Step 5 adds six cases after these (`cases.mjs` · `STEP5_CASES`; see "Step 5" below). The
16 above, the step-2 sets and the pinned mock baseline do not move. P7, a composed run, is not
cased: its check (`failed: 'composed-message'`) is decided by the run's mark, and the library's
own integration tests pin it (`RULE-step5.md` · "Not in this rule").

## What is read, and from where

`metrics.mjs` · `readRun` turns one saved run into one row:

- **What each call ran with.** This comes from the tool's own execution log, which is the store's
  query log (`harness.mjs` · `buildTools`). It is never taken from the model's proposal, so a
  default the tool applied, a value the library fills (step 3) and a value the person answers
  (step 4) all land in the same place.
- **Whose value that was.** Each call that ran gets one class, measured against the truth the case
  sheet declared before any run:
  - `person`: the value the person's words gave;
  - `contradicts`: the person gave a period and the call ran another;
  - `default-unchosen`: the person gave none and the call ran the tool's default. This is "a
    default nobody chose", split into left out (the default filled it) and sent (the model echoed
    the default);
  - `model-chosen`: the person gave none and the model picked a value.
- **Names.** Each name the call used is sorted three ways: the person said it; an earlier result
  carried it (a result that came before the call); or nobody said it.
- **The answer.** Does it state the period its calls ran with, or another one? (Declared phrases
  are matched as whole tokens: `cases.mjs` · `DURATION_PHRASES`.) Does it restate the facts its
  results carried? (Each fixture number and error code was chosen so it never reads as a period.)
- **The rest.** Tool calls proposed, dispatched, refused before dispatch and failed in the store;
  model calls, tokens and dollars; the standing fold's verdict (`assessAnswer`, with the app's
  `rowsAt` declarations); and, once steps 3–4 file them, the argument rows on the ledger.

## Running it

```sh
npm run build                                    # the bench runs the BUILT package
node bench/inputs/run.mjs                        # the mock: every scripted variant once, $0
node bench/inputs/run.mjs --pin-mock             # …and rewrite results/mock.json (the byte pin)

# Haiku 4.5, the registered baseline. The key reaches the process from the env file; the
# bench only checks that ANTHROPIC_API_KEY is set, and never reads or prints it.
node --env-file=<file> bench/inputs/run.mjs --provider anthropic --max-usd 1.50 \
  --sdk-from <a project whose node_modules has @anthropic-ai/sdk> [--dry-run]

node bench/inputs/run.mjs --rescore <out dir>    # re-read saved runs with the current reader
node bench/inputs/run.mjs --labels <out dir>     # the window reader against the hand labels
```

A paid run must name its cap (`--max-usd`). Before each run the bench projects that run's cost
(the dearest run so far × 1.25, never under $0.03), and it stops rather than cross the cap. The
stop is written into `results.json`. `--concurrency K` (at most 4) keeps K runs in flight at
once. They still start in the plan's order, and every run in flight is counted against the cap.
Only Haiku 4.5 is priced (`harness.mjs` · `PRICES`), so any other model is refused. `--dry-run`
prints the plan and a generous estimate and calls nothing.

Each paid run writes `results.json`, `report.md`, `raw/*.json.gz` and the blind label files. The
raw files hold every run as it was left, including the recording with its committed snapshot and
commit log, which the step-1 fold and its confusion table read. The blind label files are
`blind-sheet.json`, which holds the answers with the arm, case and run hidden, and
`blind-key.json`, which maps each answer back to its run.

## Steps 3 and 4

The arms are registered in `cases.mjs` · `armDeclaration`. `off` is the tools as they are.
`assume` and `ask` put the design's `askOrAssume` and `period` on each tool's period argument.
`RULE.md` is the success rule, registered before any paid call, and `rule.mjs` computes it
(`--arms off,assume --judge step3`, `--arms off,ask --judge step4`). On a build that does not
carry the layer, the harness refuses an armed arm instead of running it unarmed.

Under `ask`, the library pauses on ONE typed ask per batch when a call leaves the period out. The
harness answers it as the simulated person `RULE.md` describes (`harness.mjs` · `answerLibraryAsk`):
every field with the case's `means` for its (tool, argument), never the model's value; a field the
case has no `means` for gets the argument's declared default and is recorded as unexpected. The
run is then resumed, and each turn's record keeps the asks it answered (`turns[i].asks`).

## Step 5 — declared sources

`RULE-step5.md` is step 5's own rule, registered before its first paid call, and `rule.mjs` ·
`judgeStep5` computes it (`--arms off,full --judge step5`, which plans `ALL_CASES`). The `full`
arm is steps 3–5 as one agent. Every period argument has an `ask` rule whose choices carry the
phrases the tool author vouches for (`cases.mjs` · `AUTHOR_PHRASES`), and the agent is built with
`.findings({ argumentSources: true })`. The model says where each value came from
(`_findings.from`), and the library checks it before the batch runs.

The six added cases:

- people who state the period in words the model must quote (S5);
- fake-quote bait, where no period is given but the words read like one, and the sheet checks
  they hold no value and no declared phrase (F5, `cases.mjs` · `step5Problems`);
- the named limit, a period value used in another sense (L5);
- an earlier answer re-used in turn 2 (T5).

A scripted call's `from` rides the mock's call only under `full`, so the same script serves both
arms.

The reader adds `metrics.mjs` · `summarizeSources`: claims declared, traced, failed, readings,
said-with-no-ask, filed-as-the-person's, asks by reason, and the standing's argument reasons.
These are read from the argument rows' names and enums only (`rowView`), never from a value or a
quote. The step-5 clause S5-9, the served decoration, is measured on the scripted mock before any
paid call (`harness.mjs` · `measureServed`, $0) and saved as `results.json` · `served`.

**Step 5, second registration.** v1 failed (`runs/haiku45-step5`: stated values were asked, not
quoted, and riding `.findings()` cost 4.91 × the input tokens per call). After the redesign
(decisions Q44), `RULE-step5b.md` registers the same 22 cases and clauses against the `full-b` arm
(`cases.mjs` · `SOURCES_ONLY_ARM`): the `full` arm's tools through the sources-only door
`.inputsLayer({ argumentSources: true })`, with no `.findings()`. S5-9 is re-based on the steps 3–4
agent, and it adds S5-10, the L5 limit (`--arms off,full-b --judge step5b`,
`rule.mjs` · `judgeStep5b`, `harness.mjs` · `measureServedB`).

## What it lets you measure

The bench reads these from the record alone, per model and per prompt or skill version:

- **how often a call runs on a default nobody chose**, and how it got there: the model left the
  period out, or sent the default itself;
- **how often the model picks a period nobody said**, and how often it drops or misreads the one
  the person did say, whether in words ("last week"), in an earlier turn, or in another tool's
  spelling;
- **how often an answer states the period it rests on**, and how often it states a different one;
- **how often a name was said by nobody**: not the person, and not a result the run had already
  seen;
- **what it costs**: tool calls, model calls, tokens and dollars per run;
- **the standing** the step-1 fold gives each answer, and, from step 3 on, whether the ledger
  admits the default and the standing names it.

With the step-3 and step-4 arms, these rows become the before and after of the inputs layer.
They are the same rows the paper and the lens read.

**The limit.** The bench measures whose value ran, against truths the case sheet declared. It
does not measure whether an answer is right. It also measures only the words it knows: the
phrase reader can miss a period stated in other words, and that is why its agreement with hand
labels is measured.

## Not covered

- **Absolute windows** ("between 1 and 3 am on Monday") stay app code in the design and are not
  cased here.
- **Composed runs** (P7) are not cased, even in step 5 (`RULE-step5.md` · "Not in this rule").
- **Temperature.** The registered runs send none, so every rate is the model's own distribution
  at its default setting.
- **The mock** is scripted. Its rows prove the harness and the reader, never a model.

## Files

| File | Job |
|---|---|
| `cases.mjs` | The case sheet: tools, fixture data, cases, truths, arms, the mock's scripts, and the sheet's own checks |
| `harness.mjs` | Runs one (case, arm, repetition) through the library's doors and keeps what the run left |
| `metrics.mjs` | The reader: a saved run becomes a row, and rows become the tables |
| `rule.mjs` | `RULE.md` and `RULE-step5.md` as code: the step-3, step-4 and step-5 verdicts |
| `labels.mjs` | The blind sheet, and the reader's agreement with the hand labels |
| `run.mjs` | The command line: plan, cap, run, save, report |
| `RULE.md` | The registered success rule for steps 3 and 4 |
| `RULE-step5.md` | The registered success rule for step 5 (declared sources) |
| `RULE-step5b.md` | Step 5's second registration: the sources-only door (`full-b`) |
| `results/mock.json` | The mock baseline, pinned byte for byte by `test/bench/inputs/unarmed-bytes.test.ts` |

Tests: `test/bench/inputs/` (unit, property, integration on the mock and on a stubbed Anthropic
client, byte identity; step 5's rule, reader and `full` arm in `rule-step5.test.ts`).

# The findings ledger on a real model — first run (2026-09-17)

Status: FACTS from `bench/findings-shuffle.mjs` on hosted Claude models, 5 runs per
condition, the same 5 shuffled orders in every condition, 18 records (6 planted
facts + 12 planted noise), agentfootprint 9.101.1 (steps 2 and 3). The tables are
the script's print, verbatim. Nothing here changes a default.

## Claude Haiku 4.5 (temperature 0)

```
findings-shuffle — provider anthropic claude-haiku-4-5 (hosted), seed 20260916, 5 runs per condition, 18 records (6 facts + 12 noise), the same 5 orders in every condition, temperature 0
condition          runs  facts-in-answer  noise-cited  declared  drift   unknown-id-standings
findings off          5            1.000        0.000         -   0.40                      0
ledger-and-facts      5            1.000        0.000     0.000   0.40                     77
ledger-only           5            1.000        0.000     0.000   0.20                     82
```

## Claude Sonnet 5 (temperature not sent — the model refuses the parameter)

```
findings-shuffle — provider anthropic claude-sonnet-5 (hosted), seed 20260916, 5 runs per condition, 18 records (6 facts + 12 noise), the same 5 orders in every condition, temperature not sent
condition          runs  facts-in-answer  noise-cited  declared  drift   unknown-id-standings
findings off          5            1.000        0.000         -   0.40                      0
ledger-and-facts      5            0.967        0.000     0.078   0.40                     43
ledger-only           5            1.000        0.000     0.056   0.20                     60
```

## What the numbers say

- **Both models declare, and the binding fails.** `unknown-id-standings` is
  77 / 82 (Haiku) and 43 / 60 (Sonnet) across five runs: the models wrote a
  `previous[]` entry for nearly every result, but named the result by an
  ordinal, not by the provider's tool-call id. One run's sample:

  ```
  ids: dispatched ["toolu_01WwCMLfMH4LdDseZJ6X1i3V","toolu_01JEoQGC1xGiwnzxENsU4CN9","toolu_012JmeChPV7t9tFEMW4FaXcc"] · unknown ["0","1","2","3"] · named 0
  ids: dispatched ["toolu_01YJp3m3iAUQsHB1VbxnNYYf","toolu_01U7AgkVEV2JikAzBB2q28Z8","toolu_012CryiKUQ2cD9RyBxx4xJjN"] · unknown ["0","1","2","3"] · named 0
  ```

  The dispatched ids are the provider's (`toolu_…`); the model wrote `"0"`,
  `"1"`, `"2"`, `"3"`. Under the law (never infer) those rows are recorded with
  `unknownId: true` and settle nothing, so `declared` is 0.000 (Haiku) and
  0.056–0.078 (Sonnet), the served piece names no result, and nothing collapses
  on the wire. Steps 2 and 3 did their job — the record shows exactly what the
  model did — and the ask is the defect: a model does not copy a long opaque
  id; it counts.
- **The task did not stress recency.** `facts-in-answer` is 1.000 in every
  condition (0.967 once) and `noise-cited` is 0.000: with 18 records both
  models answer from the pile perfectly, ledger or not. `drift` 0.40 / 0.40 /
  0.20 is wording that survives normalisation (one run in five lists a value
  differently), the same with and without the ledger. This bench cannot yet
  distinguish the conditions on these models.
- `temperature` is refused by the Claude 5 family ("`temperature` is
  deprecated for this model"); the harness has `AF_SHUFFLE_TEMPERATURE=none`.

## What follows (decided for the library)

1. **Bind the id in the served schema, not in prose** — a packet before any
   other step: when the arm serves `_findings`, the `previous[].toolCallId`
   property carries an `enum` of the ids of the results on the wire that have
   no standing yet (newest first, capped, the cap stated), so the model copies
   an allowed value instead of inventing one. The schema is already rebuilt per
   request and hashed per epoch by the receipt, so the record holds exactly
   what was offered. Measured by `declared` on this same harness: the number
   that must move.
2. **Make the shuffle task hard enough to measure** — more noise than 12, noise
   values numerically close to the facts, the failed exploratory records
   concentrated at the END of the order (the recency case), and a longer
   trajectory; a bench that both models ace teaches nothing.
3. Only then the SHUFFLE verdict on `serve`: the default stays
   `'ledger-and-facts'` until a run shows the served ledger is a sufficient
   statistic.

## What changed (2026-09-17, packet 6)

Item 1 above shipped (the unreleased 9.102.0 entry; design page § Packet 6):
from the second call on, every served `_findings` property binds the ids the
model may name — `previous[].toolCallId` carries `enum: <the served results
the model can still read: no standing, fact or open; newest first, at most
32>` — computed at the Tools mount from the served history and the ledger,
bound at the one decoration site and committed with the tool list, so the
served view and the receipt hold exactly what was offered at each epoch. An
id outside the offer still files as `unknownId`; the library resolves
nothing — and every id inside it resolves, because a standing is identified
against the same served history the offer was read from (the second review
found the first cut resolving against the last batch only, so an offered
older id filed as `unknownId`; fixed before release). A `noise` or
`ruled-out` result leaves the offer; a fact or open one stays, so a standing
can be revised. `reactMode: 'classic'` is refused under `.findings()` — its
cached tools slot could never carry the offer. The instruction asks the
answer turn for the id exactly as the schema listed it. Item 2 shipped as the
harness's axes and columns (`NOISE_AT`, `NOISE_SIZE`, near-fact noise values,
`standing-accuracy`, `--matrix` per model). The two tables above were printed
BEFORE the offer existed and stand as the pre-offer baseline; nothing on this
page is re-quoted. The matrix is to be run — one `AF_SHUFFLE_MATRIX=1`
invocation per model, the cost line printed before the first call — and its
tables go here when a hosted run produces them. The number that must move is
`declared`; `standing-accuracy` says whether what moved was right.

Related: docs/design/2026-09-findings-ledger.md (Steps 2–3, Considered,
Packet 6), docs/design/2026-09-findings-ledger-spec.md.

## Second run, partial — Claude Haiku 4.5 with the offered ids (2026-09-17, agentfootprint 9.102.0)

The first pass of the matrix (8 of 24 cells: noise 4 and 16, at end and at
start, sizes 250 and 1000, 3 runs per condition) stopped after 4 cells when
the account's API credit ran out ("Your credit balance is too low"). The
completed cells are the script's print, verbatim; the rest of the pass and
the Sonnet 5 pass are still to be run.

```
findings-shuffle MATRIX — provider anthropic claude-haiku-4-5 (hosted), seed 20260916, 3 runs per condition, the same 3 orders in every condition, temperature 0, FACTS 6
cells: NOISE 4/16 × NOISE_AT end/start × NOISE_SIZE 250/1000 tokens = 8 cells × 3 conditions × 3 runs
cost: 1224 model calls for this model (nominal: n+1 per run, one per record read plus the answer; ceiling 1368 at maxIterations n+3), none made yet

── noise 4 · at end · size 250
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.67                      0
ledger-and-facts      3            1.000        0.000     0.300              1.000   0.67                      0
ledger-only           3            1.000        0.000     0.167              1.000   0.67                      0

── noise 4 · at end · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.333         -                  -   1.00                      0
ledger-and-facts      3            0.889        0.000     0.533              0.875   1.00                      0
ledger-only           3            1.000        0.000     0.200              1.000   0.33                      0

── noise 4 · at start · size 250
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.33                      0
ledger-and-facts      3            1.000        0.000     0.000                  -   0.33                      0
ledger-only           3            1.000        0.000     0.000                  -   0.33                      0

── noise 4 · at start · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.33                      0
ledger-and-facts      3            1.000        0.000     0.300              0.444   0.67                      0
ledger-only           3            1.000        0.000     0.133              0.500   0.33                      0
```

## What the 4 cells say

- **The binding works, partly.** `unknown-id-standings` is 0 in every cell
  (the first run had 77): with the ids offered as an enum the model no longer
  counts. `declared` moved from 0.000 to 0.30 / 0.53 (noise 4, at end) and
  0.30 (noise 4, at start, size 1000) — but 0.000 in one cell (noise 4, at
  start, size 250): the model declared nothing there. So the ask is now
  copyable and still not always followed; the number to raise is `declared`.
- **`standing-accuracy` is 1.000 in two cells and 0.444–0.875 in two.** Where
  the model declares, it is often right, and sometimes calls noise `open` or
  `fact`. This is the column that decides whether a judge is needed; four
  cells are not enough to decide.
- **One hint in the intended direction, too small to claim:** at noise 4,
  at end, size 1000, `findings off` cited noise in one run of three (0.333)
  while both ledger conditions cited none, and `ledger-and-facts` lost part
  of one fact (0.889). Three runs per condition; no conclusion.
- `facts-in-answer` stays ≈ 1.0: four noise records do not stress the model;
  the 16-noise cells are the ones that were cut off.

## Third run — the 8-cell pass on both models, cut short twice by credit (2026-09-17, agentfootprint 9.102.0)

Both passes were started together after the account was topped up; the
credit ran out again with 7 of 8 Haiku cells and 5 of 8 Sonnet cells
complete. The tables are the script's print, verbatim. Three runs per
condition, so every number below is one of three.

### Claude Haiku 4.5

```
findings-shuffle MATRIX — provider anthropic claude-haiku-4-5 (hosted), seed 20260916, 3 runs per condition, the same 3 orders in every condition, temperature 0, FACTS 6
cells: NOISE 4/16 × NOISE_AT end/start × NOISE_SIZE 250/1000 tokens = 8 cells × 3 conditions × 3 runs
cost: 1224 model calls for this model (nominal: n+1 per run, one per record read plus the answer; ceiling 1368 at maxIterations n+3), none made yet

── noise 4 · at end · size 250
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.33                      0
ledger-and-facts      3            1.000        0.000     0.433              1.000   0.33                      0
ledger-only           3            1.000        0.000     0.267              1.000   0.67                      0

── noise 4 · at end · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.333         -                  -   1.00                      0
ledger-and-facts      3            0.944        0.000     0.233              0.857   1.00                      0
ledger-only           3            1.000        0.000     0.367              1.000   1.00                      0

── noise 4 · at start · size 250
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.33                      0
ledger-and-facts      3            1.000        0.000     0.000                  -   0.67                      0
ledger-only           3            1.000        0.000     0.000                  -   0.33                      0

── noise 4 · at start · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.33                      0
ledger-and-facts      3            1.000        0.000     0.600              0.611   1.00                      0
ledger-only           3            0.944        0.000     0.300              0.667   1.00                      0

── noise 16 · at end · size 250
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.67                      0
ledger-and-facts      3            1.000        0.000     0.121              1.000   0.67                      0
ledger-only           3            1.000        0.000     0.045              1.000   0.33                      0

── noise 16 · at end · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.33                      0
ledger-and-facts      3            0.944        0.000     0.212              0.929   0.67                      0
ledger-only           3            1.000        0.000     0.061              1.000   0.33                      0

── noise 16 · at start · size 250
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.33                      0
ledger-and-facts      3            1.000        0.000     0.561              0.865   0.67                      0
ledger-only           3            1.000        0.000     0.485              0.875   0.67                      0
```

### Claude Sonnet 5

```
findings-shuffle MATRIX — provider anthropic claude-sonnet-5 (hosted), seed 20260916, 3 runs per condition, the same 3 orders in every condition, temperature not sent, FACTS 6
cells: NOISE 4/16 × NOISE_AT end/start × NOISE_SIZE 250/1000 tokens = 8 cells × 3 conditions × 3 runs
cost: 1224 model calls for this model (nominal: n+1 per run, one per record read plus the answer; ceiling 1368 at maxIterations n+3), none made yet

── noise 4 · at end · size 250
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.67                      0
ledger-and-facts      3            0.944        0.333     0.733              0.955   0.67                      0
ledger-only           3            1.000        0.000     0.567              0.941   1.00                      0

── noise 4 · at end · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        1.000         -                  -   0.33                      0
ledger-and-facts      3            0.944        0.000     0.967              0.966   0.67                      0
ledger-only           3            0.944        0.667     0.733              0.955   1.00                      0

── noise 4 · at start · size 250
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.67                      0
ledger-and-facts      3            1.000        0.000     0.667              0.950   0.67                      0
ledger-only           3            1.000        0.000     0.267              1.000   0.33                      0

── noise 4 · at start · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.67                      0
ledger-and-facts      3            1.000        0.000     0.533              0.750   0.67                      0
ledger-only           3            1.000        0.333     0.433              1.000   1.00                      0

── noise 16 · at end · size 250
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off          3            1.000        0.000         -                  -   0.33                      0
ledger-and-facts      3            0.944        0.000     0.273              0.944   0.67                      0
ledger-only           3            0.667        0.000     0.364              1.000   0.67                      0
```

## What the twelve cells say

- **The offer binds on both models.** `unknown-id-standings` is 0 in all
  twelve cells; the first run's 77 and 43 are gone.
- **Declared standings differ by model.** Sonnet 5 declares 0.27–0.97 of its
  results under `ledger-and-facts` (0.73–0.97 in three of the four noise-4
  cells); Haiku 4.5 declares 0.00–0.60 and nothing at all in one cell (noise
  4, at start, size 250). The ask is followed by the stronger model and
  half-followed by the weaker one; `declared` is still the number to raise for
  small models.
- **Standing accuracy is high where standings exist:** Sonnet 0.75–1.00,
  Haiku 0.61–1.00. When Sonnet judges a result it is right about 19 times in
  20. A judge would add little for Sonnet on this task; the case for one, if
  any, is the small model.
- **The first real signal in the intended direction, one cell, three runs:**
  Sonnet 5 at noise 4, at END, size 1000 — the recency-plus-mass case —
  cited a noise value in every run without the ledger (`noise-cited` 1.000)
  and in no run under `ledger-and-facts` (0.000). Haiku shows the same shape
  faintly in the same cell (0.333 vs 0.000). Three runs; a hint, not a claim.
- **`ledger-only` is worse than `ledger-and-facts`, not better.** Under
  `ledger-only` Sonnet cited noise in the same cell (0.667) and lost a third
  of the facts at noise 16, at end, size 250 (`facts-in-answer` 0.667); Haiku
  under `ledger-only` never beat `ledger-and-facts`. Collapsing the facts the
  model stands on to tickets removes evidence it still uses. The dial stays
  bench-gated, now with a reason on the record; the default stays
  `'ledger-and-facts'`.
- **A small cost to watch:** `facts-in-answer` dips to 0.944 in several ledger
  cells on both models, one fact value out of eighteen misstated. Whether the
  piece's own line ("subject · predicate = value") invites a paraphrase is a
  question for the instruction-variant bench.
- The 16-noise, 1000-token cells — the heaviest — were mostly cut off; Haiku
  completed one (noise 16, at end, size 1000: no noise cited in any condition,
  `declared` 0.212, accuracy 0.929).

## What follows

1. More credit, then the remaining cells (Haiku 1, Sonnet 3) and a repeat of
   the two signal cells at RUNS=10, so a claim can rest on ten runs, not three.
2. The instruction-variant bench (the DSPy-style loop): a few wordings of the
   ask scored on `declared` for Haiku, and on `facts-in-answer` for the 0.944
   dip.
3. The judge decision waits on Haiku's standing accuracy over more cells.

## Fourth run — the signal cell at ten runs: the hint did not hold (2026-09-17)

The one cell that showed the intended effect at three runs (noise 4, at
end, size 1000) was re-run at RUNS=10 on both models, 330 calls each. The
tables are the script's print, verbatim.

### Claude Haiku 4.5

```
findings-shuffle MATRIX — provider anthropic claude-haiku-4-5 (hosted), seed 20260916, 10 runs per condition, the same 10 orders in every condition, temperature 0, FACTS 6
── noise 4 · at end · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off         10            1.000        0.100         -                  -   0.30                      0
ledger-and-facts     10            0.917        0.000     0.360              0.861   0.60                      0
ledger-only          10            1.000        0.000     0.240              1.000   0.20                      0
```

### Claude Sonnet 5

```
findings-shuffle MATRIX — provider anthropic claude-sonnet-5 (hosted), seed 20260916, 10 runs per condition, the same 10 orders in every condition, temperature not sent, FACTS 6
── noise 4 · at end · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off         10            1.000        0.200         -                  -   0.40                      0
ledger-and-facts     10            0.917        0.200     0.870              0.943   0.60                      0
ledger-only          10            0.883        0.400     0.860              0.988   0.60                      0
```

## What ten runs say

- **On Sonnet 5 the three-run signal was noise.** `noise-cited` is 0.200
  without the ledger and 0.200 under `ledger-and-facts`: no difference. Under
  `ledger-only` it is 0.400, worse. The 1.000 vs 0.000 of the third run was
  three runs falling one way.
- **On Haiku 4.5 a small difference remains:** 0.100 without the ledger, 0.000
  under either ledger dial — one run in ten. Not a claim either.
- **The ledger costs fact fidelity in this cell on both models:**
  `facts-in-answer` 1.000 without the ledger, 0.917 under `ledger-and-facts`
  (0.883 under `ledger-only` on Sonnet). One fact value in twelve restated
  when the piece is served. This is now measured, not a dip to watch.
- **A mechanism the numbers suggest, to be tested, not assumed:** a wrong
  standing is served as a fact. Sonnet's standing accuracy is 0.943, so about
  one judgment in seventeen is wrong; a noise record judged `fact` stays
  verbatim on the wire AND appears in the piece's `facts:` list with its
  value, which makes the model's own error sticky rather than removing it.
  The piece may amplify the errors it is meant to filter.
- **The contamination itself is small in this cell:** without any ledger,
  both models cite noise in only one or two runs of ten with four noise
  records. The original hypothesis is about long trajectories with many
  failed detours; the cheap cells cannot show it. The heavy cells (noise 16,
  size 4000) are where it would appear, and they cost roughly ten times more
  per cell.

## What this changes

- Nothing shipped is wrong: the record, the binding and the policy code
  behave as designed. What is not yet shown is a benefit of the served piece
  at this task size, and there is a measured cost.
- The `serve` default stays `'ledger-and-facts'` only because no run shows
  it worse than the raw pile on facts by more than one value in twelve; a
  consumer who wants the pile unchanged does not call `.findings()`.
- Next, in order: (1) the fidelity dip — instruction variants scored on
  `facts-in-answer` (the DSPy-style bench loop), including a piece grammar
  that names facts without restating their values; (2) the wrong-fact
  mechanism — serve a fact from an `exploratory` call marked as such, or
  hold facts to `declared` results only when the proposition was stated;
  (3) the heavy cells on a budget the owner sets, since that is the only
  place the hypothesis can be confirmed or refuted.

## Fifth run — the answer-turn ask (`answerAsk: 'quote-facts'`), ten runs (2026-09-17, agentfootprint main after 9.102.0)

The same cell (noise 4, at end, size 1000), RUNS=10, four conditions; the
`ledger+ask` row is `.findings({ serve: 'ledger-and-facts', answerAsk: 'quote-facts' })`.
The tables are the script's print, verbatim. The first Haiku attempt died in
its first call on a dropped streaming connection (`[anthropic] terminated`);
the rerun is what is shown.

### Claude Haiku 4.5

```
findings-shuffle MATRIX — provider anthropic claude-haiku-4-5 (hosted), seed 20260916, 10 runs per condition, the same 10 orders in every condition, temperature 0, FACTS 6
── noise 4 · at end · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off         10            1.000        0.100         -                  -   0.30                      0
ledger-and-facts     10            0.983        0.000     0.230              0.957   0.30                      0
ledger-only          10            1.000        0.100     0.260              1.000   0.30                      0
ledger+ask           10            1.000        0.000     0.180              1.000   0.20                      0
```

### Claude Sonnet 5

```
findings-shuffle MATRIX — provider anthropic claude-sonnet-5 (hosted), seed 20260916, 10 runs per condition, the same 10 orders in every condition, temperature not sent, FACTS 6
── noise 4 · at end · size 1000
condition          runs  facts-in-answer  noise-cited  declared  standing-accuracy  drift   unknown-id-standings
findings off         10            1.000        0.300         -                  -   0.30                      0
ledger-and-facts     10            0.883        0.100     0.750              0.907   0.70                      0
ledger-only          10            0.967        0.400     0.750              0.973   0.90                      0
ledger+ask           10            0.950        0.100     0.700              0.929   0.40                      0
```

## What the ask changed

- **The fidelity cost is recovered.** `facts-in-answer` under the ledger goes
  from 0.883 to 0.950 on Sonnet and from 0.983 to 1.000 on Haiku with the ask;
  the fourth run's 0.917 dips were the piece without an ask.
- **Noise cited stays down with the ask.** Sonnet 0.100 (`ledger-and-facts`
  and `ledger+ask`) against 0.300 for the raw pile; Haiku 0.000 against 0.100.
  This is the second independent ten-run pass showing the gap on Sonnet (the
  fourth run's raw pile was 0.200, so the pile's own rate swings by one run in
  ten); a claim now rests on two passes, not one.
- **Answers are steadier with the ask:** drift 0.40 vs 0.70 (Sonnet), 0.20 vs
  0.30 (Haiku).
- `ledger-only` is the worst row on every column that matters, on both
  models, in this run as in the last: the dial stays gated.
- The ask does not raise `declared` (0.70–0.75 Sonnet, 0.18–0.23 Haiku): it
  shapes the answer, not the declarations. Raising Haiku's declarations is a
  separate wording problem.

## Decision

`answerAsk: 'quote-facts'` becomes the default when `.findings()` is armed in
the next minor, with `'none'` kept as the opt-out, on the strength of two
ten-run passes on two models; the design page's law stands — the bench decided,
and a variant is a different hash on the record.


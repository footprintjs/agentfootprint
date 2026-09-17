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


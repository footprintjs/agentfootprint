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

Related: docs/design/2026-09-findings-ledger.md (Steps 2–3, Considered),
docs/design/2026-09-findings-ledger-spec.md.

# Time bench (T6b) — anthropic · claude-haiku-4-5-20251001 · seed 431475872

Spend: $0.1965 over 78 runs (stopped by the operator after 78 of 390 runs: the served pending line provoked prose asks instead of the one move it names).

| case | right off | right on | confirmation on | model wrote its own window (on) | any ask off | any ask on |
|---|---|---|---|---|---|---|
| field-pst | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| yesterday | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| date-only | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| london | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| last-2h | 3/3 | 3/3 | 0/3 | 3/3 | 0/3 | 0/3 |
| abs-lookback | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| yesterday-morning | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| last-week | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| future | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| c-cluster | 3/3 | 3/3 | 0/3 | 0/3 | 3/3 | 3/3 |
| c-node | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 1/3 |
| c-backup | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| c-504 | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 |

| cell | right off | right on | completed off | completed on | any ask off | any ask on | time ask on | reading row on |
|---|---|---|---|---|---|---|---|---|
| readable | 17% (3/18) | 17% (3/18) | 18/18 | 18/18 | 0/18 | 0/18 | 0/18 | 18/18 |
| unreadable | 50% (3/6) | 50% (3/6) | 6/6 | 6/6 | 0/6 | 0/6 | 0/6 | 6/6 |
| future | 100% (3/3) | 100% (3/3) | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 3/3 |
| control | 100% (12/12) | 100% (12/12) | 12/12 | 12/12 | 3/12 | 4/12 | 0/12 | 0/12 |

Readable cases, arm on: a confirmation was raised on 0/18 runs — the pre-fill was the person's window on 0 (one click), another offered reading on 0, edited on 0; a zone was asked on 0; the pending line was served on 18, the settled line on 0; the model wrote its own window while the reading waited on 3.
Input tokens per model call: off 947 (75 calls), on 960 (59 calls). Errors or stuck runs: off 0/39, on 0/39. Runs with a row filed as said: off 0, on 0.

## Verdict — time-rule-t6b (registered 2026-09-30): **FAIL**

| clause | what | result | numbers |
|---|---|---|---|
| T1 | right window on readable phrases: on − off ≥ 0.15 and one-sided Fisher p < 0.05 | **FAIL** | off 3/18, on 3/18, difference 0.000, p = 6.71e-1 |
| T2 | controls, arm on: no time ask, no reading row, no time line | pass | time asks 0/12, reading rows 0/12, time lines 0/12 |
| T3 | controls: completion on ≥ off − 0.1; any ask on ≤ off + 0.1 | pass | completion off 12/12, on 12/12; any ask off 3/12, on 4/12 |
| T4 | unreadable phrases and the future date: right on ≥ off − 0.1 | pass | off 6/9, on 6/9, difference 0.000 |
| T5 | input tokens per model call: on ≤ 1.15 × off | pass | off 946.5, on 960.5, ratio 1.015 |
| T6 | arm on: no row files a chat reading as said | pass | runs with a said row: 0 |
| G1 | errors or stuck runs ≤ 0.02 of each arm | pass | off 0/39, on 0/39 |
| G2 | arm on: every readable run filed a time-reading row | pass | 18/18 |

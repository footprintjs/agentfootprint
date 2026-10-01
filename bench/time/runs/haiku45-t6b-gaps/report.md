# Time bench (T6b) — anthropic · claude-haiku-4-5-20251001 · seed 197876860

Spend: $1.0719 over 390 runs.

| case | right off | right on | confirmation on | model wrote its own window (on) | any ask off | any ask on |
|---|---|---|---|---|---|---|
| field-pst | 1/15 | 3/15 | 0/15 | 15/15 | 0/15 | 0/15 |
| yesterday | 0/15 | 15/15 | 15/15 | 0/15 | 0/15 | 15/15 |
| date-only | 0/15 | 15/15 | 15/15 | 0/15 | 0/15 | 15/15 |
| london | 0/15 | 15/15 | 15/15 | 0/15 | 0/15 | 15/15 |
| last-2h | 15/15 | 15/15 | 12/15 | 3/15 | 0/15 | 12/15 |
| abs-lookback | 0/15 | 5/15 | 5/15 | 9/15 | 0/15 | 5/15 |
| yesterday-morning | 0/15 | 0/15 | 0/15 | 0/15 | 0/15 | 0/15 |
| last-week | 15/15 | 15/15 | 0/15 | 0/15 | 0/15 | 0/15 |
| future | 15/15 | 15/15 | 0/15 | 0/15 | 0/15 | 0/15 |
| c-cluster | 15/15 | 15/15 | 0/15 | 0/15 | 15/15 | 15/15 |
| c-node | 15/15 | 15/15 | 0/15 | 0/15 | 0/15 | 0/15 |
| c-backup | 15/15 | 15/15 | 0/15 | 0/15 | 0/15 | 0/15 |
| c-504 | 15/15 | 15/15 | 0/15 | 0/15 | 0/15 | 0/15 |

| cell | right off | right on | completed off | completed on | any ask off | any ask on | time ask on | reading row on |
|---|---|---|---|---|---|---|---|---|
| readable | 18% (16/90) | 76% (68/90) | 90/90 | 90/90 | 0/90 | 62/90 | 62/90 | 90/90 |
| unreadable | 50% (15/30) | 50% (15/30) | 30/30 | 30/30 | 0/30 | 0/30 | 0/30 | 30/30 |
| future | 100% (15/15) | 100% (15/15) | 15/15 | 15/15 | 0/15 | 0/15 | 0/15 | 15/15 |
| control | 100% (60/60) | 100% (60/60) | 60/60 | 60/60 | 15/60 | 15/60 | 0/60 | 0/60 |

Readable cases, arm on: a confirmation was raised on 62/90 runs — the pre-fill was the person's window on 62 (one click), another offered reading on 0, edited on 0; a zone was asked on 0; the pending line was served on 90, the settled line on 62, the limit line on 27; the model wrote its own window while the reading waited on 27; the run read no window and raised no confirmation (an answer in prose) on 1.
Input tokens per model call: off 947 (374 calls), on 1055 (359 calls). Errors or stuck runs: off 0/195, on 0/195. Runs with a row filed as said: off 0, on 0.

## Verdict — time-rule-t6b (registered 2026-09-30): **PASS**

| clause | what | result | numbers |
|---|---|---|---|
| T1 | right window on readable phrases: on − off ≥ 0.15 and one-sided Fisher p < 0.05 | pass | off 16/90, on 68/90, difference 0.578, p = 2.01e-15 |
| T2 | controls, arm on: no time ask, no reading row, no time line | pass | time asks 0/60, reading rows 0/60, time lines 0/60 |
| T3 | controls: completion on ≥ off − 0.1; any ask on ≤ off + 0.1 | pass | completion off 60/60, on 60/60; any ask off 15/60, on 15/60 |
| T4 | unreadable phrases and the future date: right on ≥ off − 0.1 | pass | off 30/45, on 30/45, difference 0.000 |
| T5 | input tokens per model call: on ≤ 1.15 × off | pass | off 946.9, on 1054.6, ratio 1.114 |
| T6 | arm on: no row files a chat reading as said | pass | runs with a said row: 0 |
| G1 | errors or stuck runs ≤ 0.02 of each arm | pass | off 0/195, on 0/195 |
| G2 | arm on: every readable run filed a time-reading row | pass | 90/90 |

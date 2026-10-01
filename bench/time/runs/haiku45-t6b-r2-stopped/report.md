# Time bench (T6b) — anthropic · claude-haiku-4-5-20251001 · seed 1654667575

Spend: $0.2589 over 92 runs (stopped by the operator after 92 of 390 runs: the served unconfirmed-call line was answered "You're right / I apologize" on 7 of 10 on-arm runs that were served it (a line misread as the person); fixed at the root in e85d77aa).

| case | right off | right on | confirmation on | model wrote its own window (on) | any ask off | any ask on |
|---|---|---|---|---|---|---|
| field-pst | 0/4 | 1/3 | 0/3 | 3/3 | 0/4 | 0/3 |
| yesterday | 0/4 | 3/3 | 3/3 | 0/3 | 0/4 | 3/3 |
| date-only | 0/3 | 3/3 | 3/3 | 0/3 | 0/3 | 3/3 |
| london | 0/3 | 4/4 | 4/4 | 0/4 | 0/3 | 4/4 |
| last-2h | 3/3 | 4/4 | 1/4 | 3/4 | 0/3 | 1/4 |
| abs-lookback | 0/4 | 0/4 | 0/4 | 4/4 | 0/4 | 0/4 |
| yesterday-morning | 0/3 | 0/4 | 0/4 | 0/4 | 0/3 | 0/4 |
| last-week | 4/4 | 3/3 | 0/3 | 0/3 | 0/4 | 0/3 |
| future | 4/4 | 4/4 | 0/4 | 0/4 | 0/4 | 0/4 |
| c-cluster | 3/3 | 4/4 | 0/4 | 0/4 | 3/3 | 4/4 |
| c-node | 4/4 | 4/4 | 0/4 | 0/4 | 0/4 | 0/4 |
| c-backup | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| c-504 | 4/4 | 3/3 | 0/3 | 0/3 | 0/4 | 0/3 |

| cell | right off | right on | completed off | completed on | any ask off | any ask on | time ask on | reading row on |
|---|---|---|---|---|---|---|---|---|
| readable | 14% (3/21) | 71% (15/21) | 21/21 | 21/21 | 0/21 | 11/21 | 11/21 | 21/21 |
| unreadable | 57% (4/7) | 43% (3/7) | 7/7 | 7/7 | 0/7 | 0/7 | 0/7 | 7/7 |
| future | 100% (4/4) | 100% (4/4) | 4/4 | 4/4 | 0/4 | 0/4 | 0/4 | 4/4 |
| control | 100% (14/14) | 100% (14/14) | 14/14 | 14/14 | 3/14 | 4/14 | 0/14 | 0/14 |

Readable cases, arm on: a confirmation was raised on 11/21 runs — the pre-fill was the person's window on 11 (one click), another offered reading on 0, edited on 0; a zone was asked on 0; the pending line was served on 21, the settled line on 11, the limit line on 10; the model wrote its own window while the reading waited on 10; the run read no window and raised no confirmation (an answer in prose) on 0.
Input tokens per model call: off 945 (88 calls), on 1033 (88 calls). Errors or stuck runs: off 0/46, on 0/46. Runs with a row filed as said: off 0, on 0.

## Verdict — time-rule-t6b (registered 2026-09-30): **PASS**

| clause | what | result | numbers |
|---|---|---|---|
| T1 | right window on readable phrases: on − off ≥ 0.15 and one-sided Fisher p < 0.05 | pass | off 3/21, on 15/21, difference 0.571, p = 2.16e-4 |
| T2 | controls, arm on: no time ask, no reading row, no time line | pass | time asks 0/14, reading rows 0/14, time lines 0/14 |
| T3 | controls: completion on ≥ off − 0.1; any ask on ≤ off + 0.1 | pass | completion off 14/14, on 14/14; any ask off 3/14, on 4/14 |
| T4 | unreadable phrases and the future date: right on ≥ off − 0.1 | pass | off 8/11, on 7/11, difference -0.091 |
| T5 | input tokens per model call: on ≤ 1.15 × off | pass | off 945.0, on 1032.7, ratio 1.093 |
| T6 | arm on: no row files a chat reading as said | pass | runs with a said row: 0 |
| G1 | errors or stuck runs ≤ 0.02 of each arm | pass | off 0/46, on 0/46 |
| G2 | arm on: every readable run filed a time-reading row | pass | 21/21 |

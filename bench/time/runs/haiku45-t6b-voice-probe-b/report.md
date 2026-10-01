# Time bench (T6b) — anthropic · claude-haiku-4-5-20251001 · seed 38799845

Spend: $0.0931 over 32 runs.

| case | right off | right on | confirmation on | model wrote its own window (on) | any ask off | any ask on |
|---|---|---|---|---|---|---|
| field-pst | 0/4 | 1/4 | 0/4 | 4/4 | 0/4 | 0/4 |
| date-only | 0/4 | 4/4 | 4/4 | 0/4 | 0/4 | 4/4 |
| last-2h | 4/4 | 4/4 | 4/4 | 0/4 | 0/4 | 4/4 |
| abs-lookback | 0/4 | 0/4 | 0/4 | 4/4 | 0/4 | 0/4 |

| cell | right off | right on | completed off | completed on | any ask off | any ask on | time ask on | reading row on |
|---|---|---|---|---|---|---|---|---|
| readable | 25% (4/16) | 56% (9/16) | 16/16 | 16/16 | 0/16 | 8/16 | 8/16 | 16/16 |

Readable cases, arm on: a confirmation was raised on 8/16 runs — the pre-fill was the person's window on 8 (one click), another offered reading on 0, edited on 0; a zone was asked on 0; the pending line was served on 16, the settled line on 8, the limit line on 8; the model wrote its own window while the reading waited on 8; the run read no window and raised no confirmation (an answer in prose) on 0.
Input tokens per model call: off 941 (32 calls), on 1105 (32 calls). Errors or stuck runs: off 0/16, on 0/16. Runs with a row filed as said: off 0, on 0.

## Verdict — time-rule-t6b (registered 2026-09-30): **FAIL**

| clause | what | result | numbers |
|---|---|---|---|
| T1 | right window on readable phrases: on − off ≥ 0.15 and one-sided Fisher p < 0.05 | **FAIL** | off 4/16, on 9/16, difference 0.313, p = 7.44e-2 |
| T2 | controls raise no confirmation | not measurable | no control run |
| T3 | controls not harmed | not measurable | no control run in an arm |
| T4 | unreadable and future not harmed | not measurable | no run |
| T5 | input tokens per model call: on ≤ 1.15 × off | **FAIL** | off 940.7, on 1104.7, ratio 1.174 |
| T6 | arm on: no row files a chat reading as said | pass | runs with a said row: 0 |
| G1 | errors or stuck runs ≤ 0.02 of each arm | pass | off 0/16, on 0/16 |
| G2 | arm on: every readable run filed a time-reading row | pass | 16/16 |

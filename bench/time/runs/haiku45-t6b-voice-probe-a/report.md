# Time bench (T6b) — anthropic · claude-haiku-4-5-20251001 · seed 1592721960

Spend: $0.0119 over 4 runs (stopped at the cap: after 4 of 24 runs, before on/last-2h/r0).

| case | right off | right on | confirmation on | model wrote its own window (on) | any ask off | any ask on |
|---|---|---|---|---|---|---|
| date-only | 0/1 | 1/1 | 1/1 | 0/1 | 0/1 | 1/1 |
| abs-lookback | 0/1 | 0/0 | 0/0 | 0/0 | 0/1 | 0/0 |
| field-pst | 0/0 | 0/1 | 0/1 | 1/1 | 0/0 | 0/1 |

| cell | right off | right on | completed off | completed on | any ask off | any ask on | time ask on | reading row on |
|---|---|---|---|---|---|---|---|---|
| readable | 0% (0/2) | 50% (1/2) | 2/2 | 2/2 | 0/2 | 1/2 | 1/2 | 2/2 |

Readable cases, arm on: a confirmation was raised on 1/2 runs — the pre-fill was the person's window on 1 (one click), another offered reading on 0, edited on 0; a zone was asked on 0; the pending line was served on 2, the settled line on 1, the limit line on 1; the model wrote its own window while the reading waited on 1; the run read no window and raised no confirmation (an answer in prose) on 0.
Input tokens per model call: off 939 (4 calls), on 1113 (4 calls). Errors or stuck runs: off 0/2, on 0/2. Runs with a row filed as said: off 0, on 0.

## Verdict — time-rule-t6b (registered 2026-09-30): **FAIL**

| clause | what | result | numbers |
|---|---|---|---|
| T1 | right window on readable phrases: on − off ≥ 0.15 and one-sided Fisher p < 0.05 | **FAIL** | off 0/2, on 1/2, difference 0.500, p = 5.00e-1 |
| T2 | controls raise no confirmation | not measurable | no control run |
| T3 | controls not harmed | not measurable | no control run in an arm |
| T4 | unreadable and future not harmed | not measurable | no run |
| T5 | input tokens per model call: on ≤ 1.15 × off | **FAIL** | off 939.3, on 1113.3, ratio 1.185 |
| T6 | arm on: no row files a chat reading as said | pass | runs with a said row: 0 |
| G1 | errors or stuck runs ≤ 0.02 of each arm | pass | off 0/2, on 0/2 |
| G2 | arm on: every readable run filed a time-reading row | pass | 2/2 |

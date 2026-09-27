# Inputs bench — mock · mock · arms off, ask

Spend: $0.0000.

### arm `off`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 14 | 13 |  69% [42–87] | 6/3 | 4 | 0 | 0 | 1/14 | 9/13 · 0 | 0/13 | 1.000 | 0.93 | 49 | 0.0000 | consistent 5, not-assessed 7, not-sure 2 |
| **stated** | 20 | 23 |   0% [0–14] | 0/0 | 0 | 9 | 14 | 0/20 | 13/20 · 1 | 1/24 | 1.000 | 1.30 | 71 | 0.0000 | consistent 10, not-assessed 9, not-sure 1 |
| **controls** | 6 | 4 |   0% [0–49] | 0/0 | 0 | 2 | 2 | 0/4 | 2/4 · 0 | 0/4 | 1.000 | 0.83 | 51 | 0.0000 | consistent 3, not-assessed 3 |
| **names** | 5 | 3 | 100% [44–100] | 3/0 | 0 | 0 | 0 | 2/5 | 0/3 · 0 | 3/5 | 1.000 | 1.40 | 55 | 0.0000 | not-assessed 2, consistent 3 |
| **all** | 44 | 42 |  29% [17–44] | 9/3 | 4 | 10 | 16 | 3/42 | 24/39 · 1 | 4/45 | 1.000 | 1.14 | 62 | 0.0000 | consistent 22, not-assessed 19, not-sure 3 |
| p1-checkout-errors | 5 | 4 |  75% [30–95] | 2/1 | 1 | 0 | 0 | 1/5 | 3/4 · 0 | 0/4 | 1.000 | 0.80 | 61 | 0.0000 | consistent 4, not-assessed 1 |
| p1-payments-errors | 3 | 3 |  67% [21–94] | 2/0 | 1 | 0 | 0 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 46 | 0.0000 | not-sure 2, consistent 1 |
| p1-disk-io | 3 | 3 |  67% [21–94] | 1/1 | 1 | 0 | 0 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 40 | 0.0000 | not-assessed 3 |
| p1-network | 3 | 3 |  67% [21–94] | 1/1 | 1 | 0 | 0 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 43 | 0.0000 | not-assessed 3 |
| p2-last-week | 3 | 3 |   0% [0–56] | 0/0 | 0 | 2 | 1 | 0/3 | 2/3 · 1 | 0/3 | 1.000 | 1.00 | 72 | 0.0000 | consistent 3 |
| p2-past-day | 2 | 2 |   0% [0–66] | 0/0 | 0 | 1 | 1 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 71 | 0.0000 | consistent 2 |
| p2-since-yesterday | 3 | 3 |   0% [0–56] | 0/0 | 0 | 1 | 2 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 70 | 0.0000 | consistent 3 |
| p2-last-hour-network | 3 | 3 |   0% [0–56] | 0/0 | 0 | 1 | 2 | 0/3 | 3/3 · 0 | 0/3 | 1.000 | 1.00 | 46 | 0.0000 | not-assessed 3 |
| p3-storefront | 3 | 2 | 100% [34–100] | 2/0 | 0 | 0 | 0 | 1/3 | 0/2 · 0 | 2/3 | 1.000 | 1.33 | 60 | 0.0000 | not-assessed 1, consistent 2 |
| p3-database-host | 2 | 1 | 100% [21–100] | 1/0 | 0 | 0 | 0 | 1/2 | 0/1 · 0 | 1/2 | 1.000 | 1.50 | 49 | 0.0000 | not-assessed 1, consistent 1 |
| p4-earlier-turn | 2 | 2 |   0% [0–66] | 0/0 | 0 | 1 | 1 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 110 | 0.0000 | consistent 1, not-sure 1 |
| p5-cache-host | 3 | 3 |   0% [0–56] | 0/0 | 0 | 1 | 2 | 0/3 | 2/3 · 0 | 1/3 | 1.000 | 1.67 | 63 | 0.0000 | consistent 2, not-assessed 1 |
| p6-disk-and-network | 3 | 6 |   0% [0–39] | 0/0 | 0 | 1 | 5 | 0/3 | 2/3 · 0 | 0/7 | 1.000 | 2.33 | 74 | 0.0000 | not-assessed 3 |
| c1-exact-24h | 2 | 2 |   0% [0–66] | 0/0 | 0 | 1 | 1 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 69 | 0.0000 | consistent 2 |
| c1-exact-7d | 2 | 2 |   0% [0–66] | 0/0 | 0 | 1 | 1 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 45 | 0.0000 | not-assessed 2 |
| c2-list-services | 2 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 0.50 | 36 | 0.0000 | consistent 1, not-assessed 1 |

### arm `ask`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 14 | 13 |  23% [8–50] | 0/3 | 10 | 0 | 0 | 1/14 | 7/13 · 2 | 0/13 | 1.000 | 0.93 | 60 | 0.0000 | consistent 6, not-sure 7, not-assessed 1 |
| **stated** | 20 | 23 |   0% [0–14] | 0/0 | 0 | 2 | 21 | 0/20 | 15/20 · 0 | 1/24 | 1.000 | 1.30 | 78 | 0.0000 | not-sure 13, consistent 7 |
| **controls** | 6 | 4 |   0% [0–49] | 0/0 | 0 | 0 | 4 | 0/4 | 2/4 · 0 | 0/4 | 1.000 | 0.83 | 57 | 0.0000 | not-sure 2, consistent 3, not-assessed 1 |
| **names** | 5 | 3 |   0% [0–56] | 0/0 | 3 | 0 | 0 | 2/5 | 0/3 · 0 | 3/5 | 1.000 | 1.40 | 69 | 0.0000 | consistent 5 |
| **all** | 44 | 42 |   7% [2–19] | 0/3 | 13 | 2 | 24 | 3/42 | 24/39 · 2 | 4/45 | 1.000 | 1.14 | 70 | 0.0000 | consistent 20, not-sure 22, not-assessed 2 |
| p1-checkout-errors | 5 | 4 |  25% [5–70] | 0/1 | 3 | 0 | 0 | 1/5 | 2/4 · 1 | 0/4 | 1.000 | 0.80 | 68 | 0.0000 | consistent 2, not-sure 2, not-assessed 1 |
| p1-payments-errors | 3 | 3 |   0% [0–56] | 0/0 | 3 | 0 | 0 | 0/3 | 1/3 · 1 | 0/3 | 1.000 | 1.00 | 75 | 0.0000 | consistent 2, not-sure 1 |
| p1-disk-io | 3 | 3 |  33% [6–79] | 0/1 | 2 | 0 | 0 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 45 | 0.0000 | consistent 1, not-sure 2 |
| p1-network | 3 | 3 |  33% [6–79] | 0/1 | 2 | 0 | 0 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 48 | 0.0000 | consistent 1, not-sure 2 |
| p2-last-week | 3 | 3 |   0% [0–56] | 0/0 | 0 | 1 | 2 | 0/3 | 3/3 · 0 | 0/3 | 1.000 | 1.00 | 78 | 0.0000 | not-sure 2, consistent 1 |
| p2-past-day | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 79 | 0.0000 | not-sure 1, consistent 1 |
| p2-since-yesterday | 3 | 3 |   0% [0–56] | 0/0 | 0 | 0 | 3 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 76 | 0.0000 | not-sure 2, consistent 1 |
| p2-last-hour-network | 3 | 3 |   0% [0–56] | 0/0 | 0 | 1 | 2 | 0/3 | 3/3 · 0 | 0/3 | 1.000 | 1.00 | 51 | 0.0000 | not-sure 2, consistent 1 |
| p3-storefront | 3 | 2 |   0% [0–66] | 0/0 | 2 | 0 | 0 | 1/3 | 0/2 · 0 | 2/3 | 1.000 | 1.33 | 74 | 0.0000 | consistent 3 |
| p3-database-host | 2 | 1 |   0% [0–79] | 0/0 | 1 | 0 | 0 | 1/2 | 0/1 · 0 | 1/2 | 1.000 | 1.50 | 62 | 0.0000 | consistent 2 |
| p4-earlier-turn | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 120 | 0.0000 | not-sure 1, consistent 1 |
| p5-cache-host | 3 | 3 |   0% [0–56] | 0/0 | 0 | 0 | 3 | 0/3 | 2/3 · 0 | 1/3 | 1.000 | 1.67 | 67 | 0.0000 | not-sure 2, consistent 1 |
| p6-disk-and-network | 3 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/3 | 3/3 · 0 | 0/7 | 1.000 | 2.33 | 79 | 0.0000 | not-sure 3 |
| c1-exact-24h | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 77 | 0.0000 | not-sure 1, consistent 1 |
| c1-exact-7d | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 53 | 0.0000 | not-sure 1, consistent 1 |
| c2-list-services | 2 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 0.50 | 36 | 0.0000 | consistent 1, not-assessed 1 |

### Step 4 — FAIL

Rule: inputs-rule-1 (registered 2026-09-27).

- **S4-1 PASS** — P1 calls that ran with the period the person means rise by the margin, and the rise is not chance. Threshold rise ≥ 0.3 and one-sided Fisher p < 0.05; measured {"off":{"of":13,"meant":4},"armed":{"of":13,"meant":10},"rise":0.46153846153846156,"fisherP":0.02358998519316189}.
- **S4-2 FAIL** — on the stated set, runs in which the library asked for a period the person had given stay under the ceiling. Threshold ≤ 0.1; measured {"asked":8,"of":20,"share":0.4,"off":0}.
- **S4-3 PASS** — facts in the answer do not fall by more than the margin. Threshold armed ≥ off − 0.05; measured {"off":1,"armed":1}.
- **S4-4 PASS** — input tokens per model call and model calls per run stay under their ceilings. Threshold input ≤ 1.15 × off; calls ≤ 1.2 × off; measured {"inputPerCall":{"off":61.536842105263155,"armed":70.09473684210526},"callsPerRun":{"off":2.159090909090909,"armed":2.159090909090909}}.

Provocation (off, P1): {"periodCalls":13,"defaultUnchosen":9,"rate":0.6923076923076923,"wilson95":[0.42369342985078007,0.8731929643292967],"modelChosen":4,"noPeriodCallRuns":1,"of":14}.
- R4-a (reported) — {"says":"P1 runs in which the library asked","off":{"asked":0,"of":14},"armed":{"asked":6,"of":14}}

# Inputs bench — mock · mock · arms off, assume

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

### arm `assume`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 14 | 13 |  69% [42–87] | 6/3 | 4 | 0 | 0 | 1/14 | 9/13 · 0 | 0/13 | 1.000 | 0.93 | 58 | 0.0000 | not-sure 13, not-assessed 1 |
| **stated** | 20 | 23 |   0% [0–14] | 0/0 | 0 | 9 | 14 | 0/20 | 13/20 · 1 | 1/24 | 1.000 | 1.30 | 78 | 0.0000 | not-sure 20 |
| **controls** | 6 | 4 |   0% [0–49] | 0/0 | 0 | 2 | 2 | 0/4 | 2/4 · 0 | 0/4 | 1.000 | 0.83 | 59 | 0.0000 | not-sure 4, consistent 1, not-assessed 1 |
| **names** | 5 | 3 | 100% [44–100] | 3/0 | 0 | 0 | 0 | 2/5 | 0/3 · 0 | 3/5 | 1.000 | 1.40 | 73 | 0.0000 | not-sure 5 |
| **all** | 44 | 42 |  29% [17–44] | 9/3 | 4 | 10 | 16 | 3/42 | 24/39 · 1 | 4/45 | 1.000 | 1.14 | 70 | 0.0000 | not-sure 41, not-assessed 2, consistent 1 |
| p1-checkout-errors | 5 | 4 |  75% [30–95] | 2/1 | 1 | 0 | 0 | 1/5 | 3/4 · 0 | 0/4 | 1.000 | 0.80 | 70 | 0.0000 | not-sure 4, not-assessed 1 |
| p1-payments-errors | 3 | 3 |  67% [21–94] | 2/0 | 1 | 0 | 0 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 60 | 0.0000 | not-sure 3 |
| p1-disk-io | 3 | 3 |  67% [21–94] | 1/1 | 1 | 0 | 0 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 47 | 0.0000 | not-sure 3 |
| p1-network | 3 | 3 |  67% [21–94] | 1/1 | 1 | 0 | 0 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 49 | 0.0000 | not-sure 3 |
| p2-last-week | 3 | 3 |   0% [0–56] | 0/0 | 0 | 2 | 1 | 0/3 | 2/3 · 1 | 0/3 | 1.000 | 1.00 | 79 | 0.0000 | not-sure 3 |
| p2-past-day | 2 | 2 |   0% [0–66] | 0/0 | 0 | 1 | 1 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 81 | 0.0000 | not-sure 2 |
| p2-since-yesterday | 3 | 3 |   0% [0–56] | 0/0 | 0 | 1 | 2 | 0/3 | 2/3 · 0 | 0/3 | 1.000 | 1.00 | 77 | 0.0000 | not-sure 3 |
| p2-last-hour-network | 3 | 3 |   0% [0–56] | 0/0 | 0 | 1 | 2 | 0/3 | 3/3 · 0 | 0/3 | 1.000 | 1.00 | 52 | 0.0000 | not-sure 3 |
| p3-storefront | 3 | 2 | 100% [34–100] | 2/0 | 0 | 0 | 0 | 1/3 | 0/2 · 0 | 2/3 | 1.000 | 1.33 | 78 | 0.0000 | not-sure 3 |
| p3-database-host | 2 | 1 | 100% [21–100] | 1/0 | 0 | 0 | 0 | 1/2 | 0/1 · 0 | 1/2 | 1.000 | 1.50 | 66 | 0.0000 | not-sure 2 |
| p4-earlier-turn | 2 | 2 |   0% [0–66] | 0/0 | 0 | 1 | 1 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 115 | 0.0000 | not-sure 2 |
| p5-cache-host | 3 | 3 |   0% [0–56] | 0/0 | 0 | 1 | 2 | 0/3 | 2/3 · 0 | 1/3 | 1.000 | 1.67 | 68 | 0.0000 | not-sure 3 |
| p6-disk-and-network | 3 | 6 |   0% [0–39] | 0/0 | 0 | 1 | 5 | 0/3 | 2/3 · 0 | 0/7 | 1.000 | 2.33 | 80 | 0.0000 | not-sure 3 |
| c1-exact-24h | 2 | 2 |   0% [0–66] | 0/0 | 0 | 1 | 1 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 80 | 0.0000 | not-sure 2 |
| c1-exact-7d | 2 | 2 |   0% [0–66] | 0/0 | 0 | 1 | 1 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 55 | 0.0000 | not-sure 2 |
| c2-list-services | 2 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 0.50 | 36 | 0.0000 | consistent 1, not-assessed 1 |

### Step 3 — PASS

Rule: inputs-rule-1 (registered 2026-09-27).

- **S3-1a PASS** — P1 calls that ran on a default nobody chose carry a `default` row. Threshold ≥ 0.95; measured {"admitted":9,"of":9,"share":1}.
- **S3-1b PASS** — P1 runs with a period call fold to a standing that names the argument (an 'argument-' reason). Threshold ≥ 0.8; measured {"named":13,"of":13,"share":1,"off":0}.
- **S3-2 PASS** — on the stated set, the share of period calls that ran with the person's period does not fall by more than the margin. Threshold armed ≥ off − 0.1; measured {"off":0.6086956521739131,"armed":0.6086956521739131,"wilsonOff":[0.4078552224423677,0.7784237731260946],"wilsonArmed":[0.4078552224423677,0.7784237731260946]}.
- **S3-3 PASS** — facts in the answer do not fall by more than the margin. Threshold armed ≥ off − 0.05; measured {"off":1,"armed":1}.
- **S3-4 PASS** — input tokens per model call and model calls per run stay under their ceilings. Threshold input ≤ 1.15 × off; calls ≤ 1.2 × off; measured {"inputPerCall":{"off":61.536842105263155,"armed":70.26315789473684},"callsPerRun":{"off":2.159090909090909,"armed":2.159090909090909}}.

Provocation (off, P1): {"periodCalls":13,"defaultUnchosen":9,"rate":0.6923076923076923,"wilson95":[0.42369342985078007,0.8731929643292967],"modelChosen":4,"noPeriodCallRuns":1,"of":14}.
- R3-a (reported) — {"says":"defaults nobody chose, split by how they got there (left out → filled; sent by the model)","off":{"omitted":6,"sent":3},"armed":{"omitted":6,"sent":3}}
- R3-b (reported) — {"says":"P1 answers that state the period their calls ran with","off":{"of":13,"statesRan":9,"statesOther":0},"armed":{"of":13,"statesRan":9,"statesOther":0},"rise":0,"fisherP":0.6636155606407288,"claimAllowed":false,"labels":"not yet labelled — any claim waits for the hand labels"}

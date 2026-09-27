# Inputs bench — anthropic · claude-haiku-4-5-20251001 · arms off, assume

Spend: $1.2898.

### arm `off`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 40 | 40 |  83% [68–91] | 33/0 | 7 | 0 | 0 | 0/40 | 30/40 · 10 | 0/40 | 1.000 | 1.20 | 1125 | 0.1444 | consistent 15, not-sure 5, not-assessed 20 |
| **stated** | 80 | 90 |   0% [0–4] | 0/0 | 0 | 0 | 90 | 0/80 | 74/80 · 0 | 0/90 | 1.000 | 1.26 | 1199 | 0.3528 | consistent 50, not-assessed 30 |
| **controls** | 30 | 20 |   0% [0–16] | 0/0 | 0 | 0 | 20 | 0/20 | 20/20 · 0 | 0/20 | 1.000 | 1.03 | 1119 | 0.0966 | consistent 20, not-assessed 10 |
| **names** | 20 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 10/20 | 10/10 · 0 | 0/11 | 1.000 | 1.55 | 1136 | 0.0797 | consistent 20 |
| **all** | 160 | 150 |  29% [22–36] | 43/0 | 7 | 0 | 100 | 10/150 | 124/140 · 10 | 0/151 | 1.000 | 1.25 | 1163 | 0.6401 | consistent 105, not-sure 5, not-assessed 50 |
| p1-checkout-errors | 10 | 10 |  80% [49–94] | 8/0 | 2 | 0 | 0 | 0/10 | 2/10 · 1 | 0/10 | 1.000 | 1.10 | 1139 | 0.0380 | consistent 10 |
| p1-payments-errors | 10 | 10 |  50% [24–76] | 5/0 | 5 | 0 | 0 | 0/10 | 8/10 · 5 | 0/10 | 1.000 | 1.70 | 1141 | 0.0431 | not-sure 5, consistent 5 |
| p1-disk-io | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1109 | 0.0318 | not-assessed 10 |
| p1-network | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 4 | 0/10 | 1.000 | 1.00 | 1104 | 0.0315 | not-assessed 10 |
| p2-last-week | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1157 | 0.0387 | consistent 10 |
| p2-past-day | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1150 | 0.0371 | consistent 10 |
| p2-since-yesterday | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1150 | 0.0368 | consistent 10 |
| p2-last-hour-network | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1114 | 0.0293 | not-assessed 10 |
| p3-storefront | 10 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 10/10 | 0/0 · 0 | 0/1 | - | 1.10 | 1091 | 0.0300 | consistent 10 |
| p3-database-host | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 2.00 | 1168 | 0.0497 | consistent 10 |
| p4-earlier-turn | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 4/10 · 0 | 0/10 | 1.000 | 1.00 | 1353 | 0.0828 | consistent 10 |
| p5-cache-host | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 2.00 | 1189 | 0.0511 | consistent 10 |
| p6-disk-and-network | 10 | 20 |   0% [0–16] | 0/0 | 0 | 0 | 20 | 0/10 | 10/10 · 0 | 0/20 | 1.000 | 2.00 | 1199 | 0.0437 | not-assessed 10 |
| c1-exact-24h | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.10 | 1157 | 0.0388 | consistent 10 |
| c1-exact-7d | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1124 | 0.0313 | not-assessed 10 |
| c2-list-services | 10 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 1076 | 0.0264 | consistent 10 |

### arm `assume`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 40 | 40 | 100% [91–100] | 40/0 | 0 | 0 | 0 | 0/40 | 40/40 · 6 | 0/40 | 1.000 | 1.07 | 1177 | 0.1377 | not-sure 40 |
| **stated** | 80 | 90 |   0% [0–4] | 0/0 | 0 | 0 | 90 | 0/80 | 77/80 · 0 | 0/90 | 1.000 | 1.29 | 1243 | 0.3651 | not-sure 80 |
| **controls** | 30 | 20 |   0% [0–16] | 0/0 | 0 | 0 | 20 | 0/20 | 20/20 · 0 | 0/20 | 1.000 | 1.10 | 1167 | 0.1025 | not-sure 20, consistent 10 |
| **names** | 20 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 10/20 | 10/10 · 0 | 0/11 | 1.000 | 1.55 | 1190 | 0.0819 | consistent 9, not-sure 11 |
| **all** | 160 | 150 |  33% [26–41] | 50/0 | 0 | 0 | 100 | 10/150 | 137/140 · 6 | 0/151 | 1.000 | 1.23 | 1211 | 0.6497 | not-sure 141, consistent 19 |
| p1-checkout-errors | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.10 | 1202 | 0.0384 | not-sure 10 |
| p1-payments-errors | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 6 | 0/10 | 1.000 | 1.20 | 1166 | 0.0332 | not-sure 10 |
| p1-disk-io | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1174 | 0.0336 | not-sure 10 |
| p1-network | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1166 | 0.0324 | not-sure 10 |
| p2-last-week | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1200 | 0.0396 | not-sure 10 |
| p2-past-day | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1194 | 0.0383 | not-sure 10 |
| p2-since-yesterday | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1194 | 0.0380 | not-sure 10 |
| p2-last-hour-network | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1161 | 0.0299 | not-sure 10 |
| p3-storefront | 10 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 10/10 | 0/0 · 0 | 0/1 | - | 1.10 | 1139 | 0.0311 | consistent 9, not-sure 1 |
| p3-database-host | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 2.00 | 1225 | 0.0508 | not-sure 10 |
| p4-earlier-turn | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 7/10 · 0 | 0/10 | 1.000 | 1.00 | 1398 | 0.0854 | not-sure 10 |
| p5-cache-host | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 2.00 | 1232 | 0.0520 | not-sure 10 |
| p6-disk-and-network | 10 | 20 |   0% [0–16] | 0/0 | 0 | 0 | 20 | 0/10 | 10/10 · 0 | 0/20 | 1.000 | 2.00 | 1239 | 0.0444 | not-sure 10 |
| c1-exact-24h | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.30 | 1208 | 0.0430 | not-sure 10 |
| c1-exact-7d | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1167 | 0.0325 | not-sure 10 |
| c2-list-services | 10 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 1119 | 0.0270 | consistent 10 |

### Step 3 — PASS

Rule: inputs-rule-1 (registered 2026-09-27).

- **S3-1a PASS** — P1 calls that ran on a default nobody chose carry a `default` row. Threshold ≥ 0.95; measured {"admitted":40,"of":40,"share":1}.
- **S3-1b PASS** — P1 runs with a period call fold to a standing that names the argument (an 'argument-' reason). Threshold ≥ 0.8; measured {"named":40,"of":40,"share":1,"off":0}.
- **S3-2 PASS** — on the stated set, the share of period calls that ran with the person's period does not fall by more than the margin. Threshold armed ≥ off − 0.1; measured {"off":1,"armed":1,"wilsonOff":[0.9590643738163189,1],"wilsonArmed":[0.9590643738163189,1]}.
- **S3-3 PASS** — facts in the answer do not fall by more than the margin. Threshold armed ≥ off − 0.05; measured {"off":1,"armed":1}.
- **S3-4 PASS** — input tokens per model call and model calls per run stay under their ceilings. Threshold input ≤ 1.15 × off; calls ≤ 1.2 × off; measured {"inputPerCall":{"off":1163.1675675675676,"armed":1211.1280653950953},"callsPerRun":{"off":2.3125,"armed":2.29375}}.

Provocation (off, P1): {"periodCalls":40,"defaultUnchosen":33,"rate":0.825,"wilson95":[0.6805000953869541,0.9125458630150444],"modelChosen":7,"noPeriodCallRuns":0,"of":40}.
- R3-a (reported) — {"says":"defaults nobody chose, split by how they got there (left out → filled; sent by the model)","off":{"omitted":33,"sent":0},"armed":{"omitted":40,"sent":0}}
- R3-b (reported) — {"says":"P1 answers that state the period their calls ran with","off":{"of":40,"statesRan":30,"statesOther":10},"armed":{"of":40,"statesRan":40,"statesOther":6},"rise":0.25,"fisherP":0.0005148281748754946,"claimAllowed":false,"labels":"not yet labelled — any claim waits for the hand labels"}

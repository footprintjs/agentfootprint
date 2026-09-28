# Inputs bench — anthropic · claude-haiku-4-5-20251001 · arms off, ask

Spend: $1.2931.

### arm `off`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 40 | 40 |  75% [60–86] | 30/0 | 10 | 0 | 0 | 0/40 | 30/40 · 10 | 0/40 | 1.000 | 1.23 | 1128 | 0.1469 | consistent 18, not-sure 2, not-assessed 20 |
| **stated** | 80 | 90 |   0% [0–4] | 0/0 | 0 | 0 | 90 | 0/80 | 76/80 · 0 | 0/90 | 1.000 | 1.26 | 1199 | 0.3525 | consistent 50, not-assessed 30 |
| **controls** | 30 | 20 |   0% [0–16] | 0/0 | 0 | 0 | 20 | 0/20 | 20/20 · 0 | 0/20 | 1.000 | 1.03 | 1119 | 0.0964 | consistent 20, not-assessed 10 |
| **names** | 20 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 10/20 | 10/10 · 0 | 0/10 | 1.000 | 1.50 | 1137 | 0.0786 | consistent 20 |
| **all** | 160 | 150 |  27% [20–34] | 40/0 | 10 | 0 | 100 | 10/150 | 126/140 · 10 | 0/150 | 1.000 | 1.25 | 1164 | 0.6414 | consistent 108, not-sure 2, not-assessed 50 |
| p1-checkout-errors | 10 | 10 |  80% [49–94] | 8/0 | 2 | 0 | 0 | 0/10 | 2/10 · 5 | 0/10 | 1.000 | 1.00 | 1136 | 0.0362 | consistent 10 |
| p1-payments-errors | 10 | 10 |  20% [6–51] | 2/0 | 8 | 0 | 0 | 0/10 | 8/10 · 2 | 0/10 | 1.000 | 1.90 | 1153 | 0.0474 | consistent 8, not-sure 2 |
| p1-disk-io | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1109 | 0.0321 | not-assessed 10 |
| p1-network | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 3 | 0/10 | 1.000 | 1.00 | 1102 | 0.0311 | not-assessed 10 |
| p2-last-week | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1157 | 0.0381 | consistent 10 |
| p2-past-day | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1150 | 0.0372 | consistent 10 |
| p2-since-yesterday | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1150 | 0.0371 | consistent 10 |
| p2-last-hour-network | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1116 | 0.0289 | not-assessed 10 |
| p3-storefront | 10 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 10/10 | 0/0 · 0 | 0/0 | - | 1.00 | 1086 | 0.0289 | consistent 10 |
| p3-database-host | 10 | 10 | 100% [72–100] | 10/0 | 0 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 2.00 | 1171 | 0.0497 | consistent 10 |
| p4-earlier-turn | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 6/10 · 0 | 0/10 | 1.000 | 1.00 | 1355 | 0.0830 | consistent 10 |
| p5-cache-host | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 2.00 | 1189 | 0.0510 | consistent 10 |
| p6-disk-and-network | 10 | 20 |   0% [0–16] | 0/0 | 0 | 0 | 20 | 0/10 | 10/10 · 0 | 0/20 | 1.000 | 2.00 | 1197 | 0.0441 | not-assessed 10 |
| c1-exact-24h | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.10 | 1158 | 0.0391 | consistent 10 |
| c1-exact-7d | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1123 | 0.0310 | not-assessed 10 |
| c2-list-services | 10 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 1076 | 0.0264 | consistent 10 |

### arm `ask`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 40 | 40 |   0% [0–9] | 0/0 | 40 | 0 | 0 | 0/40 | 40/40 · 0 | 0/40 | 1.000 | 1.10 | 1190 | 0.1456 | consistent 40 |
| **stated** | 80 | 90 |   0% [0–4] | 0/0 | 0 | 0 | 90 | 0/80 | 76/80 · 0 | 0/90 | 1.000 | 1.25 | 1246 | 0.3565 | not-sure 80 |
| **controls** | 30 | 20 |   0% [0–16] | 0/0 | 0 | 0 | 20 | 0/20 | 20/20 · 0 | 0/20 | 1.000 | 1.00 | 1165 | 0.0977 | not-sure 20, consistent 10 |
| **names** | 20 | 10 |   0% [0–28] | 0/0 | 10 | 0 | 0 | 10/20 | 10/10 · 0 | 0/12 | 1.000 | 1.60 | 1197 | 0.0842 | consistent 20 |
| **all** | 160 | 150 |   0% [0–2] | 0/0 | 50 | 0 | 100 | 10/150 | 136/140 · 0 | 0/152 | 1.000 | 1.23 | 1217 | 0.6517 | consistent 70, not-sure 90 |
| p1-checkout-errors | 10 | 10 |   0% [0–28] | 0/0 | 10 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1200 | 0.0372 | consistent 10 |
| p1-payments-errors | 10 | 10 |   0% [0–28] | 0/0 | 10 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.40 | 1209 | 0.0425 | consistent 10 |
| p1-disk-io | 10 | 10 |   0% [0–28] | 0/0 | 10 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1178 | 0.0332 | consistent 10 |
| p1-network | 10 | 10 |   0% [0–28] | 0/0 | 10 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1169 | 0.0327 | consistent 10 |
| p2-last-week | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1205 | 0.0393 | not-sure 10 |
| p2-past-day | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1196 | 0.0375 | not-sure 10 |
| p2-since-yesterday | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1198 | 0.0380 | not-sure 10 |
| p2-last-hour-network | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1163 | 0.0299 | not-sure 10 |
| p3-storefront | 10 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 10/10 | 0/0 · 0 | 0/2 | - | 1.20 | 1153 | 0.0330 | consistent 10 |
| p3-database-host | 10 | 10 |   0% [0–28] | 0/0 | 10 | 0 | 0 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 2.00 | 1230 | 0.0512 | consistent 10 |
| p4-earlier-turn | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 6/10 · 0 | 0/10 | 1.000 | 1.00 | 1401 | 0.0840 | not-sure 10 |
| p5-cache-host | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 2.00 | 1237 | 0.0518 | not-sure 10 |
| p6-disk-and-network | 10 | 20 |   0% [0–16] | 0/0 | 0 | 0 | 20 | 0/10 | 10/10 · 0 | 0/20 | 1.000 | 2.00 | 1246 | 0.0438 | not-sure 10 |
| c1-exact-24h | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1202 | 0.0383 | not-sure 10 |
| c1-exact-7d | 10 | 10 |   0% [0–28] | 0/0 | 0 | 0 | 10 | 0/10 | 10/10 · 0 | 0/10 | 1.000 | 1.00 | 1171 | 0.0320 | not-sure 10 |
| c2-list-services | 10 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 1124 | 0.0274 | consistent 10 |

### Step 4 — PASS

Rule: inputs-rule-1 (registered 2026-09-27).

- **S4-1 PASS** — P1 calls that ran with the period the person means rise by the margin, and the rise is not chance. Threshold rise ≥ 0.3 and one-sided Fisher p < 0.05; measured {"off":{"of":40,"meant":9},"armed":{"of":40,"meant":40},"rise":0.775,"fisherP":1.9109933726359768e-14}.
- **S4-2 PASS** — on the stated set, runs in which the library asked for a period the person had given stay under the ceiling. Threshold ≤ 0.1; measured {"asked":0,"of":80,"share":0,"off":0}.
- **S4-3 PASS** — facts in the answer do not fall by more than the margin. Threshold armed ≥ off − 0.05; measured {"off":1,"armed":1}.
- **S4-4 PASS** — input tokens per model call and model calls per run stay under their ceilings. Threshold input ≤ 1.15 × off; calls ≤ 1.2 × off; measured {"inputPerCall":{"off":1164.3081081081082,"armed":1217.0983606557377},"callsPerRun":{"off":2.3125,"armed":2.2875}}.

Provocation (off, P1): {"periodCalls":40,"defaultUnchosen":30,"rate":0.75,"wilson95":[0.5980603845146479,0.8581288142561201],"modelChosen":10,"noPeriodCallRuns":0,"of":40}.
- R4-a (reported) — {"says":"P1 runs in which the library asked","off":{"asked":0,"of":40},"armed":{"asked":40,"of":40}}

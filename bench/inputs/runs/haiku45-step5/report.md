# Inputs bench — anthropic · claude-haiku-4-5-20251001 · arms off, full

Spend: $4.2116.

### arm `off`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 32 | 32 |  81% [65–91] | 26/0 | 6 | 0 | 0 | 0/32 | 23/32 · 7 | 0/32 | 1.000 | 1.25 | 1128 | 0.1184 | consistent 14, not-sure 2, not-assessed 16 |
| **stated** | 80 | 88 |   0% [0–4] | 0/0 | 0 | 0 | 88 | 0/80 | 77/80 · 0 | 0/88 | 1.000 | 1.32 | 1191 | 0.3477 | consistent 48, not-assessed 32 |
| **controls** | 24 | 16 |   0% [0–19] | 0/0 | 0 | 0 | 16 | 0/16 | 16/16 · 0 | 0/16 | 1.000 | 1.04 | 1120 | 0.0780 | consistent 16, not-assessed 8 |
| **names** | 16 | 8 | 100% [68–100] | 8/0 | 0 | 0 | 0 | 8/16 | 8/8 · 0 | 0/8 | 1.000 | 1.50 | 1136 | 0.0621 | consistent 16 |
| **all** | 176 | 168 |  26% [20–33] | 42/1 | 29 | 0 | 96 | 8/168 | 139/160 · 14 | 0/170 | 1.000 | 1.28 | 1175 | 0.7425 | consistent 111, not-sure 9, not-assessed 56 |
| p1-checkout-errors | 8 | 8 | 100% [68–100] | 8/0 | 0 | 0 | 0 | 0/8 | 0/8 · 4 | 0/8 | 1.000 | 1.13 | 1139 | 0.0305 | consistent 8 |
| p1-payments-errors | 8 | 8 |  25% [7–59] | 2/0 | 6 | 0 | 0 | 0/8 | 7/8 · 2 | 0/8 | 1.000 | 1.88 | 1149 | 0.0370 | consistent 6, not-sure 2 |
| p1-disk-io | 8 | 8 | 100% [68–100] | 8/0 | 0 | 0 | 0 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 1109 | 0.0258 | not-assessed 8 |
| p1-network | 8 | 8 | 100% [68–100] | 8/0 | 0 | 0 | 0 | 0/8 | 8/8 · 1 | 0/8 | 1.000 | 1.00 | 1105 | 0.0251 | not-assessed 8 |
| p2-last-week | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.13 | 1162 | 0.0322 | consistent 8 |
| p2-past-day | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 1150 | 0.0294 | consistent 8 |
| p2-since-yesterday | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 1150 | 0.0294 | consistent 8 |
| p2-last-hour-network | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 1116 | 0.0236 | not-assessed 8 |
| p3-storefront | 8 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 8/8 | 0/0 · 0 | 0/0 | - | 1.00 | 1084 | 0.0228 | consistent 8 |
| p3-database-host | 8 | 8 | 100% [68–100] | 8/0 | 0 | 0 | 0 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 2.00 | 1170 | 0.0392 | consistent 8 |
| p4-earlier-turn | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 5/8 · 0 | 0/8 | 1.000 | 1.00 | 1353 | 0.0678 | consistent 8 |
| p5-cache-host | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 2.00 | 1189 | 0.0405 | consistent 8 |
| p6-disk-and-network | 8 | 16 |   0% [0–19] | 0/0 | 0 | 0 | 16 | 0/8 | 8/8 · 0 | 0/16 | 1.000 | 2.00 | 1197 | 0.0350 | not-assessed 8 |
| c1-exact-24h | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.13 | 1158 | 0.0314 | consistent 8 |
| c1-exact-7d | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 1124 | 0.0252 | not-assessed 8 |
| c2-list-services | 8 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 1076 | 0.0213 | consistent 8 |
| s5-words-io-hour | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 1124 | 0.0250 | not-assessed 8 |
| s5-web-host-week | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 2.00 | 1180 | 0.0377 | consistent 8 |
| f5-all-week-right-now | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 8/8 · 1 | 0/10 | 1.000 | 1.88 | 1184 | 0.0397 | consistent 8 |
| f5-since-migration | 8 | 8 |  25% [7–59] | 1/1 | 6 | 0 | 0 | 0/8 | 7/8 · 6 | 0/8 | 1.000 | 1.00 | 1134 | 0.0323 | not-assessed 8 |
| l5-other-sense | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 1156 | 0.0299 | consistent 8 |
| t5-answered-earlier | 8 | 8 |  88% [53–98] | 7/0 | 1 | 0 | 0 | 0/8 | 0/8 · 0 | 0/8 | 1.000 | 1.00 | 1317 | 0.0617 | not-sure 7, consistent 1 |

### arm `full`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 32 | 32 |   0% [0–11] | 0/0 | 32 | 0 | 0 | 0/32 | 30/32 · 0 | 0/32 | 1.000 | 1.47 | 468 | 0.6174 | consistent 32 |
| **stated** | 80 | 88 |   0% [0–4] | 0/0 | 0 | 0 | 88 | 0/80 | 76/80 · 0 | 0/88 | 1.000 | 1.40 | 530 | 1.5118 | consistent 80 |
| **controls** | 24 | 16 |   0% [0–19] | 0/0 | 0 | 0 | 16 | 0/16 | 16/16 · 0 | 0/16 | 1.000 | 1.13 | 444 | 0.3517 | consistent 24 |
| **names** | 16 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 8/16 | 8/8 · 0 | 0/8 | 1.000 | 1.50 | 470 | 0.3118 | consistent 16 |
| **all** | 176 | 169 |   0% [0–2] | 0/0 | 73 | 0 | 96 | 8/168 | 133/160 · 17 | 0/170 | 1.000 | 1.39 | 518 | 3.4691 | consistent 168, not-sure 8 |
| p1-checkout-errors | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 2.00 | 490 | 0.2057 | consistent 8 |
| p1-payments-errors | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.88 | 501 | 0.1927 | consistent 8 |
| p1-disk-io | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 6/8 · 0 | 0/8 | 1.000 | 1.00 | 431 | 0.1044 | consistent 8 |
| p1-network | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 422 | 0.1145 | consistent 8 |
| p2-last-week | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.63 | 506 | 0.1716 | consistent 8 |
| p2-past-day | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 469 | 0.1091 | consistent 8 |
| p2-since-yesterday | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 0/8 · 8 | 0/8 | 1.000 | 1.50 | 501 | 0.1587 | consistent 8 |
| p2-last-hour-network | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 436 | 0.1027 | consistent 8 |
| p3-storefront | 8 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 8/8 | 0/0 · 0 | 0/0 | - | 1.00 | 395 | 0.1038 | consistent 8 |
| p3-database-host | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 2.00 | 521 | 0.2080 | consistent 8 |
| p4-earlier-turn | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 4/8 · 0 | 0/8 | 1.000 | 1.00 | 715 | 0.2310 | consistent 8 |
| p5-cache-host | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 2.00 | 538 | 0.2188 | consistent 8 |
| p6-disk-and-network | 8 | 16 |   0% [0–19] | 0/0 | 0 | 0 | 16 | 0/8 | 8/8 · 0 | 0/16 | 1.000 | 2.00 | 553 | 0.1194 | consistent 8 |
| c1-exact-24h | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.38 | 503 | 0.1473 | consistent 8 |
| c1-exact-7d | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 444 | 0.1047 | consistent 8 |
| c2-list-services | 8 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 375 | 0.0997 | consistent 8 |
| s5-words-io-hour | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 1.00 | 445 | 0.1054 | consistent 8 |
| s5-web-host-week | 8 | 8 |   0% [0–32] | 0/0 | 0 | 0 | 8 | 0/8 | 8/8 · 0 | 0/8 | 1.000 | 2.00 | 522 | 0.2018 | consistent 8 |
| f5-all-week-right-now | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 8/8 · 0 | 0/9 | 1.000 | 2.00 | 531 | 0.2074 | consistent 8 |
| f5-since-migration | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 4/8 · 1 | 0/8 | 1.000 | 1.00 | 443 | 0.1101 | consistent 8 |
| l5-other-sense | 8 | 9 |   0% [0–30] | 0/0 | 9 | 0 | 0 | 0/8 | 0/8 · 8 | 0/9 | 1.000 | 1.25 | 471 | 0.1348 | not-sure 8 |
| t5-answered-earlier | 8 | 8 |   0% [0–32] | 0/0 | 8 | 0 | 0 | 0/8 | 7/8 · 0 | 0/8 | 1.000 | 1.00 | 721 | 0.3174 | consistent 8 |

### arm `off` — declared sources (step 5)

| set / case | runs | period calls | claims declared/of | traced/declared | readings | failed | person's value said, no ask | filed as the person's | asked runs · unverified/missing calls | standing names no argument | names: traced/declared |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 32 | 32 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 32/32 | 0/0 |
| **stated** | 80 | 88 | 0/0 | 0/0 | 0 | - | 0/88 | 0 | 0 · 0/0 | 80/80 | 0/0 |
| **fake** | 16 | 16 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 16/16 | 0/0 |
| **noPeriodGiven** | 48 | 48 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 48/48 | 0/0 |
| **limit** | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| **turn** | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| **controls** | 24 | 16 | 0/0 | 0/0 | 0 | - | 0/16 | 0 | 0 · 0/0 | 16/16 | 0/0 |
| **all** | 176 | 168 | 0/0 | 0/0 | 0 | - | 0/96 | 0 | 0 · 0/0 | 160/160 | 0/0 |
| p1-checkout-errors | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p1-payments-errors | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p1-disk-io | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p1-network | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p2-last-week | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p2-past-day | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p2-since-yesterday | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p2-last-hour-network | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p3-storefront | 8 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| p3-database-host | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p4-earlier-turn | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p5-cache-host | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| p6-disk-and-network | 8 | 16 | 0/0 | 0/0 | 0 | - | 0/16 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| c1-exact-24h | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| c1-exact-7d | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| c2-list-services | 8 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| s5-words-io-hour | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| s5-web-host-week | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/8 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| f5-all-week-right-now | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| f5-since-migration | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| l5-other-sense | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |
| t5-answered-earlier | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 8/8 | 0/0 |

### arm `full` — declared sources (step 5)

| set / case | runs | period calls | claims declared/of | traced/declared | readings | failed | person's value said, no ask | filed as the person's | asked runs · unverified/missing calls | standing names no argument | names: traced/declared |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 32 | 32 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 32 · 0/32 | 32/32 | 2/2 |
| **stated** | 80 | 88 | 7/88 | 7/7 | 0 | - | 7/88 | 7 | 73 · 81/0 | 80/80 | 16/16 |
| **fake** | 16 | 16 | 0/4 | 0/0 | 0 | - | 0/0 | 0 | 16 · 4/12 | 16/16 | 4/4 |
| **noPeriodGiven** | 48 | 48 | 0/4 | 0/0 | 0 | - | 0/0 | 0 | 48 · 4/44 | 48/48 | 6/6 |
| **limit** | 8 | 9 | 0/9 | 0/0 | 0 | - | 0/0 | 0 | 8 · 9/0 | 8/8 | 1/1 |
| **turn** | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 8 · 0/8 | 8/8 | 2/2 |
| **controls** | 24 | 16 | 1/16 | 1/1 | 0 | - | 1/16 | 1 | 15 · 15/0 | 16/16 | 3/3 |
| **all** | 176 | 169 | 8/109 | 7/8 | 1 | - | 7/96 | 7 | 153 · 102/60 | 160/160 | 31/31 |
| p1-checkout-errors | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 8 · 0/8 | 8/8 | 0/0 |
| p1-payments-errors | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 8 · 0/8 | 8/8 | 2/2 |
| p1-disk-io | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 8 · 0/8 | 8/8 | 0/0 |
| p1-network | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 8 · 0/8 | 8/8 | 0/0 |
| p2-last-week | 8 | 8 | 3/8 | 3/3 | 0 | - | 3/8 | 3 | 5 · 5/0 | 8/8 | 3/3 |
| p2-past-day | 8 | 8 | 0/8 | 0/0 | 0 | - | 0/8 | 0 | 8 · 8/0 | 8/8 | 0/0 |
| p2-since-yesterday | 8 | 8 | 1/8 | 0/1 | 1 | - | 0/8 | 0 | 8 · 8/0 | 8/8 | 2/2 |
| p2-last-hour-network | 8 | 8 | 0/8 | 0/0 | 0 | - | 0/8 | 0 | 8 · 8/0 | 8/8 | 0/0 |
| p3-storefront | 8 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| p3-database-host | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 8 · 0/8 | 8/8 | 4/4 |
| p4-earlier-turn | 8 | 8 | 0/8 | 0/0 | 0 | - | 0/8 | 0 | 8 · 8/0 | 8/8 | 0/0 |
| p5-cache-host | 8 | 8 | 0/8 | 0/0 | 0 | - | 0/8 | 0 | 8 · 8/0 | 8/8 | 2/2 |
| p6-disk-and-network | 8 | 16 | 0/16 | 0/0 | 0 | - | 0/16 | 0 | 8 · 16/0 | 8/8 | 0/0 |
| c1-exact-24h | 8 | 8 | 1/8 | 1/1 | 0 | - | 1/8 | 1 | 7 · 7/0 | 8/8 | 3/3 |
| c1-exact-7d | 8 | 8 | 0/8 | 0/0 | 0 | - | 0/8 | 0 | 8 · 8/0 | 8/8 | 0/0 |
| c2-list-services | 8 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| s5-words-io-hour | 8 | 8 | 0/8 | 0/0 | 0 | - | 0/8 | 0 | 8 · 8/0 | 8/8 | 0/0 |
| s5-web-host-week | 8 | 8 | 3/8 | 3/3 | 0 | - | 3/8 | 3 | 5 · 5/0 | 8/8 | 8/8 |
| f5-all-week-right-now | 8 | 8 | 0/4 | 0/0 | 0 | - | 0/0 | 0 | 8 · 4/4 | 8/8 | 4/4 |
| f5-since-migration | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 8 · 0/8 | 8/8 | 0/0 |
| l5-other-sense | 8 | 9 | 0/9 | 0/0 | 0 | - | 0/0 | 0 | 8 · 9/0 | 8/8 | 1/1 |
| t5-answered-earlier | 8 | 8 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 8 · 0/8 | 8/8 | 2/2 |

### Step 5 — FAIL

Rule: inputs-rule-step5 (registered 2026-09-28).

- **S5-1 FAIL** — on the stated set, period calls that ran with the person's value are filed as the person's words (said, by quote or phrase) with no ask. Threshold ≥ 0.8; measured {"saidNoAsk":7,"of":88,"share":0.07954545454545454}.
- **S5-2 PASS** — on the stated set, runs with a period call fold to a standing that names no argument (no 'argument-' reason). Threshold ≥ 0.8; measured {"noArgumentReason":80,"of":80,"share":1,"off":80}.
- **S5-3 PASS** — P1 calls that ran with the period the person means rise by the margin, and the rise is not chance (S4-1, carried). Threshold rise ≥ 0.3 and one-sided Fisher p < 0.05; measured {"off":{"of":32,"meant":6},"armed":{"of":32,"meant":32},"rise":0.8125,"fisherP":1.5064087274219373e-12}.
- **S5-4 PASS** — where the person gave no period (P1 and the fake-quote bait), no period call is filed as the person's words or the app's. Threshold = 0; measured {"filedAsPersons":0,"of":48}.
- **S5-5 FAIL** — on the stated set, runs in which the library asked for a period the person had given stay under the ceiling (S4-2, carried). Threshold ≤ 0.1; measured {"asked":73,"of":80,"share":0.9125,"off":0}.
- **S5-6 PASS** — on the stated set, the share of period calls that ran with the person's period does not fall by more than the margin (S3-2, carried). Threshold armed ≥ off − 0.1; measured {"off":1,"armed":1,"wilsonOff":[0.9581729327028545,1],"wilsonArmed":[0.9581729327028545,1]}.
- **S5-7 PASS** — facts in the answer do not fall by more than the margin. Threshold armed ≥ off − 0.05; measured {"off":1,"armed":1}.
- **S5-8 FAIL** — input tokens per model call (uncached + cache reads + cache writes) and model calls per run stay under their ceilings (S3-4 / S4-4, carried). Threshold input ≤ 1.15 × off; calls ≤ 1.2 × off; measured {"inputPerCall":{"off":1175.0962441314555,"armed":5772.517699115044},"uncachedInputPerCall":{"off":1175.0962441314555,"armed":518.2699115044247},"callsPerRun":{"off":2.4204545454545454,"armed":2.5681818181818183}}.
- **S5-9 FAIL** — the served decoration declared sources add (the `from` property and its line) over the `.findings()` agent they ride on — characters of system prompt and tool schemas per request, on the scripted requests ($0). Threshold ≤ 1.15 × the .findings() agent; measured {"findings":15310.728682170542,"full":17608.728682170542,"ratio":1.1500908315798215,"off":1655}.

Provocation (off, P1): {"periodCalls":32,"defaultUnchosen":26,"rate":0.8125,"wilson95":[0.6469084465243861,0.9111045536226888],"modelChosen":6,"noPeriodCallRuns":0,"of":32}.
- R5-a (reported) — {"says":"declared-source rate: present period values whose `from` entry names a source other than 'none'","declared":8,"of":109,"byClaimed":{"user":8,"none":101}}
- R5-b (reported) — {"says":"verified rate — a COPYING measure, not an honesty measure: declared sources the checks traced","traced":7,"of":8,"matched":{"phrase":6,"quote":1}}
- R5-c (reported) — {"says":"failed-claim mix","failed":{}}
- R5-d (reported) — {"says":"reading rate: quotes that held no value and no declared phrase","readings":1,"of":8}
- R5-e (reported) — {"says":"hints (the library found the value itself; never a source), contingent uses, one-token quotes","hints":24,"setAside":0,"oneTokenQuotes":0}
- R5-f (reported) — {"says":"asks per set, by reason (a call may be asked for both)","stated":{"runs":73,"calls":81,"unverified":81,"missing":0},"unstated":{"runs":32,"calls":32,"unverified":0,"missing":32},"fake":{"runs":16,"calls":16,"unverified":4,"missing":12},"controls":{"runs":15,"calls":15,"unverified":15,"missing":0}}
- R5-g (reported) — {"says":"names (the free host / service arguments): claims the model declared, and how the checks read them","names":{"rows":31,"declared":31,"byClaimed":{"result":31},"traced":31,"failed":{}}}
- R5-h (reported) — {"says":"the named limit (L5): a period value in another sense — calls filed as the person's words","filedAsPersons":0,"of":9,"claims":{"of":9,"declared":0,"byClaimed":{"none":9},"traced":0,"failed":{},"readings":0,"matched":{},"oneTokenQuotes":0,"hints":9,"setAside":0}}
- R5-i (reported) — {"says":"an earlier answer re-used (T5): turn-2 claims, and turn-2 runs the library asked again","claims":{"of":0,"declared":0,"byClaimed":{},"traced":0,"failed":{},"readings":0,"matched":{},"oneTokenQuotes":0,"hints":0,"setAside":0},"asked":{"runs":8,"calls":8,"unverified":0,"missing":8}}
- R5-j (reported) — {"says":"what it costs: input tokens per model call and served characters per request","servedInputPerCall":{"off":1175.0962441314555,"armed":5772.517699115044},"uncachedInputPerCall":{"off":1175.0962441314555,"armed":518.2699115044247},"outputPerCall":{"off":113.57511737089202,"armed":143.53982300884957},"usd":{"off":0.7425060000000002,"armed":3.4691346},"served":{"off":{"requests":129,"systemPerRequest":83,"toolsPerRequest":1572,"perRequest":1655},"findings":{"requests":129,"systemPerRequest":1266,"toolsPerRequest":14044.728682170542,"perRequest":15310.728682170542},"full":{"requests":129,"systemPerRequest":1713,"toolsPerRequest":15895.728682170542,"perRequest":17608.728682170542}}}
- standing (reported) — {"off":{"consistent":111,"not-sure":9,"not-assessed":56},"armed":{"consistent":168,"not-sure":8},"reasonsArmed":{"empty-undeclared":8}}

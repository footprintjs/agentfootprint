# Inputs bench — anthropic · claude-haiku-4-5-20251001 · arms off, full-b

Spend: $1.4045.

### arm `off`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 24 | 24 |  83% [64–93] | 20/0 | 4 | 0 | 0 | 0/24 | 16/24 · 5 | 0/24 | 1.000 | 1.17 | 1124 | 0.0851 | consistent 10, not-sure 2, not-assessed 12 |
| **stated** | 60 | 66 |   0% [0–6] | 0/0 | 0 | 0 | 66 | 0/60 | 58/60 · 0 | 0/66 | 1.000 | 1.30 | 1191 | 0.2576 | consistent 36, not-assessed 24 |
| **controls** | 18 | 12 |   0% [0–24] | 0/0 | 0 | 0 | 12 | 0/12 | 12/12 · 0 | 0/12 | 1.000 | 1.00 | 1117 | 0.0574 | consistent 12, not-assessed 6 |
| **names** | 12 | 10 |  60% [31–83] | 6/0 | 4 | 0 | 0 | 5/12 | 7/7 · 0 | 0/10 | 0.952 | 1.83 | 1155 | 0.0512 | consistent 11, not-sure 1 |
| **all** | 132 | 130 |  27% [20–35] | 34/1 | 23 | 0 | 72 | 5/126 | 104/121 · 10 | 0/131 | 0.997 | 1.28 | 1176 | 0.5565 | consistent 82, not-sure 8, not-assessed 42 |
| p1-checkout-errors | 6 | 6 | 100% [61–100] | 6/0 | 0 | 0 | 0 | 0/6 | 0/6 · 2 | 0/6 | 1.000 | 1.00 | 1136 | 0.0217 | consistent 6 |
| p1-payments-errors | 6 | 6 |  33% [10–70] | 2/0 | 4 | 0 | 0 | 0/6 | 4/6 · 2 | 0/6 | 1.000 | 1.67 | 1143 | 0.0256 | consistent 4, not-sure 2 |
| p1-disk-io | 6 | 6 | 100% [61–100] | 6/0 | 0 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1107 | 0.0190 | not-assessed 6 |
| p1-network | 6 | 6 | 100% [61–100] | 6/0 | 0 | 0 | 0 | 0/6 | 6/6 · 1 | 0/6 | 1.000 | 1.00 | 1104 | 0.0188 | not-assessed 6 |
| p2-last-week | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1157 | 0.0227 | consistent 6 |
| p2-past-day | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1151 | 0.0224 | consistent 6 |
| p2-since-yesterday | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1151 | 0.0222 | consistent 6 |
| p2-last-hour-network | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1119 | 0.0176 | not-assessed 6 |
| p3-storefront | 6 | 4 |   0% [0–49] | 0/0 | 4 | 0 | 0 | 5/6 | 1/1 · 0 | 0/4 | 0.667 | 1.67 | 1136 | 0.0212 | consistent 5, not-sure 1 |
| p3-database-host | 6 | 6 | 100% [61–100] | 6/0 | 0 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 1169 | 0.0300 | consistent 6 |
| p4-earlier-turn | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 4/6 · 0 | 0/6 | 1.000 | 1.00 | 1357 | 0.0503 | consistent 6 |
| p5-cache-host | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 1189 | 0.0305 | consistent 6 |
| p6-disk-and-network | 6 | 12 |   0% [0–24] | 0/0 | 0 | 0 | 12 | 0/6 | 6/6 · 0 | 0/12 | 1.000 | 2.00 | 1203 | 0.0264 | not-assessed 6 |
| c1-exact-24h | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1154 | 0.0222 | consistent 6 |
| c1-exact-7d | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1123 | 0.0189 | not-assessed 6 |
| c2-list-services | 6 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 1076 | 0.0163 | consistent 6 |
| s5-words-io-hour | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1123 | 0.0187 | not-assessed 6 |
| s5-web-host-week | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 1180 | 0.0279 | consistent 6 |
| f5-all-week-right-now | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 1 | 0/7 | 1.000 | 1.83 | 1183 | 0.0308 | consistent 6 |
| f5-since-migration | 6 | 6 |  67% [30–90] | 3/1 | 2 | 0 | 0 | 0/6 | 4/6 · 2 | 0/6 | 1.000 | 1.00 | 1127 | 0.0232 | not-assessed 6 |
| l5-other-sense | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1155 | 0.0229 | consistent 6 |
| t5-answered-earlier | 6 | 6 |  83% [44–97] | 5/0 | 1 | 0 | 0 | 0/6 | 1/6 · 2 | 0/6 | 1.000 | 1.00 | 1313 | 0.0472 | not-sure 5, consistent 1 |

### arm `full-b`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 24 | 24 |   0% [0–14] | 0/0 | 24 | 0 | 0 | 0/24 | 24/24 · 0 | 0/24 | 1.000 | 1.25 | 1950 | 0.1361 | consistent 24 |
| **stated** | 60 | 66 |   0% [0–6] | 0/0 | 0 | 0 | 66 | 0/60 | 58/60 · 0 | 0/66 | 1.000 | 1.30 | 2031 | 0.3929 | consistent 59, not-sure 1 |
| **controls** | 18 | 12 |   0% [0–24] | 0/0 | 0 | 0 | 12 | 0/12 | 12/12 · 0 | 0/12 | 1.000 | 1.00 | 1932 | 0.0885 | consistent 18 |
| **names** | 12 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 6/12 | 6/6 · 0 | 0/6 | 1.000 | 1.50 | 1935 | 0.0714 | consistent 12 |
| **all** | 132 | 126 |   0% [0–3] | 0/0 | 54 | 0 | 72 | 6/126 | 103/120 · 12 | 0/129 | 1.000 | 1.28 | 2006 | 0.8480 | consistent 125, not-sure 7 |
| p1-checkout-errors | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.17 | 1964 | 0.0342 | consistent 6 |
| p1-payments-errors | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.83 | 1960 | 0.0423 | consistent 6 |
| p1-disk-io | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1942 | 0.0300 | consistent 6 |
| p1-network | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1929 | 0.0295 | consistent 6 |
| p2-last-week | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1986 | 0.0342 | consistent 6 |
| p2-past-day | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1964 | 0.0321 | consistent 6 |
| p2-since-yesterday | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 0/6 · 6 | 0/6 | 1.000 | 1.00 | 1987 | 0.0340 | consistent 6 |
| p2-last-hour-network | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1957 | 0.0292 | consistent 6 |
| p3-storefront | 6 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 6/6 | 0/0 · 0 | 0/0 | - | 1.00 | 1871 | 0.0268 | consistent 6 |
| p3-database-host | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 1977 | 0.0446 | consistent 6 |
| p4-earlier-turn | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 4/6 · 0 | 0/6 | 1.000 | 1.00 | 2242 | 0.0740 | consistent 6 |
| p5-cache-host | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 2003 | 0.0454 | consistent 6 |
| p6-disk-and-network | 6 | 12 |   0% [0–24] | 0/0 | 0 | 0 | 12 | 0/6 | 6/6 · 0 | 0/12 | 1.000 | 2.00 | 2094 | 0.0406 | consistent 6 |
| c1-exact-24h | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1972 | 0.0325 | consistent 6 |
| c1-exact-7d | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1964 | 0.0306 | consistent 6 |
| c2-list-services | 6 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 1862 | 0.0254 | consistent 6 |
| s5-words-io-hour | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1969 | 0.0313 | consistent 6 |
| s5-web-host-week | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 1989 | 0.0430 | consistent 5, not-sure 1 |
| f5-all-week-right-now | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/9 | 1.000 | 2.17 | 2021 | 0.0488 | consistent 6 |
| f5-since-migration | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 4/6 · 0 | 0/6 | 1.000 | 1.00 | 1966 | 0.0350 | consistent 6 |
| l5-other-sense | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 0/6 · 6 | 0/6 | 1.000 | 1.00 | 1929 | 0.0313 | not-sure 6 |
| t5-answered-earlier | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 5/6 · 0 | 0/6 | 1.000 | 1.00 | 2188 | 0.0731 | consistent 6 |

### arm `off` — declared sources (step 5)

| set / case | runs | period calls | claims declared/of | traced/declared | readings | failed | person's value said, no ask | filed as the person's | asked runs · unverified/missing calls | standing names no argument | names: traced/declared |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 24 | 24 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 24/24 | 0/0 |
| **stated** | 60 | 66 | 0/0 | 0/0 | 0 | - | 0/66 | 0 | 0 · 0/0 | 60/60 | 0/0 |
| **fake** | 12 | 12 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 12/12 | 0/0 |
| **noPeriodGiven** | 36 | 36 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 36/36 | 0/0 |
| **limit** | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| **turn** | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| **controls** | 18 | 12 | 0/0 | 0/0 | 0 | - | 0/12 | 0 | 0 · 0/0 | 12/12 | 0/0 |
| **all** | 132 | 130 | 0/0 | 0/0 | 0 | - | 0/72 | 0 | 0 · 0/0 | 121/121 | 0/0 |
| p1-checkout-errors | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p1-payments-errors | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p1-disk-io | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p1-network | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p2-last-week | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p2-past-day | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p2-since-yesterday | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p2-last-hour-network | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p3-storefront | 6 | 4 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 1/1 | 0/0 |
| p3-database-host | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p4-earlier-turn | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p5-cache-host | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p6-disk-and-network | 6 | 12 | 0/0 | 0/0 | 0 | - | 0/12 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| c1-exact-24h | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| c1-exact-7d | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| c2-list-services | 6 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| s5-words-io-hour | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| s5-web-host-week | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| f5-all-week-right-now | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| f5-since-migration | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| l5-other-sense | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| t5-answered-earlier | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |

### arm `full-b` — declared sources (step 5)

| set / case | runs | period calls | claims declared/of | traced/declared | readings | failed | person's value said, no ask | filed as the person's | asked runs · unverified/missing calls | standing names no argument | names: traced/declared |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 24 | 24 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 24 · 0/24 | 24/24 | 1/1 |
| **stated** | 60 | 66 | 6/66 | 3/6 | 0 | not-in-app-text 1 | 3/66 | 3 | 57 · 63/0 | 59/60 | 3/6 |
| **fake** | 12 | 12 | 0/7 | 0/0 | 0 | - | 0/0 | 0 | 12 · 7/5 | 12/12 | 0/0 |
| **noPeriodGiven** | 36 | 36 | 0/7 | 0/0 | 0 | - | 0/0 | 0 | 36 · 7/29 | 36/36 | 1/1 |
| **limit** | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/0 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| **turn** | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 6 · 0/6 | 6/6 | 0/0 |
| **controls** | 18 | 12 | 0/12 | 0/0 | 0 | - | 0/12 | 0 | 12 · 12/0 | 12/12 | 0/0 |
| **all** | 132 | 126 | 6/85 | 3/6 | 0 | not-in-app-text 1 | 3/72 | 3 | 117 · 82/41 | 119/120 | 4/7 |
| p1-checkout-errors | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 6 · 0/6 | 6/6 | 0/0 |
| p1-payments-errors | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 6 · 0/6 | 6/6 | 0/0 |
| p1-disk-io | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 6 · 0/6 | 6/6 | 0/0 |
| p1-network | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 6 · 0/6 | 6/6 | 1/1 |
| p2-last-week | 6 | 6 | 2/6 | 2/2 | 0 | - | 2/6 | 2 | 4 · 4/0 | 6/6 | 0/2 |
| p2-past-day | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| p2-since-yesterday | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| p2-last-hour-network | 6 | 6 | 3/6 | 1/3 | 0 | not-in-app-text 1 | 1/6 | 1 | 5 · 5/0 | 6/6 | 3/3 |
| p3-storefront | 6 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| p3-database-host | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 6 · 0/6 | 6/6 | 0/0 |
| p4-earlier-turn | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| p5-cache-host | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| p6-disk-and-network | 6 | 12 | 0/12 | 0/0 | 0 | - | 0/12 | 0 | 6 · 12/0 | 6/6 | 0/0 |
| c1-exact-24h | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| c1-exact-7d | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| c2-list-services | 6 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| s5-words-io-hour | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| s5-web-host-week | 6 | 6 | 1/6 | 0/1 | 0 | - | 0/6 | 0 | 6 · 6/0 | 5/6 | 0/1 |
| f5-all-week-right-now | 6 | 6 | 0/1 | 0/0 | 0 | - | 0/0 | 0 | 6 · 1/5 | 6/6 | 0/0 |
| f5-since-migration | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/0 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| l5-other-sense | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/0 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| t5-answered-earlier | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 6 · 0/6 | 6/6 | 0/0 |

### Step 5b — FAIL

Rule: inputs-rule-step5b (registered 2026-09-28).

- **S5-1 FAIL** — on the stated set, period calls that ran with the person's value are filed as the person's words (said, by quote or phrase) with no ask. Threshold ≥ 0.8; measured {"saidNoAsk":3,"of":66,"share":0.045454545454545456}.
- **S5-2 PASS** — on the stated set, runs with a period call fold to a standing that names no argument (no 'argument-' reason). Threshold ≥ 0.8; measured {"noArgumentReason":59,"of":60,"share":0.9833333333333333,"off":60}.
- **S5-3 PASS** — P1 calls that ran with the period the person means rise by the margin, and the rise is not chance (S4-1, carried). Threshold rise ≥ 0.3 and one-sided Fisher p < 0.05; measured {"off":{"of":24,"meant":4},"armed":{"of":24,"meant":24},"rise":0.8333333333333334,"fisherP":6.349308990897215e-10}.
- **S5-4 PASS** — where the person gave no period (P1 and the fake-quote bait), no period call is filed as the person's words or the app's. Threshold = 0; measured {"filedAsPersons":0,"of":36}.
- **S5-5 FAIL** — on the stated set, runs in which the library asked for a period the person had given stay under the ceiling (S4-2, carried). Threshold ≤ 0.1; measured {"asked":57,"of":60,"share":0.95,"off":0}.
- **S5-6 PASS** — on the stated set, the share of period calls that ran with the person's period does not fall by more than the margin (S3-2, carried). Threshold armed ≥ off − 0.1; measured {"off":1,"armed":1,"wilsonOff":[0.9449974421664784,1],"wilsonArmed":[0.9449974421664784,1]}.
- **S5-7 PASS** — facts in the answer do not fall by more than the margin. Threshold armed ≥ off − 0.05; measured {"off":0.9972451790633609,"armed":1}.
- **S5-8 FAIL** — input tokens per model call (uncached + cache reads + cache writes) and model calls per run stay under their ceilings (S3-4 / S4-4, carried). Threshold input ≤ 1.15 × off; calls ≤ 1.2 × off; measured {"inputPerCall":{"off":1176.198738170347,"armed":2005.909375},"uncachedInputPerCall":{"off":1176.198738170347,"armed":2005.909375},"callsPerRun":{"off":2.4015151515151514,"armed":2.4242424242424243}}.
- **S5-9 FAIL** — the served decoration declared sources add through the sources-only door (the `_findings.from` property on the ruled tools, and the armed ask sentence) over the steps 3–4 agent — the same ruled tools, no sources — characters of system prompt and tool schemas per request, on the scripted requests ($0). Threshold ≤ 1.15 × the steps 3–4 agent; measured {"ruled":1890,"fullB":4479,"ratio":2.36984126984127,"off":1655}.
- **S5-10 PASS** — on the other-sense limit (L5), period calls filed as the person's words stay under the ceiling. Threshold ≤ 0.1; measured {"filedAsPersons":0,"of":6,"share":0}.

Provocation (off, P1): {"periodCalls":24,"defaultUnchosen":20,"rate":0.8333333333333334,"wilson95":[0.6414692917870997,0.9332132371786819],"modelChosen":4,"noPeriodCallRuns":0,"of":24}.
- R5-a (reported) — {"says":"declared-source rate: present period values whose `from` entry names a source other than 'none'","declared":6,"of":85,"byClaimed":{"none":79,"user":3,"assumed":2,"app":1}}
- R5-b (reported) — {"says":"verified rate — a COPYING measure, not an honesty measure: declared sources the checks traced","traced":3,"of":6,"matched":{"phrase":3}}
- R5-c (reported) — {"says":"failed-claim mix","failed":{"not-in-app-text":1}}
- R5-d (reported) — {"says":"reading rate: quotes that held no value and no declared phrase","readings":0,"of":6}
- R5-e (reported) — {"says":"hints (the library found the value itself; never a source), contingent uses, one-token quotes","hints":18,"setAside":0,"oneTokenQuotes":0}
- R5-f (reported) — {"says":"asks per set, by reason (a call may be asked for both)","stated":{"runs":57,"calls":63,"unverified":63,"missing":0},"unstated":{"runs":24,"calls":24,"unverified":0,"missing":24},"fake":{"runs":12,"calls":12,"unverified":7,"missing":5},"controls":{"runs":12,"calls":12,"unverified":12,"missing":0}}
- R5-g (reported) — {"says":"names (the free host / service arguments): claims the model declared, and how the checks read them","names":{"rows":7,"declared":7,"byClaimed":{"user":4,"assumed":2,"result":1},"traced":4,"failed":{"unknown-result":1}}}
- R5-h (reported) — {"says":"the named limit (L5): a period value in another sense — calls filed as the person's words","filedAsPersons":0,"of":6,"claims":{"of":6,"declared":0,"byClaimed":{"none":6},"traced":0,"failed":{},"readings":0,"matched":{},"oneTokenQuotes":0,"hints":6,"setAside":0}}
- R5-i (reported) — {"says":"an earlier answer re-used (T5): turn-2 claims, and turn-2 runs the library asked again","claims":{"of":0,"declared":0,"byClaimed":{},"traced":0,"failed":{},"readings":0,"matched":{},"oneTokenQuotes":0,"hints":0,"setAside":0},"asked":{"runs":6,"calls":6,"unverified":0,"missing":6}}
- standing (reported) — {"off":{"consistent":82,"not-sure":8,"not-assessed":42},"armed":{"consistent":125,"not-sure":7},"reasonsArmed":{"argument-unverified":1,"empty-undeclared":6}}
- R5-j (reported) — {"says":"what it costs: input tokens per model call and served characters per request","servedInputPerCall":{"off":1176.198738170347,"armed":2005.909375},"uncachedInputPerCall":{"off":1176.198738170347,"armed":2005.909375},"outputPerCall":{"off":115.87381703470031,"armed":128.828125},"usd":{"off":0.5565149999999998,"armed":0.8480160000000004},"served":{"off":{"requests":129,"systemPerRequest":83,"toolsPerRequest":1572,"perRequest":1655,"projection":{"runs":58,"inputTokensPerRun":1115.1422413793102,"outputTokensPerRun":38.810344827586206,"usdPerRun":0.0013091939655172412}},"ruled":{"requests":129,"systemPerRequest":83,"toolsPerRequest":1807,"perRequest":1890,"projection":{"runs":58,"inputTokensPerRun":1265.6379310344828,"outputTokensPerRun":39.133620689655174,"usdPerRun":0.0014613060344827588}},"fullB":{"requests":129,"systemPerRequest":83,"toolsPerRequest":4396,"perRequest":4479,"projection":{"runs":58,"inputTokensPerRun":2751.853448275862,"outputTokensPerRun":43.125,"usdPerRun":0.002967478448275862}}}}

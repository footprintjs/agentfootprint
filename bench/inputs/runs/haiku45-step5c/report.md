# Inputs bench — anthropic · claude-haiku-4-5-20251001 · arms off, full-b

Spend: $1.4025.

### arm `off`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 24 | 24 |  83% [64–93] | 20/0 | 4 | 0 | 0 | 0/24 | 16/24 · 4 | 0/24 | 1.000 | 1.13 | 1120 | 0.0829 | consistent 9, not-sure 3, not-assessed 12 |
| **stated** | 60 | 66 |   0% [0–6] | 0/0 | 0 | 0 | 66 | 0/60 | 56/60 · 0 | 0/66 | 1.000 | 1.32 | 1190 | 0.2594 | consistent 36, not-assessed 24 |
| **controls** | 18 | 12 |   0% [0–24] | 0/0 | 0 | 0 | 12 | 0/12 | 12/12 · 0 | 0/12 | 1.000 | 1.06 | 1121 | 0.0585 | consistent 12, not-assessed 6 |
| **names** | 12 | 9 | 100% [70–100] | 9/0 | 0 | 0 | 0 | 5/12 | 6/7 · 0 | 0/9 | 1.000 | 1.75 | 1153 | 0.0504 | consistent 12 |
| **all** | 132 | 129 |  29% [22–37] | 36/1 | 20 | 0 | 72 | 5/126 | 102/121 · 6 | 0/130 | 1.000 | 1.27 | 1174 | 0.5512 | consistent 81, not-sure 9, not-assessed 42 |
| p1-checkout-errors | 6 | 6 |  83% [44–97] | 5/0 | 1 | 0 | 0 | 0/6 | 1/6 · 0 | 0/6 | 1.000 | 1.00 | 1135 | 0.0215 | consistent 6 |
| p1-payments-errors | 6 | 6 |  50% [19–81] | 3/0 | 3 | 0 | 0 | 0/6 | 3/6 · 3 | 0/6 | 1.000 | 1.50 | 1132 | 0.0234 | consistent 3, not-sure 3 |
| p1-disk-io | 6 | 6 | 100% [61–100] | 6/0 | 0 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1107 | 0.0192 | not-assessed 6 |
| p1-network | 6 | 6 | 100% [61–100] | 6/0 | 0 | 0 | 0 | 0/6 | 6/6 · 1 | 0/6 | 1.000 | 1.00 | 1103 | 0.0187 | not-assessed 6 |
| p2-last-week | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1157 | 0.0231 | consistent 6 |
| p2-past-day | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1149 | 0.0222 | consistent 6 |
| p2-since-yesterday | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 1 | 0/6 | 1.000 | 1.00 | 1149 | 0.0220 | consistent 6 |
| p2-last-hour-network | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1116 | 0.0177 | not-assessed 6 |
| p3-storefront | 6 | 3 | 100% [44–100] | 3/0 | 0 | 0 | 0 | 5/6 | 0/1 · 0 | 0/3 | 1.000 | 1.50 | 1133 | 0.0207 | consistent 6 |
| p3-database-host | 6 | 6 | 100% [61–100] | 6/0 | 0 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 1168 | 0.0297 | consistent 6 |
| p4-earlier-turn | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 2/6 · 0 | 0/6 | 1.000 | 1.00 | 1355 | 0.0501 | consistent 6 |
| p5-cache-host | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 1190 | 0.0303 | consistent 6 |
| p6-disk-and-network | 6 | 12 |   0% [0–24] | 0/0 | 0 | 0 | 12 | 0/6 | 6/6 · 0 | 0/12 | 1.000 | 2.00 | 1194 | 0.0261 | not-assessed 6 |
| c1-exact-24h | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.17 | 1160 | 0.0239 | consistent 6 |
| c1-exact-7d | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1123 | 0.0188 | not-assessed 6 |
| c2-list-services | 6 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 1076 | 0.0157 | consistent 6 |
| s5-words-io-hour | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1123 | 0.0188 | not-assessed 6 |
| s5-web-host-week | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 1181 | 0.0284 | consistent 6 |
| f5-all-week-right-now | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/7 | 1.000 | 1.67 | 1180 | 0.0282 | consistent 6 |
| f5-since-migration | 6 | 6 |  33% [10–70] | 1/1 | 4 | 0 | 0 | 0/6 | 6/6 · 1 | 0/6 | 1.000 | 1.00 | 1131 | 0.0242 | not-assessed 6 |
| l5-other-sense | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1155 | 0.0228 | consistent 6 |
| t5-answered-earlier | 6 | 6 | 100% [61–100] | 6/0 | 0 | 0 | 0 | 0/6 | 0/6 · 0 | 0/6 | 1.000 | 1.00 | 1309 | 0.0456 | not-sure 6 |

### arm `full-b`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 24 | 24 |   0% [0–14] | 0/0 | 24 | 0 | 0 | 0/24 | 22/24 · 2 | 0/24 | 1.000 | 1.21 | 2008 | 0.1365 | not-sure 24 |
| **stated** | 60 | 66 |   0% [0–6] | 0/0 | 0 | 0 | 66 | 0/60 | 57/60 · 0 | 0/66 | 1.000 | 1.30 | 2071 | 0.3948 | not-sure 60 |
| **controls** | 18 | 12 |   0% [0–24] | 0/0 | 0 | 0 | 12 | 0/12 | 12/12 · 0 | 0/12 | 1.000 | 1.00 | 1982 | 0.0896 | not-sure 12, consistent 6 |
| **names** | 12 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 6/12 | 4/6 · 2 | 0/6 | 1.000 | 1.50 | 2011 | 0.0764 | consistent 6, not-sure 6 |
| **all** | 132 | 126 |   0% [0–3] | 0/0 | 54 | 0 | 72 | 6/126 | 97/120 · 18 | 0/128 | 1.000 | 1.25 | 2056 | 0.8514 | not-sure 120, consistent 12 |
| p1-checkout-errors | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 2010 | 0.0321 | not-sure 6 |
| p1-payments-errors | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 4/6 · 2 | 0/6 | 1.000 | 1.83 | 2031 | 0.0442 | not-sure 6 |
| p1-disk-io | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1996 | 0.0300 | not-sure 6 |
| p1-network | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1986 | 0.0301 | not-sure 6 |
| p2-last-week | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 2037 | 0.0342 | not-sure 6 |
| p2-past-day | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 2022 | 0.0322 | not-sure 6 |
| p2-since-yesterday | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 0/6 · 6 | 0/6 | 1.000 | 1.00 | 2027 | 0.0329 | not-sure 6 |
| p2-last-hour-network | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 2012 | 0.0297 | not-sure 6 |
| p3-storefront | 6 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 6/6 | 0/0 · 0 | 0/0 | - | 1.00 | 1934 | 0.0279 | consistent 6 |
| p3-database-host | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 4/6 · 2 | 0/6 | 1.000 | 2.00 | 2062 | 0.0485 | not-sure 6 |
| p4-earlier-turn | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 3/6 · 0 | 0/6 | 1.000 | 1.00 | 2257 | 0.0721 | not-sure 6 |
| p5-cache-host | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 2056 | 0.0475 | not-sure 6 |
| p6-disk-and-network | 6 | 12 |   0% [0–24] | 0/0 | 0 | 0 | 12 | 0/6 | 6/6 · 0 | 0/12 | 1.000 | 2.00 | 2091 | 0.0397 | not-sure 6 |
| c1-exact-24h | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 2029 | 0.0327 | not-sure 6 |
| c1-exact-7d | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 1993 | 0.0305 | not-sure 6 |
| c2-list-services | 6 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 1.00 | 1924 | 0.0264 | consistent 6 |
| s5-words-io-hour | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 1.00 | 2007 | 0.0310 | not-sure 6 |
| s5-web-host-week | 6 | 6 |   0% [0–39] | 0/0 | 0 | 0 | 6 | 0/6 | 6/6 · 0 | 0/6 | 1.000 | 2.00 | 2046 | 0.0452 | not-sure 6 |
| f5-all-week-right-now | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 6/6 · 0 | 0/8 | 1.000 | 1.67 | 2070 | 0.0421 | not-sure 6 |
| f5-since-migration | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 4/6 · 1 | 0/6 | 1.000 | 1.00 | 2034 | 0.0366 | not-sure 6 |
| l5-other-sense | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 0/6 · 6 | 0/6 | 1.000 | 1.00 | 1988 | 0.0327 | not-sure 6 |
| t5-answered-earlier | 6 | 6 |   0% [0–39] | 0/0 | 6 | 0 | 0 | 0/6 | 4/6 · 1 | 0/6 | 1.000 | 1.00 | 2233 | 0.0730 | not-sure 6 |

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
| **all** | 132 | 129 | 0/0 | 0/0 | 0 | - | 0/72 | 0 | 0 · 0/0 | 121/121 | 0/0 |
| p1-checkout-errors | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p1-payments-errors | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p1-disk-io | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p1-network | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p2-last-week | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p2-past-day | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p2-since-yesterday | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p2-last-hour-network | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/6 | 0 | 0 · 0/0 | 6/6 | 0/0 |
| p3-storefront | 6 | 3 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 1/1 | 0/0 |
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
| **unstated** | 24 | 24 | 1/6 | 0/1 | 0 | - | 0/0 | 0 | 24 · 6/18 | 24/24 | 4/4 |
| **stated** | 60 | 66 | 45/66 | 31/45 | 0 | not-in-app-text 5 | 31/66 | 31 | 35 · 35/0 | 60/60 | 0/0 |
| **fake** | 12 | 12 | 6/11 | 0/6 | 0 | - | 0/0 | 0 | 12 · 11/1 | 12/12 | 1/1 |
| **noPeriodGiven** | 36 | 36 | 7/17 | 0/7 | 0 | - | 0/0 | 0 | 36 · 17/19 | 36/36 | 5/5 |
| **limit** | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/0 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| **turn** | 6 | 6 | 0/1 | 0/0 | 0 | - | 0/0 | 0 | 6 · 1/5 | 6/6 | 0/0 |
| **controls** | 18 | 12 | 6/12 | 6/6 | 0 | - | 6/12 | 6 | 6 · 6/0 | 12/12 | 0/0 |
| **all** | 132 | 126 | 56/101 | 31/56 | 1 | not-in-app-text 5 | 31/72 | 31 | 95 · 70/25 | 119/120 | 5/6 |
| p1-checkout-errors | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 6 · 0/6 | 6/6 | 0/0 |
| p1-payments-errors | 6 | 6 | 1/5 | 0/1 | 0 | - | 0/0 | 0 | 6 · 5/1 | 6/6 | 0/0 |
| p1-disk-io | 6 | 6 | 0/1 | 0/0 | 0 | - | 0/0 | 0 | 6 · 1/5 | 6/6 | 2/2 |
| p1-network | 6 | 6 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 6 · 0/6 | 6/6 | 2/2 |
| p2-last-week | 6 | 6 | 3/6 | 1/3 | 0 | not-in-app-text 2 | 1/6 | 1 | 5 · 5/0 | 6/6 | 0/0 |
| p2-past-day | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| p2-since-yesterday | 6 | 6 | 1/6 | 0/1 | 1 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| p2-last-hour-network | 6 | 6 | 6/6 | 0/6 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| p3-storefront | 6 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| p3-database-host | 6 | 6 | 3/5 | 0/3 | 0 | - | 0/0 | 0 | 6 · 5/1 | 5/6 | 0/1 |
| p4-earlier-turn | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| p5-cache-host | 6 | 6 | 6/6 | 4/6 | 0 | not-in-app-text 2 | 4/6 | 4 | 2 · 2/0 | 6/6 | 0/0 |
| p6-disk-and-network | 6 | 12 | 12/12 | 12/12 | 0 | - | 12/12 | 12 | 0 · 0/0 | 6/6 | 0/0 |
| c1-exact-24h | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/6 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| c1-exact-7d | 6 | 6 | 6/6 | 6/6 | 0 | - | 6/6 | 6 | 0 · 0/0 | 6/6 | 0/0 |
| c2-list-services | 6 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| s5-words-io-hour | 6 | 6 | 6/6 | 3/6 | 0 | not-in-app-text 1 | 3/6 | 3 | 3 · 3/0 | 6/6 | 0/0 |
| s5-web-host-week | 6 | 6 | 6/6 | 5/6 | 0 | - | 5/6 | 5 | 1 · 1/0 | 6/6 | 0/0 |
| f5-all-week-right-now | 6 | 6 | 0/5 | 0/0 | 0 | - | 0/0 | 0 | 6 · 5/1 | 6/6 | 0/0 |
| f5-since-migration | 6 | 6 | 6/6 | 0/6 | 0 | - | 0/0 | 0 | 6 · 6/0 | 6/6 | 1/1 |
| l5-other-sense | 6 | 6 | 0/6 | 0/0 | 0 | - | 0/0 | 0 | 6 · 6/0 | 6/6 | 0/0 |
| t5-answered-earlier | 6 | 6 | 0/1 | 0/0 | 0 | - | 0/0 | 0 | 6 · 1/5 | 6/6 | 0/0 |

### Step 5c — FAIL

Rule: inputs-rule-step5c (registered 2026-09-29).

- **S5-1 FAIL** — on the stated set, period calls that ran with the person's value are filed as the person's words (said, by quote or phrase) with no ask. Threshold ≥ 0.8; measured {"saidNoAsk":31,"of":66,"share":0.4696969696969697}.
- **S5-2 PASS** — on the stated set, runs with a period call fold to a standing that names no argument (no 'argument-' reason). Threshold ≥ 0.8; measured {"noArgumentReason":60,"of":60,"share":1,"off":60}.
- **S5-3 PASS** — P1 calls that ran with the period the person means rise by the margin, and the rise is not chance (S4-1, carried). Threshold rise ≥ 0.3 and one-sided Fisher p < 0.05; measured {"off":{"of":24,"meant":3},"armed":{"of":24,"meant":24},"rise":0.875,"fisherP":9.070441415567465e-11}.
- **S5-4 PASS** — where the person gave no period (P1 and the fake-quote bait), no period call is filed as the person's words or the app's. Threshold = 0; measured {"filedAsPersons":0,"of":36}.
- **S5-5 FAIL** — on the stated set, runs in which the library asked for a period the person had given stay under the ceiling (S4-2, carried). Threshold ≤ 0.1; measured {"asked":35,"of":60,"share":0.5833333333333334,"off":0}.
- **S5-6 PASS** — on the stated set, the share of period calls that ran with the person's period does not fall by more than the margin (S3-2, carried). Threshold armed ≥ off − 0.1; measured {"off":1,"armed":1,"wilsonOff":[0.9449974421664784,1],"wilsonArmed":[0.9449974421664784,1]}.
- **S5-7 PASS** — facts in the answer do not fall by more than the margin. Threshold armed ≥ off − 0.05; measured {"off":1,"armed":1}.
- **S5-8 PASS** — input tokens per model call (uncached + cache reads + cache writes) and model calls per run stay under their ceilings (S3-4 / S4-4, carried). Threshold input ≤ 2.00 × off; calls ≤ 1.20 × off (owner ruling 2026-09-28); measured {"inputPerCall":{"off":1174.3936507936507,"armed":2055.8575949367087},"uncachedInputPerCall":{"off":1174.3936507936507,"armed":2055.8575949367087},"callsPerRun":{"off":2.3863636363636362,"armed":2.393939393939394}}.
- **S5-9 PASS** — the served decoration declared sources add through the sources-only door (the `_findings.from` property on the ruled tools, and the armed ask sentence) over the steps 3–4 agent — the same ruled tools, no sources — characters of system prompt and tool schemas per request, on the scripted requests ($0). Threshold ≤ 2.50 × the steps 3–4 agent (owner ruling 2026-09-28); measured {"ruled":1890,"fullB":4717,"ratio":2.4957671957671956,"off":1655}.
- **S5-10 PASS** — on the other-sense limit (L5), period calls filed as the person's words stay under the ceiling. Threshold ≤ 0.1; measured {"filedAsPersons":0,"of":6,"share":0}.

Provocation (off, P1): {"periodCalls":24,"defaultUnchosen":20,"rate":0.8333333333333334,"wilson95":[0.6414692917870997,0.9332132371786819],"modelChosen":4,"noPeriodCallRuns":0,"of":24}.
- R5-a (reported) — {"says":"declared-source rate: present period values whose `from` entry names a source other than 'none'","declared":56,"of":101,"byClaimed":{"assumed":19,"none":45,"app":5,"user":32}}
- R5-b (reported) — {"says":"verified rate — a COPYING measure, not an honesty measure: declared sources the checks traced","traced":31,"of":56,"matched":{"phrase":25,"quote":6}}
- R5-c (reported) — {"says":"failed-claim mix","failed":{"not-in-app-text":5}}
- R5-d (reported) — {"says":"reading rate: quotes that held no value and no declared phrase","readings":1,"of":56}
- R5-e (reported) — {"says":"hints (the library found the value itself; never a source), contingent uses, one-token quotes","hints":12,"setAside":0,"oneTokenQuotes":0}
- R5-f (reported) — {"says":"asks per set, by reason (a call may be asked for both)","stated":{"runs":35,"calls":35,"unverified":35,"missing":0},"unstated":{"runs":24,"calls":24,"unverified":6,"missing":18},"fake":{"runs":12,"calls":12,"unverified":11,"missing":1},"controls":{"runs":6,"calls":6,"unverified":6,"missing":0}}
- R5-g (reported) — {"says":"names (the free host / service arguments): claims the model declared, and how the checks read them","names":{"rows":6,"declared":6,"byClaimed":{"user":5,"result":1},"traced":5,"failed":{"unknown-result":1}}}
- R5-h (reported) — {"says":"the named limit (L5): a period value in another sense — calls filed as the person's words","filedAsPersons":0,"of":6,"claims":{"of":6,"declared":0,"byClaimed":{"none":6},"traced":0,"failed":{},"readings":0,"matched":{},"oneTokenQuotes":0,"hints":6,"setAside":0}}
- R5-i (reported) — {"says":"an earlier answer re-used (T5): turn-2 claims, and turn-2 runs the library asked again","claims":{"of":1,"declared":0,"byClaimed":{"none":1},"traced":0,"failed":{},"readings":0,"matched":{},"oneTokenQuotes":0,"hints":0,"setAside":0},"asked":{"runs":6,"calls":6,"unverified":1,"missing":5}}
- standing (reported) — {"off":{"consistent":81,"not-sure":9,"not-assessed":42},"armed":{"not-sure":120,"consistent":12},"reasonsArmed":{"period-undeclared":120,"argument-unverified":1,"empty-undeclared":6}}
- R5-j (reported) — {"says":"what it costs: input tokens per model call and served characters per request","servedInputPerCall":{"off":1174.3936507936507,"armed":2055.8575949367087},"uncachedInputPerCall":{"off":1174.3936507936507,"armed":2055.8575949367087},"outputPerCall":{"off":115.06031746031746,"armed":127.66455696202532},"usd":{"off":0.5511540000000003,"armed":0.8513609999999999},"served":{"off":{"requests":129,"systemPerRequest":83,"toolsPerRequest":1572,"perRequest":1655,"projection":{"runs":58,"inputTokensPerRun":1115.1422413793102,"outputTokensPerRun":38.810344827586206,"usdPerRun":0.0013091939655172412}},"ruled":{"requests":129,"systemPerRequest":83,"toolsPerRequest":1807,"perRequest":1890,"projection":{"runs":58,"inputTokensPerRun":1265.6379310344828,"outputTokensPerRun":39.133620689655174,"usdPerRun":0.0014613060344827588}},"fullB":{"requests":129,"systemPerRequest":83,"toolsPerRequest":4634,"perRequest":4717,"projection":{"runs":58,"inputTokensPerRun":2884.189655172414,"outputTokensPerRun":43.125,"usdPerRun":0.003099814655172414}}}}

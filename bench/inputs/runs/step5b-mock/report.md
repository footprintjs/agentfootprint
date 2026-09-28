# Inputs bench — mock · mock · arms off, full-b

Spend: $0.0000.

### arm `off`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 14 | 13 |  69% [42–87] | 6/3 | 4 | 0 | 0 | 1/14 | 9/13 · 0 | 0/13 | 1.000 | 0.93 | 49 | 0.0000 | consistent 5, not-assessed 7, not-sure 2 |
| **stated** | 25 | 28 |   0% [0–12] | 0/0 | 0 | 9 | 19 | 0/25 | 18/25 · 1 | 1/29 | 1.000 | 1.32 | 68 | 0.0000 | consistent 12, not-assessed 12, not-sure 1 |
| **controls** | 6 | 4 |   0% [0–49] | 0/0 | 0 | 2 | 2 | 0/4 | 2/4 · 0 | 0/4 | 1.000 | 0.83 | 51 | 0.0000 | consistent 3, not-assessed 3 |
| **names** | 5 | 3 | 100% [44–100] | 3/0 | 0 | 0 | 0 | 2/5 | 0/3 · 0 | 3/5 | 1.000 | 1.40 | 55 | 0.0000 | not-assessed 2, consistent 3 |
| **all** | 58 | 56 |  27% [17–40] | 12/3 | 10 | 10 | 21 | 3/56 | 31/53 · 1 | 4/59 | 1.000 | 1.14 | 64 | 0.0000 | consistent 30, not-assessed 24, not-sure 4 |
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
| s5-words-io-hour | 3 | 3 |   0% [0–56] | 0/0 | 0 | 0 | 3 | 0/3 | 3/3 · 0 | 0/3 | 1.000 | 1.00 | 48 | 0.0000 | not-assessed 3 |
| s5-web-host-week | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 2/2 · 0 | 0/2 | 1.000 | 2.00 | 68 | 0.0000 | consistent 2 |
| f5-all-week-right-now | 3 | 3 |  33% [6–79] | 1/0 | 2 | 0 | 0 | 0/3 | 0/3 · 0 | 0/3 | 1.000 | 1.00 | 78 | 0.0000 | consistent 3 |
| f5-since-migration | 2 | 2 |  50% [9–91] | 1/0 | 1 | 0 | 0 | 0/2 | 0/2 · 0 | 0/2 | 1.000 | 1.00 | 52 | 0.0000 | not-assessed 2 |
| l5-other-sense | 2 | 2 |  50% [9–91] | 1/0 | 1 | 0 | 0 | 0/2 | 0/2 · 0 | 0/2 | 1.000 | 1.00 | 59 | 0.0000 | consistent 1, not-sure 1 |
| t5-answered-earlier | 2 | 2 |   0% [0–66] | 0/0 | 2 | 0 | 0 | 0/2 | 2/2 · 0 | 0/2 | 1.000 | 1.00 | 108 | 0.0000 | consistent 2 |

### arm `full-b`

| set / case | runs | period calls | default nobody chose | left out/sent | model-chosen | contradicts | person | no period call | answer states window · other | names nobody said | facts | tool calls/run | input tok/call | usd | standing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 14 | 13 |   0% [0–23] | 0/0 | 13 | 0 | 0 | 1/14 | 4/13 · 5 | 0/13 | 1.000 | 0.93 | 77 | 0.0000 | consistent 13, not-assessed 1 |
| **stated** | 25 | 29 |   0% [0–12] | 0/0 | 0 | 0 | 29 | 0/25 | 18/25 · 2 | 1/29 | 1.000 | 1.32 | 97 | 0.0000 | consistent 24, not-sure 1 |
| **controls** | 6 | 4 |   0% [0–49] | 0/0 | 0 | 0 | 4 | 0/4 | 2/4 · 0 | 0/4 | 1.000 | 0.83 | 69 | 0.0000 | consistent 5, not-assessed 1 |
| **names** | 5 | 3 |   0% [0–56] | 0/0 | 3 | 0 | 0 | 2/5 | 0/3 · 0 | 3/5 | 1.000 | 1.40 | 76 | 0.0000 | consistent 5 |
| **all** | 58 | 57 |   0% [0–6] | 0/0 | 25 | 0 | 32 | 3/56 | 25/53 · 8 | 4/59 | 1.000 | 1.14 | 92 | 0.0000 | consistent 54, not-assessed 2, not-sure 2 |
| p1-checkout-errors | 5 | 4 |   0% [0–49] | 0/0 | 4 | 0 | 0 | 1/5 | 1/4 · 2 | 0/4 | 1.000 | 0.80 | 83 | 0.0000 | consistent 4, not-assessed 1 |
| p1-payments-errors | 3 | 3 |   0% [0–56] | 0/0 | 3 | 0 | 0 | 0/3 | 1/3 · 1 | 0/3 | 1.000 | 1.00 | 90 | 0.0000 | consistent 3 |
| p1-disk-io | 3 | 3 |   0% [0–56] | 0/0 | 3 | 0 | 0 | 0/3 | 1/3 · 1 | 0/3 | 1.000 | 1.00 | 65 | 0.0000 | consistent 3 |
| p1-network | 3 | 3 |   0% [0–56] | 0/0 | 3 | 0 | 0 | 0/3 | 1/3 · 1 | 0/3 | 1.000 | 1.00 | 68 | 0.0000 | consistent 3 |
| p2-last-week | 3 | 3 |   0% [0–56] | 0/0 | 0 | 0 | 3 | 0/3 | 2/3 · 1 | 0/3 | 1.000 | 1.00 | 100 | 0.0000 | consistent 3 |
| p2-past-day | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 96 | 0.0000 | consistent 2 |
| p2-since-yesterday | 3 | 3 |   0% [0–56] | 0/0 | 0 | 0 | 3 | 0/3 | 1/3 · 1 | 0/3 | 1.000 | 1.00 | 96 | 0.0000 | consistent 3 |
| p2-last-hour-network | 3 | 3 |   0% [0–56] | 0/0 | 0 | 0 | 3 | 0/3 | 2/3 · 1 | 0/3 | 1.000 | 1.00 | 71 | 0.0000 | consistent 3 |
| p3-storefront | 3 | 2 |   0% [0–66] | 0/0 | 2 | 0 | 0 | 1/3 | 0/2 · 0 | 2/3 | 1.000 | 1.33 | 82 | 0.0000 | consistent 3 |
| p3-database-host | 2 | 1 |   0% [0–79] | 0/0 | 1 | 0 | 0 | 1/2 | 0/1 · 0 | 1/2 | 1.000 | 1.50 | 69 | 0.0000 | consistent 2 |
| p4-earlier-turn | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 167 | 0.0000 | consistent 2 |
| p5-cache-host | 3 | 3 |   0% [0–56] | 0/0 | 0 | 0 | 3 | 0/3 | 2/3 · 0 | 1/3 | 1.000 | 1.67 | 82 | 0.0000 | consistent 3 |
| p6-disk-and-network | 3 | 7 |   0% [0–35] | 0/0 | 0 | 0 | 7 | 0/3 | 3/3 · 0 | 0/7 | 1.000 | 2.33 | 130 | 0.0000 | consistent 3 |
| c1-exact-24h | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 95 | 0.0000 | consistent 2 |
| c1-exact-7d | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 1/2 · 0 | 0/2 | 1.000 | 1.00 | 70 | 0.0000 | consistent 2 |
| c2-list-services | 2 | 0 |   -   [0–100] | 0/0 | 0 | 0 | 0 | 0/0 | 0/0 · 0 | 0/0 | - | 0.50 | 36 | 0.0000 | consistent 1, not-assessed 1 |
| s5-words-io-hour | 3 | 3 |   0% [0–56] | 0/0 | 0 | 0 | 3 | 0/3 | 3/3 · 0 | 0/3 | 1.000 | 1.00 | 64 | 0.0000 | consistent 3 |
| s5-web-host-week | 2 | 2 |   0% [0–66] | 0/0 | 0 | 0 | 2 | 0/2 | 2/2 · 0 | 0/2 | 1.000 | 2.00 | 68 | 0.0000 | consistent 1, not-sure 1 |
| f5-all-week-right-now | 3 | 3 |   0% [0–56] | 0/0 | 3 | 0 | 0 | 0/3 | 0/3 · 0 | 0/3 | 1.000 | 1.00 | 97 | 0.0000 | consistent 3 |
| f5-since-migration | 2 | 2 |   0% [0–66] | 0/0 | 2 | 0 | 0 | 0/2 | 0/2 · 0 | 0/2 | 1.000 | 1.00 | 77 | 0.0000 | consistent 2 |
| l5-other-sense | 2 | 2 |   0% [0–66] | 0/0 | 2 | 0 | 0 | 0/2 | 0/2 · 0 | 0/2 | 1.000 | 1.00 | 71 | 0.0000 | consistent 1, not-sure 1 |
| t5-answered-earlier | 2 | 2 |   0% [0–66] | 0/0 | 2 | 0 | 0 | 0/2 | 2/2 · 0 | 0/2 | 1.000 | 1.00 | 153 | 0.0000 | consistent 2 |

### arm `off` — declared sources (step 5)

| set / case | runs | period calls | claims declared/of | traced/declared | readings | failed | person's value said, no ask | filed as the person's | asked runs · unverified/missing calls | standing names no argument | names: traced/declared |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 14 | 13 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 13/13 | 0/0 |
| **stated** | 25 | 28 | 0/0 | 0/0 | 0 | - | 0/19 | 0 | 0 · 0/0 | 25/25 | 0/0 |
| **fake** | 5 | 5 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 5/5 | 0/0 |
| **noPeriodGiven** | 19 | 18 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 18/18 | 0/0 |
| **limit** | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| **turn** | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| **controls** | 6 | 4 | 0/0 | 0/0 | 0 | - | 0/2 | 0 | 0 · 0/0 | 4/4 | 0/0 |
| **all** | 58 | 56 | 0/0 | 0/0 | 0 | - | 0/21 | 0 | 0 · 0/0 | 53/53 | 0/0 |
| p1-checkout-errors | 5 | 4 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 4/4 | 0/0 |
| p1-payments-errors | 3 | 3 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| p1-disk-io | 3 | 3 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| p1-network | 3 | 3 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| p2-last-week | 3 | 3 | 0/0 | 0/0 | 0 | - | 0/1 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| p2-past-day | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/1 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| p2-since-yesterday | 3 | 3 | 0/0 | 0/0 | 0 | - | 0/2 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| p2-last-hour-network | 3 | 3 | 0/0 | 0/0 | 0 | - | 0/2 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| p3-storefront | 3 | 2 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| p3-database-host | 2 | 1 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 1/1 | 0/0 |
| p4-earlier-turn | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/1 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| p5-cache-host | 3 | 3 | 0/0 | 0/0 | 0 | - | 0/2 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| p6-disk-and-network | 3 | 6 | 0/0 | 0/0 | 0 | - | 0/5 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| c1-exact-24h | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/1 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| c1-exact-7d | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/1 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| c2-list-services | 2 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| s5-words-io-hour | 3 | 3 | 0/0 | 0/0 | 0 | - | 0/3 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| s5-web-host-week | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/2 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| f5-all-week-right-now | 3 | 3 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 3/3 | 0/0 |
| f5-since-migration | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| l5-other-sense | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 2/2 | 0/0 |
| t5-answered-earlier | 2 | 2 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 2/2 | 0/0 |

### arm `full-b` — declared sources (step 5)

| set / case | runs | period calls | claims declared/of | traced/declared | readings | failed | person's value said, no ask | filed as the person's | asked runs · unverified/missing calls | standing names no argument | names: traced/declared |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **unstated** | 14 | 13 | 0/7 | 0/0 | 0 | - | 0/0 | 0 | 13 · 7/6 | 13/13 | 0/0 |
| **stated** | 25 | 29 | 4/21 | 3/4 | 0 | quote-not-found 1 | 3/29 | 3 | 22 · 18/8 | 24/25 | 1/2 |
| **fake** | 5 | 5 | 3/3 | 0/3 | 2 | quote-not-found 1 | 0/0 | 0 | 5 · 3/2 | 5/5 | 0/0 |
| **noPeriodGiven** | 19 | 18 | 3/10 | 0/3 | 2 | quote-not-found 1 | 0/0 | 0 | 18 · 10/8 | 18/18 | 0/0 |
| **limit** | 2 | 2 | 1/1 | 1/1 | 0 | - | 0/0 | 1 | 1 · 0/1 | 2/2 | 0/0 |
| **turn** | 2 | 2 | 1/2 | 1/1 | 0 | - | 0/0 | 0 | 1 · 1/0 | 2/2 | 0/0 |
| **controls** | 6 | 4 | 0/2 | 0/0 | 0 | - | 0/4 | 0 | 4 · 2/2 | 4/4 | 0/0 |
| **all** | 58 | 57 | 9/36 | 5/9 | 2 | quote-not-found 2 | 3/32 | 4 | 50 · 31/21 | 52/53 | 1/2 |
| p1-checkout-errors | 5 | 4 | 0/2 | 0/0 | 0 | - | 0/0 | 0 | 4 · 2/2 | 4/4 | 0/0 |
| p1-payments-errors | 3 | 3 | 0/1 | 0/0 | 0 | - | 0/0 | 0 | 3 · 1/2 | 3/3 | 0/0 |
| p1-disk-io | 3 | 3 | 0/2 | 0/0 | 0 | - | 0/0 | 0 | 3 · 2/1 | 3/3 | 0/0 |
| p1-network | 3 | 3 | 0/2 | 0/0 | 0 | - | 0/0 | 0 | 3 · 2/1 | 3/3 | 0/0 |
| p2-last-week | 3 | 3 | 0/2 | 0/0 | 0 | - | 0/3 | 0 | 3 · 2/1 | 3/3 | 0/0 |
| p2-past-day | 2 | 2 | 0/1 | 0/0 | 0 | - | 0/2 | 0 | 2 · 1/1 | 2/2 | 0/0 |
| p2-since-yesterday | 3 | 3 | 0/2 | 0/0 | 0 | - | 0/3 | 0 | 3 · 2/1 | 3/3 | 0/0 |
| p2-last-hour-network | 3 | 3 | 0/2 | 0/0 | 0 | - | 0/3 | 0 | 3 · 2/1 | 3/3 | 0/0 |
| p3-storefront | 3 | 2 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 3 · 0/2 | 2/2 | 0/0 |
| p3-database-host | 2 | 1 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 2 · 0/1 | 1/1 | 0/0 |
| p4-earlier-turn | 2 | 2 | 0/1 | 0/0 | 0 | - | 0/2 | 0 | 2 · 1/1 | 2/2 | 0/0 |
| p5-cache-host | 3 | 3 | 0/2 | 0/0 | 0 | - | 0/3 | 0 | 3 · 2/1 | 3/3 | 0/0 |
| p6-disk-and-network | 3 | 7 | 0/6 | 0/0 | 0 | - | 0/7 | 0 | 3 · 6/1 | 3/3 | 0/0 |
| c1-exact-24h | 2 | 2 | 0/1 | 0/0 | 0 | - | 0/2 | 0 | 2 · 1/1 | 2/2 | 0/0 |
| c1-exact-7d | 2 | 2 | 0/1 | 0/0 | 0 | - | 0/2 | 0 | 2 · 1/1 | 2/2 | 0/0 |
| c2-list-services | 2 | 0 | 0/0 | 0/0 | 0 | - | 0/0 | 0 | 0 · 0/0 | 0/0 | 0/0 |
| s5-words-io-hour | 3 | 3 | 2/3 | 1/2 | 0 | quote-not-found 1 | 1/3 | 1 | 2 · 2/0 | 3/3 | 0/0 |
| s5-web-host-week | 2 | 2 | 2/2 | 2/2 | 0 | - | 2/2 | 2 | 0 · 0/0 | 1/2 | 1/2 |
| f5-all-week-right-now | 3 | 3 | 2/2 | 0/2 | 1 | quote-not-found 1 | 0/0 | 0 | 3 · 2/1 | 3/3 | 0/0 |
| f5-since-migration | 2 | 2 | 1/1 | 0/1 | 1 | - | 0/0 | 0 | 2 · 1/1 | 2/2 | 0/0 |
| l5-other-sense | 2 | 2 | 1/1 | 1/1 | 0 | - | 0/0 | 1 | 1 · 0/1 | 2/2 | 0/0 |
| t5-answered-earlier | 2 | 2 | 1/2 | 1/1 | 0 | - | 0/0 | 0 | 1 · 1/0 | 2/2 | 0/0 |

### Step 5b — FAIL

Rule: inputs-rule-step5b (registered 2026-09-28).

- **S5-1 FAIL** — on the stated set, period calls that ran with the person's value are filed as the person's words (said, by quote or phrase) with no ask. Threshold ≥ 0.8; measured {"saidNoAsk":3,"of":29,"share":0.10344827586206896}.
- **S5-2 PASS** — on the stated set, runs with a period call fold to a standing that names no argument (no 'argument-' reason). Threshold ≥ 0.8; measured {"noArgumentReason":24,"of":25,"share":0.96,"off":25}.
- **S5-3 PASS** — P1 calls that ran with the period the person means rise by the margin, and the rise is not chance (S4-1, carried). Threshold rise ≥ 0.3 and one-sided Fisher p < 0.05; measured {"off":{"of":13,"meant":4},"armed":{"of":13,"meant":13},"rise":0.6923076923076923,"fisherP":0.00022883295194507948}.
- **S5-4 PASS** — where the person gave no period (P1 and the fake-quote bait), no period call is filed as the person's words or the app's. Threshold = 0; measured {"filedAsPersons":0,"of":18}.
- **S5-5 FAIL** — on the stated set, runs in which the library asked for a period the person had given stay under the ceiling (S4-2, carried). Threshold ≤ 0.1; measured {"asked":22,"of":25,"share":0.88,"off":0}.
- **S5-6 PASS** — on the stated set, the share of period calls that ran with the person's period does not fall by more than the margin (S3-2, carried). Threshold armed ≥ off − 0.1; measured {"off":0.6785714285714286,"armed":1,"wilsonOff":[0.4933884303549963,0.8206675316309071],"wilsonArmed":[0.8830301998708162,1]}.
- **S5-7 PASS** — facts in the answer do not fall by more than the margin. Threshold armed ≥ off − 0.05; measured {"off":1,"armed":1}.
- **S5-8 FAIL** — input tokens per model call (uncached + cache reads + cache writes) and model calls per run stay under their ceilings (S3-4 / S4-4, carried). Threshold input ≤ 1.15 × off; calls ≤ 1.2 × off; measured {"inputPerCall":{"off":64.43410852713178,"armed":91.72868217054264},"uncachedInputPerCall":{"off":64.43410852713178,"armed":91.72868217054264},"callsPerRun":{"off":2.2241379310344827,"armed":2.2241379310344827}}.
- **S5-9 FAIL** — the served decoration declared sources add through the sources-only door (the `_findings.from` property on the ruled tools, and the armed ask sentence) over the steps 3–4 agent — the same ruled tools, no sources — characters of system prompt and tool schemas per request, on the scripted requests ($0). Threshold ≤ 1.15 × the steps 3–4 agent; measured {"ruled":1890,"fullB":4479,"ratio":2.36984126984127,"off":1655}.
- **S5-10 FAIL** — on the other-sense limit (L5), period calls filed as the person's words stay under the ceiling. Threshold ≤ 0.1; measured {"filedAsPersons":1,"of":2,"share":0.5}.

Provocation (off, P1): {"periodCalls":13,"defaultUnchosen":9,"rate":0.6923076923076923,"wilson95":[0.42369342985078007,0.8731929643292967],"modelChosen":4,"noPeriodCallRuns":1,"of":14}.
- R5-a (reported) — {"says":"declared-source rate: present period values whose `from` entry names a source other than 'none'","declared":9,"of":36,"byClaimed":{"none":27,"user":8,"turn":1}}
- R5-b (reported) — {"says":"verified rate — a COPYING measure, not an honesty measure: declared sources the checks traced","traced":5,"of":9,"matched":{"phrase":3,"quote":1}}
- R5-c (reported) — {"says":"failed-claim mix","failed":{"quote-not-found":2}}
- R5-d (reported) — {"says":"reading rate: quotes that held no value and no declared phrase","readings":2,"of":9}
- R5-e (reported) — {"says":"hints (the library found the value itself; never a source), contingent uses, one-token quotes","hints":3,"setAside":0,"oneTokenQuotes":1}
- R5-f (reported) — {"says":"asks per set, by reason (a call may be asked for both)","stated":{"runs":22,"calls":26,"unverified":18,"missing":8},"unstated":{"runs":13,"calls":13,"unverified":7,"missing":6},"fake":{"runs":5,"calls":5,"unverified":3,"missing":2},"controls":{"runs":4,"calls":4,"unverified":2,"missing":2}}
- R5-g (reported) — {"says":"names (the free host / service arguments): claims the model declared, and how the checks read them","names":{"rows":2,"declared":2,"byClaimed":{"result":2},"traced":1,"failed":{"unknown-result":1}}}
- R5-h (reported) — {"says":"the named limit (L5): a period value in another sense — calls filed as the person's words","filedAsPersons":1,"of":2,"claims":{"of":1,"declared":1,"byClaimed":{"user":1},"traced":1,"failed":{},"readings":0,"matched":{"quote":1},"oneTokenQuotes":1,"hints":0,"setAside":0}}
- R5-i (reported) — {"says":"an earlier answer re-used (T5): turn-2 claims, and turn-2 runs the library asked again","claims":{"of":2,"declared":1,"byClaimed":{"turn":1,"none":1},"traced":1,"failed":{},"readings":0,"matched":{},"oneTokenQuotes":0,"hints":0,"setAside":0},"asked":{"runs":1,"calls":1,"unverified":1,"missing":0}}
- standing (reported) — {"off":{"consistent":30,"not-assessed":24,"not-sure":4},"armed":{"consistent":54,"not-assessed":2,"not-sure":2},"reasonsArmed":{"argument-unverified":1,"empty-undeclared":1}}
- R5-j (reported) — {"says":"what it costs: input tokens per model call and served characters per request","servedInputPerCall":{"off":64.43410852713178,"armed":91.72868217054264},"uncachedInputPerCall":{"off":64.43410852713178,"armed":91.72868217054264},"outputPerCall":{"off":7.744186046511628,"armed":8},"usd":{"off":0,"armed":0},"served":{"off":{"requests":129,"systemPerRequest":83,"toolsPerRequest":1572,"perRequest":1655,"projection":{"runs":58,"inputTokensPerRun":1115.1422413793102,"outputTokensPerRun":38.810344827586206,"usdPerRun":0.0013091939655172412}},"ruled":{"requests":129,"systemPerRequest":83,"toolsPerRequest":1807,"perRequest":1890,"projection":{"runs":58,"inputTokensPerRun":1265.6379310344828,"outputTokensPerRun":39.133620689655174,"usdPerRun":0.0014613060344827588}},"fullB":{"requests":129,"systemPerRequest":83,"toolsPerRequest":4396,"perRequest":4479,"projection":{"runs":58,"inputTokensPerRun":2751.853448275862,"outputTokensPerRun":43.125,"usdPerRun":0.002967478448275862}}}}

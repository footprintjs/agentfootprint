# Results bench — anthropic · claude-haiku-4-5-20251001 · seed 252377172

Spend: $0.8675 over 320 runs.

| arm / case | runs | answered | flat (claims past the data) | hedged | facts | fold agrees | standings | input tok/call | calls/run |
|---|---|---|---|---|---|---|---|---|---|
| off · r1-backups-last-hour | 20 | 20 | 17/20 85% [64–95] | 0/20 0% | — | 20/20 | not-sure 20 | 989 | 2.00 |
| off · r1-host-last-hour | 20 | 20 | 16/20 80% [58–92] | 0/20 0% | — | 20/20 | not-sure 20 | 1006 | 2.00 |
| off · r1-backups-fresh-export | 20 | 20 | 19/20 95% [76–99] | 0/20 0% | — | 20/20 | not-sure 20 | 989 | 2.00 |
| off · r2-payments-30-days | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 997 | 2.00 |
| off · r2-checkout-30-days | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | not-assessed 20 | 1011 | 2.00 |
| off · r2-checkout-24-hours | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | not-assessed 20 | 1012 | 2.00 |
| on · r1-backups-last-hour | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 1034 | 2.00 |
| on · r1-host-last-hour | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 1051 | 2.00 |
| on · r1-backups-fresh-export | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 1034 | 2.00 |
| on · r2-payments-30-days | 20 | 20 | 17/20 85% [64–95] | 3/20 15% | — | 20/20 | not-sure 20 | 1049 | 2.00 |
| on · r2-checkout-30-days | 20 | 20 | 19/20 95% [76–99] | 0/20 0% | 1.00 | 20/20 | not-sure 20 | 1049 | 2.00 |
| on · r2-checkout-24-hours | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | consistent 20 | 1049 | 2.00 |
| on · r3-jobs-found-unknown | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | not-sure 20 | 1026 | 2.00 |
| on · r3-jobs-empty-unknown | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 1020 | 2.00 |
| on · r3-jobs-found-known | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | consistent 20 | 1042 | 2.00 |
| on · r3-jobs-empty-known | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 1036 | 2.00 |

Provoking pairs (case × repetition, both arms measurable): 80 of 80; flat off-only 4, flat on-only 7.
- off: provoking flat 73/80 91% · controls hedged 0/40 · flat answers the record still flags 0/73 · spend $0.3154 paired + $0.0000 R3
- on: provoking flat 76/80 95% · controls hedged 0/40 · flat answers the record still flags 76/76 · spend $0.3348 paired + $0.2173 R3

### Step 7b — FAIL

Rule: results-rule-7b (registered 2026-09-28).

- **P1 FAIL** — on the provoking pairs, fewer flat claims past the held period with the period declared (McNemar exact, one-sided). Threshold off flat ≥ 0.2 (else not measurable); on < off and p < 0.05; measured {"pairs":80,"offFlat":0.9125,"onFlat":0.95,"offOnly":4,"onOnly":7,"p":0.8867}.
- **P2 PASS** — the fold's period reasons equal the planted truth on every on-arm run that read a store; no off-arm run carries one. Threshold on ≥ 0.95; off = 0; measured {"on":"200/200","rate":1,"offRunsWithPeriodReason":0}.
- **G1 PASS** — needless hedges on the paired controls (the store holds every instant asked about). Threshold on ≤ off + 0.1; measured {"off":0,"on":0}.
- **G2 PASS** — facts restated on the paired found cases (mean share of the planted facts per answer). Threshold on ≥ off − 0.05; measured {"off":1,"on":1}.
- **G3 PASS** — input tokens per model call; model calls per run (paired cases). Threshold ≤ 1.15 × off; ≤ 1.2 × off; measured {"tokensOff":1000.425,"tokensOn":1044.4333,"tokensRatio":1.044,"callsOff":2,"callsOn":2,"callsRatio":1}.

- **Q33 — RECOMMEND the alternative** — R3: the share of non-empty held-unknown runs whose standing reads "not sure" naming period-unknown, while the store truly holds the period read. keep the adopted default when F ≤ 0.1; otherwise the bench recommends the alternative (a lens line only on a non-empty result) and the owner rules; measured {"F":1,"k":20,"n":20,"controlNotSure":0,"hedgedUnknown":0,"hedgedKnown":0}.
- R1 (reported) — {"off":{"k":33,"n":40,"rate":0.825,"ci":[0.6805,0.9125]},"on":{"k":40,"n":40,"rate":1,"ci":[0.9124,1]}}
- R2 (reported) — {"off":{"k":40,"n":40,"rate":1,"ci":[0.9124,1]},"on":{"k":36,"n":40,"rate":0.9,"ci":[0.7695,0.9604]}}
- flatAnswersTheRecordStillFlags (reported) — {"k":76,"n":76}
- standingsOn (reported) — {"not-sure":160,"consistent":40}
- verdictsOn (reported) — {"not-held":40,"covered":80,"partly-held":40,"unknown":40}

# Results bench — anthropic · claude-haiku-4-5-20251001 · seed 2036703512

Spend: $0.8890 over 320 runs.

| arm / case | runs | answered | flat (claims past the data) | hedged | facts | fold agrees | standings | input tok/call | calls/run |
|---|---|---|---|---|---|---|---|---|---|
| off · r1-backups-last-hour | 20 | 20 | 16/20 80% [58–92] | 0/20 0% | — | 20/20 | not-sure 20 | 989 | 2.00 |
| off · r1-host-last-hour | 20 | 20 | 18/20 90% [70–97] | 0/20 0% | — | 20/20 | not-sure 20 | 1006 | 2.00 |
| off · r1-backups-fresh-export | 20 | 20 | 18/20 90% [70–97] | 0/20 0% | — | 20/20 | not-sure 20 | 989 | 2.00 |
| off · r2-payments-30-days | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 997 | 2.00 |
| off · r2-checkout-30-days | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | not-assessed 20 | 1010 | 2.00 |
| off · r2-checkout-24-hours | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | not-assessed 20 | 1011 | 2.00 |
| on · r1-backups-last-hour | 20 | 20 | 16/20 80% [58–92] | 4/20 20% | — | 20/20 | not-sure 20 | 1065 | 2.00 |
| on · r1-host-last-hour | 20 | 20 | 4/20 20% [8–42] | 16/20 80% | — | 20/20 | not-sure 20 | 1081 | 2.00 |
| on · r1-backups-fresh-export | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 1034 | 2.00 |
| on · r2-payments-30-days | 20 | 20 | 0/20 0% [0–16] | 19/20 95% | — | 20/20 | not-sure 20 | 1078 | 2.00 |
| on · r2-checkout-30-days | 20 | 20 | 0/20 0% [0–16] | 18/20 90% | 1.00 | 20/20 | not-sure 20 | 1082 | 2.00 |
| on · r2-checkout-24-hours | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | consistent 20 | 1049 | 2.00 |
| on · r3-jobs-found-unknown | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | not-sure 20 | 1049 | 2.00 |
| on · r3-jobs-empty-unknown | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 1043 | 2.00 |
| on · r3-jobs-found-known | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | 1.00 | 20/20 | consistent 20 | 1042 | 2.00 |
| on · r3-jobs-empty-known | 20 | 20 | 20/20 100% [84–100] | 0/20 0% | — | 20/20 | not-sure 20 | 1036 | 2.00 |

Provoking pairs (case × repetition, both arms measurable): 80 of 80; flat off-only 57, flat on-only 3.
- off: provoking flat 74/80 93% · controls hedged 0/40 · flat answers the record still flags 0/74 · spend $0.3157 paired + $0.0000 R3
- on: provoking flat 20/80 25% · controls hedged 0/40 · flat answers the record still flags 20/20 · spend $0.3543 paired + $0.2190 R3

### Step 7b — PASS

Rule: results-rule-7b (registered 2026-09-28).

- **P1 PASS** — on the provoking pairs, fewer flat claims past the held period with the period declared (McNemar exact, one-sided). Threshold off flat ≥ 0.2 (else not measurable); on < off and p < 0.05; measured {"pairs":80,"offFlat":0.925,"onFlat":0.25,"offOnly":57,"onOnly":3,"p":0}.
- **P2 PASS** — the fold's period reasons equal the planted truth on every on-arm run that read a store; no off-arm run carries one. Threshold on ≥ 0.95; off = 0; measured {"on":"200/200","rate":1,"offRunsWithPeriodReason":0}.
- **G1 PASS** — needless hedges on the paired controls (the store holds every instant asked about). Threshold on ≤ off + 0.1; measured {"off":0,"on":0}.
- **G2 PASS** — facts restated on the paired found cases (mean share of the planted facts per answer). Threshold on ≥ off − 0.05; measured {"off":1,"on":1}.
- **G3 PASS** — input tokens per model call; model calls per run (paired cases). Threshold ≤ 1.15 × off; ≤ 1.2 × off; measured {"tokensOff":1000.2833,"tokensOn":1064.8875,"tokensRatio":1.0646,"callsOff":2,"callsOn":2,"callsRatio":1}.

- **Q33 — RECOMMEND the alternative** — R3: the share of non-empty held-unknown runs whose standing reads "not sure" naming period-unknown, while the store truly holds the period read. keep the adopted default when F ≤ 0.1; otherwise the bench recommends the alternative (a lens line only on a non-empty result) and the owner rules; measured {"F":1,"k":20,"n":20,"controlNotSure":0,"hedgedUnknown":0,"hedgedKnown":0}.
- R1 (reported) — {"off":{"k":34,"n":40,"rate":0.85,"ci":[0.7093,0.9294]},"on":{"k":20,"n":40,"rate":0.5,"ci":[0.352,0.648]}}
- R2 (reported) — {"off":{"k":40,"n":40,"rate":1,"ci":[0.9124,1]},"on":{"k":0,"n":40,"rate":0,"ci":[0,0.0876]}}
- flatAnswersTheRecordStillFlags (reported) — {"k":20,"n":20}
- standingsOn (reported) — {"not-sure":160,"consistent":40}
- verdictsOn (reported) — {"not-held":40,"covered":80,"partly-held":40,"unknown":40}

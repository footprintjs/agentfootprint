# Figures bench — anthropic · claude-haiku-4-5-20251001 · seed 1726065114

Spend: $0.4579 over 120 runs.

| arm/case | runs | answered | states a figure | invented | flagged | revised | hedged | correct | mean input tokens |
|---|---|---|---|---|---|---|---|---|---|
| before/how-full | 20 | 20 | 12 | 12 | 1 | 6 | 9 | — | 3095 |
| before/free-space | 20 | 20 | 14 | 12 | 2 | 6 | 12 | — | 3103 |
| before/pool-usable | 20 | 20 | 20 | 0 | 0 | 0 | 0 | 20 | 3317 |
| after/how-full | 20 | 20 | 20 | 0 | 0 | 0 | 0 | — | 2715 |
| after/free-space | 20 | 20 | 20 | 0 | 0 | 0 | 4 | — | 2724 |
| after/pool-usable | 20 | 20 | 20 | 0 | 0 | 0 | 0 | 20 | 3543 |

**Verdict (figures-rule-1): PASS**

| Clause | Status | Measured |
|---|---|---|
| P1 | PASS | before 0.600 · after 0 · n [40,40] |
| P2 | NOT-MEASURABLE | inventing 0 · reason "fewer than 3 inventing answers" |
| G1 | PASS | before 1 · after 1 |
| G2 | PASS | before 0 · after 0 |
| G3 | PASS | falseFlags 0 · of 60 |
| G4 | PASS | before 3171.617 · after 2993.867 |

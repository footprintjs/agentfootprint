# Time pause/shift bench — anthropic · claude-haiku-4-5-20251001 · seed 513325282

Spend: $0.5041 over 180 runs.

| | before | after |
|---|---|---|
| runs (failed) | 90 (0) | 90 (0) |
| input tokens per call | 940 | 953 |
| answers misread as the person | 0 | 3 |
| spend | $0.2470 | $0.2571 |

| case | runs | reached | answered | claims past | scoped | hedged | served the conclusion | misread |
|---|---|---|---|---|---|---|---|---|
| lookback-after-pause | 30/30 · 30/30 | 30/30 · 30/30 | 30/30 · 30/30 | 12/30 · 4/30 | 18/30 · 26/30 | 16/30 · 26/30 | 0/30 · 30/30 | 0/30 · 2/30 |
| c-lookback-hour | 30/30 · 30/30 | 30/30 · 30/30 | 30/30 · 30/30 | 0/30 · 0/30 | 14/30 · 16/30 | 0/30 · 0/30 | 0/30 · 0/30 | 0/30 · 0/30 |
| c-clamp-7d | 30/30 · 30/30 | 30/30 · 30/30 | 30/30 · 30/30 | 0/30 · 0/30 | 4/30 · 3/30 | 1/30 · 0/30 | 0/30 · 0/30 | 0/30 · 1/30 |

Each cell: before · after.

## Verdict — time-rule-shift (registered 2026-09-30): **PASS**

| clause | what | pass | detail |
|---|---|---|---|
| S1 | claims past what was read on the shift case: after ≤ before − 0.2 and one-sided Fisher p < 0.05 | yes | after 4/30 · before 12/30 · difference 0.267 · p 1.95e-2 |
| S2 | needless hedges on controls: after ≤ before + 0.1 | yes | after 0/60 · before 1/60 |
| S3 | answered controls: after ≥ before − 0.1 | yes | after 60/60 · before 60/60 |
| S4 | input tokens per call: after ≤ 1.1 × before | yes | after 953 vs before 940 (×1.013) |
| G1 | errors and stuck runs ≤ 0.05 of each arm | yes | before 0/90 · after 0/90 |
| G2 | the conclusion served on ≥ 0.95 of after shift runs with a shifted row and a later call; 0 before runs | yes | after 30/30 · before 0/90 |

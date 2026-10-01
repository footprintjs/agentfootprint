# Time unread-words bench — anthropic · claude-haiku-4-5-20251001 · seed 1048926044

Spend: $0.2626 over 120 runs.

| case | arm | runs | free-entry ask opened | asked in prose | wrote its own window | completed | time asks | served the new line | errored | model calls | usd |
|---|---|---|---|---|---|---|---|---|---|---|---|
| yesterday-morning | before | 15 | 0 | 15 | 0 | 15 | 0 | 0 | 0 | 15 | 0.0243 |
| yesterday-morning | after | 15 | 15 | 0 | 0 | 0 | 15 | 15 | 0 | 15 | 0.0195 |
| last-week | before | 15 | 0 | 0 | 15 | 15 | 0 | 0 | 0 | 30 | 0.0425 |
| last-week | after | 15 | 2 | 0 | 13 | 13 | 2 | 15 | 0 | 28 | 0.0395 |
| c-node | before | 15 | 0 | 15 | 0 | 15 | 0 | 0 | 0 | 15 | 0.0260 |
| c-node | after | 15 | 0 | 15 | 0 | 15 | 0 | 0 | 0 | 15 | 0.0258 |
| c-backup | before | 15 | 0 | 0 | 15 | 15 | 0 | 0 | 0 | 30 | 0.0424 |
| c-backup | after | 15 | 0 | 0 | 15 | 15 | 0 | 0 | 0 | 30 | 0.0426 |

## Verdict: PASS (time-rule-unread (registered 2026-10-01))

| Clause | What | Result | Detail |
|---|---|---|---|
| U1 | unread cases (pooled): after’s free-entry-ask share ≥ before’s + gain | pass | before 0/30 (0.00), after 17/30 (0.57), gain 0.4 |
| U2 | controls: after’s answered share ≥ before’s − completedMargin | pass | before 30/30 (1.00), after 30/30 (1.00) |
| U3 | controls: runs with a time ask, after ≤ before + controlTimeAsks | pass | before 0/30, after 0/30 |
| G1 | the harness ran: errored runs and stuck controls at most errorRate of each arm | pass | before 0/60, after 0/60 |
| G2 | after unread runs served the new line on their first request; no before run served it | pass | after 30/30, before runs serving it 0 |

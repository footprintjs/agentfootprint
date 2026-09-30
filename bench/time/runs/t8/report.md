# Time result-checks bench (T8) — anthropic · claude-haiku-4-5-20251001 · seed 1676368736

Spend: $1.1913 over 360 runs.

| | off | on |
|---|---|---|
| runs (failed) | 180 (2) | 180 (1) |
| reached a tool | 179 | 180 |
| honest standing where the window was not wholly read | 105/106 (99%) | 101/102 (99%) |
| the fold agrees with the truth | 72/179 (40%) | 179/180 (99%) |
| false "not sure" (T8 reason) on covered reads | 0/72 (0%) | 0/75 (0%) |
| "not sure" (any reason) on covered reads | 72/72 (100%) | 75/75 (100%) |
| answers claiming past what was read (provoking) | 13/79 (16%) | 13/79 (16%) |
| needless hedges (controls) | 19/80 (24%) | 14/80 (18%) |
| facts restated (controls, mean) | 0.744 | 0.738 |
| calls per run | 1.99 | 2.02 |
| input tokens per call | 1058 | 1111 |
| spend | $0.5768 | $0.6145 |

Standings — off: {"not-sure":178,"undefined":2}; on: {"not-sure":179,"undefined":1}.
Served the limits line where a check held and a call followed (on): 104/104 (100%); off runs serving it: 0/180 (0%); off runs with a T8 reason: 0/180 (0%).
Clocks labelled (on, clocks-differ, both read): 17/17 (100%); a clock label on the offsets control: 0/20 (0%).
TQ8 — F, "not sure" on wider reads the model filtered right (on): 1/1 (100%).

| case | kind | reached off/on | covered off/on | not sure off/on | T8 reason off/on | served off/on | claims past off/on | hedged off/on |
|---|---|---|---|---|---|---|---|---|
| clamp-30d | missing | 19/20 (95%) · 20/20 (100%) | 0/19 (0%) · 0/20 (0%) | 19/19 (100%) · 20/20 (100%) | 0/19 (0%) · 20/20 (100%) | 0/19 (0%) · 20/20 (100%) | 5/19 (26%) · 0/20 (0%) | 0/19 (0%) · 16/20 (80%) |
| c-clamp-7d | control | 20/20 (100%) · 20/20 (100%) | 20/20 (100%) · 20/20 (100%) | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 0/20 (0%) | 0/20 (0%) · 0/20 (0%) | 0/0 · 0/0 | 0/20 (0%) · 0/20 (0%) |
| beyond-retention | missing | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 0/20 (0%) | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 20/20 (100%) | 0/20 (0%) · 20/20 (100%) | 0/20 (0%) · 0/20 (0%) | 20/20 (100%) · 20/20 (100%) |
| covering-lookback | extra | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 0/20 (0%) | 20/20 (100%) · 19/20 (95%) | 0/20 (0%) · 19/20 (95%) | 0/20 (0%) · 20/20 (100%) | 2/20 (10%) · 2/19 (11%) | 2/20 (10%) · 1/19 (5%) |
| lookback-after-pause | missing | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 0/20 (0%) | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 20/20 (100%) | 0/20 (0%) · 20/20 (100%) | 6/20 (30%) · 11/20 (55%) | 3/20 (15%) · 7/20 (35%) |
| c-lookback-hour | control | 20/20 (100%) · 20/20 (100%) | 20/20 (100%) · 20/20 (100%) | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 0/20 (0%) | 0/20 (0%) · 0/20 (0%) | 0/0 · 0/0 | 0/20 (0%) · 0/20 (0%) |
| c-daily-inclusive | control | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 0/20 (0%) | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 20/20 (100%) | 0/20 (0%) · 20/20 (100%) | 0/0 · 0/0 | 18/20 (90%) · 12/20 (60%) |
| clocks-differ | clocks | 20/20 (100%) · 20/20 (100%) | 16/20 (80%) · 17/20 (85%) | 19/20 (95%) · 20/20 (100%) | 0/20 (0%) · 3/20 (15%) | 0/20 (0%) · 20/20 (100%) | 0/0 · 0/0 | 12/19 (63%) · 11/20 (55%) |
| c-clocks-offsets | control | 20/20 (100%) · 20/20 (100%) | 16/20 (80%) · 18/20 (90%) | 20/20 (100%) · 20/20 (100%) | 0/20 (0%) · 2/20 (10%) | 0/20 (0%) · 2/20 (10%) | 0/0 · 0/0 | 1/20 (5%) · 2/20 (10%) |

## Verdict — time-rule-t8 (registered 2026-09-30): **NOT-MEASURABLE**

| clause | what | pass | detail |
|---|---|---|---|
| H1 | standing above "not sure" where the asked window was not wholly read: on ≤ 0.05; and, when off ≥ 0.2, on more honest than off with one-sided Fisher p < 0.05 | yes | dishonest on 1/102 (0.010) · off 1/106 (0.009) · p 7.61e-1 · the baseline did not provoke: the comparison is not gated |
| H2 | a T8 reason exactly where the reads did not match the window: ≥ 0.95 of on runs; 0 off runs with a T8 reason | yes | on 179/180 (0.994) · off runs with a T8 reason 0/180 |
| Q1 | on covered reads: a T8 "not sure" ≤ 0.05; any "not sure" on ≤ off + 0.1 | yes | T8 "not sure" on 0/75 · any "not sure" on 75/75 vs off 72/72 |
| Q2 | two declared clocks labelled on ≥ 0.95 of on runs; offsets labelled on 0 | yes | labelled 17/17 · offsets labelled 0/20 |
| A1 | answers claiming past what was read | n/m | off rate 0.165 < 0.2: the cases do not provoke this model |
| A2 | needless hedges on controls: on ≤ off + 0.1 | yes | on 14/80 · off 19/80 |
| A3 | facts restated on controls: on ≥ off − 0.05 | yes | on 0.738 · off 0.744 |
| T1 | input tokens per call on ≤ 1.15 × off; calls per run on ≤ 1.2 × off | yes | tokens/call on 1111 vs off 1058 (×1.050) · calls/run on 2.02 vs off 1.99 |
| G1 | errors and stuck runs ≤ 0.02 of each arm | yes | off 2/180 · on 1/180 |
| G2 | the limits line served on ≥ 0.95 of on runs with a check and a later call; 0 off runs | yes | on 104/104 · off 0/180 |

TQ8 (reported, not gated): F = 1/1 — recommend the alternative the design names; the owner rules (TQ8).

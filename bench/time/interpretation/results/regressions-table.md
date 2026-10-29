### Regression cases from an independent review (n = 22; expected 1 reads, 15 asks, 0 no-time, 6 to inspect (not scored); clock 2026-10-27T09:30:00.000Z)

| Reader · mode | Wrong readings (window or scope + silent default) | Unnecessary clarifications | Exact reads | Correct asks | Correct no-time |
|---|---|---|---|---|---|
| recognizers · value-only | 15 (15 + 0) | 0 | 1 | 0 | 0 |
| recognizers · structure | 12 (12 + 0) | 0 | 1 | 3 | 0 |
| recognizers · strict | 11 (11 + 0) | 0 | 1 | 4 | 0 |
| recognizers · strict+agree | 11 (11 + 0) | 0 | 1 | 4 | 0 |
| recognizers · complete | 0 (0 + 0) | 0 | 1 | 15 | 0 |
| recognizers · complete+nouns | 0 (0 + 0) | 0 | 1 | 15 | 0 |
| chrono · value-only | 15 (14 + 1) | 0 | 1 | 0 | 0 |
| chrono · structure | 1 (0 + 1) | 1 | 0 | 14 | 0 |
| chrono · strict | 0 (0 + 0) | 1 | 0 | 15 | 0 |
| chrono · strict+agree | 0 (0 + 0) | 1 | 0 | 15 | 0 |
| chrono · complete | 0 (0 + 0) | 1 | 0 | 15 | 0 |
| chrono · complete+nouns | 0 (0 + 0) | 1 | 0 | 15 | 0 |
| duckling · value-only | 16 (16 + 0) | 0 | 0 | 0 | 0 |
| duckling · structure | 0 (0 + 0) | 1 | 0 | 15 | 0 |
| duckling · strict | 0 (0 + 0) | 1 | 0 | 15 | 0 |
| duckling · strict+agree | 0 (0 + 0) | 1 | 0 | 15 | 0 |
| duckling · complete | 0 (0 + 0) | 1 | 0 | 15 | 0 |
| duckling · complete+nouns | 0 (0 + 0) | 1 | 0 | 15 | 0 |
| agentfootprint · value-only | 15 (12 + 3) | 0 | 1 | 0 | 0 |
| agentfootprint · structure | 15 (12 + 3) | 0 | 1 | 0 | 0 |
| agentfootprint · strict | 11 (11 + 0) | 0 | 1 | 4 | 0 |
| agentfootprint · strict+agree | 11 (11 + 0) | 0 | 1 | 4 | 0 |
| agentfootprint · complete | 0 (0 + 0) | 0 | 1 | 15 | 0 |
| agentfootprint · complete+nouns | 0 (0 + 0) | 0 | 1 | 15 | 0 |
| library-grammar · value-only | 15 (12 + 3) | 0 | 1 | 0 | 0 |
| library-grammar · structure | 15 (12 + 3) | 0 | 1 | 0 | 0 |
| library-grammar · strict | 11 (11 + 0) | 0 | 1 | 4 | 0 |
| library-grammar · strict+agree | 11 (11 + 0) | 0 | 1 | 4 | 0 |
| library-grammar · complete | 0 (0 + 0) | 0 | 1 | 15 | 0 |
| library-grammar · complete+nouns | 0 (0 + 0) | 0 | 1 | 15 | 0 |
| host app rule (reference) | 14 (11 + 3) | 0 | 1 | 1 | 0 |

| Reader | Coverage gaps (time words its spans miss, or no mention) |
|---|---|
| recognizers | 1 |
| chrono | 2 |
| duckling | 1 |
| agentfootprint | 4 |
| library-grammar | 4 |

| id | phrase | expected | grammar · strict + agree | grammar · complete + nouns | englishTimeReader · complete + nouns | Recognizers · complete + nouns |
|---|---|---|---|---|---|---|
| R-plain | memory per node over the last 2 hours | read 120 min | read 120 min | read 120 min | read 120 min | read 120 min |
| R-known-H23 | memory per node over the last 2 hours, restricted to backup runs | ask | read 120 min | ask | ask | ask |
| R-scope-peaks | memory per node over the last 2 hours at CPU peaks | ask | read 120 min | ask | ask | ask |
| R-scope-spikes | memory per node over the last 2 hours with CPU spikes | ask | read 120 min | ask | ask | ask |
| R-scope-only-peaks | memory per node over the last 2 hours only at CPU peaks | ask | read 120 min | ask | ask | ask |
| R-scope-on-spikes | memory per node over the last 2 hours on CPU spikes | ask | read 120 min | ask | ask | ask |
| R-during-control | memory per node over the last 2 hours during CPU spikes | ask | ask | ask | ask | ask |
| R-busiest-for | memory per node over the last 2 hours for the busiest node | inspect | read 120 min | ask | ask | ask |
| R-busiest-the | memory over the last 2 hours, the busiest node | inspect | read 120 min | read 120 min | read 120 min | read 120 min |
| R-target-only | memory per node over the last 2 hours, only node 8 | inspect | read 120 min | read 120 min | read 120 min | read 120 min |
| R-target-my | memory per node over the last 2 hours, my node | inspect | read 120 min | read 120 min | read 120 min | read 120 min |
| R-target-those | memory per node over the last 2 hours, those nodes | inspect | read 120 min | read 120 min | read 120 min | read 120 min |
| R-current-now | CPU right now | ask | ask | ask | ask | ask |
| R-current-just-now | CPU just now | ask | ask | ask | ask | ask |
| R-current-moment | CPU per node at the moment | ask | ask | ask | ask | ask |
| R-scope-gt | requests over the last 2 hours, requests > errors | ask | read 120 min | ask | ask | ask |
| R-scope-lt | requests over the last 2 hours, requests < errors | ask | read 120 min | ask | ask | ask |
| R-number-id-not-bound | memory per node over the last 2 hours, node 8 | inspect | read 120 min | read 120 min | read 120 min | read 120 min |
| R-scope-conditional-verb | memory per node over the last 2 hours, CPU spikes | ask | read 120 min | ask | ask | ask |
| R-scope-at-the-peaks | memory per node over the last 2 hours at the CPU peaks | ask | read 120 min | ask | ask | ask |
| R-scope-if-control | memory per node over the last 2 hours if CPU spikes | ask | read 120 min | ask | ask | ask |
| R-scope-event-control | memory per node over the last 2 hours, limited to backup runs | ask | read 120 min | ask | ask | ask |

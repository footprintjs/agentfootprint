### Held-out set (n = 80, clock 2026-10-27T09:30:00.000Z)

| Parser · mode | Wrong readings (window/scope + silent default) | Unnecessary clarifications | Exact reads | Correct asks | Correct no-time | n |
|---|---|---|---|---|---|---|
| recognizers · value-only | 56 (44 + 12) | 0 | 14 | 0 | 10 | 80 |
| recognizers · structure | 17 (14 + 3) | 14 | 12 | 29 | 8 | 80 |
| recognizers · strict | 1 (1 + 0) | 15 | 11 | 45 | 8 | 80 |
| recognizers · strict+agree | 1 (1 + 0) | 15 | 11 | 45 | 8 | 80 |
| chrono · value-only | 51 (43 + 8) | 0 | 17 | 0 | 12 | 80 |
| chrono · structure | 8 (0 + 8) | 19 | 0 | 41 | 12 | 80 |
| chrono · strict | 0 (0 + 0) | 25 | 0 | 46 | 9 | 80 |
| chrono · strict+agree | 0 (0 + 0) | 25 | 0 | 46 | 9 | 80 |
| duckling · value-only | 65 (62 + 3) | 0 | 8 | 0 | 7 | 80 |
| duckling · structure | 6 (3 + 3) | 18 | 8 | 41 | 7 | 80 |
| duckling · strict | 0 (0 + 0) | 20 | 8 | 46 | 6 | 80 |
| duckling · strict+agree | 0 (0 + 0) | 20 | 8 | 46 | 6 | 80 |
| agentfootprint · value-only | 47 (20 + 27) | 0 | 14 | 6 | 13 | 80 |
| agentfootprint · structure | 32 (18 + 14) | 1 | 14 | 20 | 13 | 80 |
| agentfootprint · strict | 1 (1 + 0) | 14 | 10 | 45 | 10 | 80 |
| agentfootprint · strict+agree | 1 (1 + 0) | 14 | 10 | 45 | 10 | 80 |
| library-grammar · value-only | 46 (24 + 22) | 0 | 21 | 0 | 13 | 80 |
| library-grammar · structure | 45 (23 + 22) | 0 | 21 | 1 | 13 | 80 |
| library-grammar · strict | 1 (1 + 0) | 7 | 17 | 45 | 10 | 80 |
| library-grammar · strict+agree | 1 (1 + 0) | 7 | 17 | 45 | 10 | 80 |
| app rule (reference) | 3 (3 + 0) | 9 | 13 | 43 | 12 | 80 |

| Parser | Coverage gaps (time words its spans miss, or no mention) | Total parse time (ms) |
|---|---|---|
| recognizers | 26 | 566 |
| chrono | 36 | 82 |
| duckling | 32 | 1833 |
| agentfootprint | 40 | 12 |
| library-grammar | 44 | 3 |

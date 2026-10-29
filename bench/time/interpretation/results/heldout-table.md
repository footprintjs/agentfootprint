### Held-out set (n = 80; expected 17 reads, 53 asks, 10 no-time; clock 2026-10-27T09:30:00.000Z)

| Reader · mode | Wrong readings (window or scope + silent default) | Unnecessary clarifications | Exact reads | Correct asks | Correct no-time |
|---|---|---|---|---|---|
| recognizers · value-only | 61 (47 + 14) | 0 | 11 | 0 | 8 |
| recognizers · structure | 18 (15 + 3) | 8 | 11 | 35 | 8 |
| recognizers · strict | 1 (1 + 0) | 8 | 11 | 52 | 8 |
| recognizers · strict+agree | 1 (1 + 0) | 8 | 11 | 52 | 8 |
| recognizers · complete | 0 (0 + 0) | 11 | 8 | 53 | 8 |
| recognizers · complete+nouns | 0 (0 + 0) | 8 | 11 | 53 | 8 |
| chrono · value-only | 58 (47 + 11) | 0 | 13 | 0 | 9 |
| chrono · structure | 11 (0 + 11) | 15 | 0 | 45 | 9 |
| chrono · strict | 0 (0 + 0) | 18 | 0 | 53 | 9 |
| chrono · strict+agree | 0 (0 + 0) | 18 | 0 | 53 | 9 |
| chrono · complete | 0 (0 + 0) | 18 | 0 | 53 | 9 |
| chrono · complete+nouns | 0 (0 + 0) | 18 | 0 | 53 | 9 |
| duckling · value-only | 66 (62 + 4) | 0 | 8 | 0 | 6 |
| duckling · structure | 7 (3 + 4) | 12 | 8 | 47 | 6 |
| duckling · strict | 0 (0 + 0) | 13 | 8 | 53 | 6 |
| duckling · strict+agree | 0 (0 + 0) | 13 | 8 | 53 | 6 |
| duckling · complete | 0 (0 + 0) | 16 | 5 | 53 | 6 |
| duckling · complete+nouns | 0 (0 + 0) | 13 | 8 | 53 | 6 |
| agentfootprint · value-only | 54 (24 + 30) | 0 | 10 | 6 | 10 |
| agentfootprint · structure | 39 (22 + 17) | 1 | 10 | 20 | 10 |
| agentfootprint · strict | 1 (1 + 0) | 7 | 10 | 52 | 10 |
| agentfootprint · strict+agree | 1 (1 + 0) | 7 | 10 | 52 | 10 |
| agentfootprint · complete | 0 (0 + 0) | 11 | 6 | 53 | 10 |
| agentfootprint · complete+nouns | 0 (0 + 0) | 7 | 10 | 53 | 10 |
| library-grammar · value-only | 53 (28 + 25) | 0 | 17 | 0 | 10 |
| library-grammar · structure | 52 (27 + 25) | 0 | 17 | 1 | 10 |
| library-grammar · strict | 1 (1 + 0) | 0 | 17 | 52 | 10 |
| library-grammar · strict+agree | 1 (1 + 0) | 0 | 17 | 52 | 10 |
| library-grammar · complete | 0 (0 + 0) | 8 | 9 | 53 | 10 |
| library-grammar · complete+nouns | 0 (0 + 0) | 0 | 17 | 53 | 10 |
| host app rule (reference) | 8 (6 + 2) | 7 | 10 | 45 | 10 |

| Reader | Coverage gaps (time words its spans miss, or no mention) |
|---|---|
| recognizers | 26 |
| chrono | 36 |
| duckling | 32 |
| agentfootprint | 40 |
| library-grammar | 44 |

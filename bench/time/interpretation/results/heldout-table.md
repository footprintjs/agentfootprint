### Held-out set (n = 80; expected 17 reads, 54 asks, 9 no-time; clock 2026-10-27T09:30:00.000Z)

| Reader · mode | Wrong readings (window or scope + silent default) | Unnecessary clarifications | Exact reads | Correct asks | Correct no-time |
|---|---|---|---|---|---|
| recognizers · value-only | 61 (47 + 14) | 0 | 11 | 0 | 8 |
| recognizers · structure | 18 (15 + 3) | 7 | 11 | 36 | 8 |
| recognizers · strict | 1 (1 + 0) | 7 | 11 | 53 | 8 |
| recognizers · strict+agree | 1 (1 + 0) | 7 | 11 | 53 | 8 |
| recognizers · complete | 0 (0 + 0) | 10 | 8 | 54 | 8 |
| recognizers · complete+nouns | 0 (0 + 0) | 7 | 11 | 54 | 8 |
| chrono · value-only | 59 (47 + 12) | 0 | 13 | 0 | 8 |
| chrono · structure | 12 (0 + 12) | 15 | 0 | 45 | 8 |
| chrono · strict | 0 (0 + 0) | 18 | 0 | 54 | 8 |
| chrono · strict+agree | 0 (0 + 0) | 18 | 0 | 54 | 8 |
| chrono · complete | 0 (0 + 0) | 18 | 0 | 54 | 8 |
| chrono · complete+nouns | 0 (0 + 0) | 18 | 0 | 54 | 8 |
| duckling · value-only | 66 (62 + 4) | 0 | 8 | 0 | 6 |
| duckling · structure | 7 (3 + 4) | 11 | 8 | 48 | 6 |
| duckling · strict | 0 (0 + 0) | 12 | 8 | 54 | 6 |
| duckling · strict+agree | 0 (0 + 0) | 12 | 8 | 54 | 6 |
| duckling · complete | 0 (0 + 0) | 15 | 5 | 54 | 6 |
| duckling · complete+nouns | 0 (0 + 0) | 12 | 8 | 54 | 6 |
| agentfootprint · value-only | 55 (24 + 31) | 0 | 10 | 6 | 9 |
| agentfootprint · structure | 40 (22 + 18) | 1 | 10 | 20 | 9 |
| agentfootprint · strict | 1 (1 + 0) | 7 | 10 | 53 | 9 |
| agentfootprint · strict+agree | 1 (1 + 0) | 7 | 10 | 53 | 9 |
| agentfootprint · complete | 0 (0 + 0) | 11 | 6 | 54 | 9 |
| agentfootprint · complete+nouns | 0 (0 + 0) | 7 | 10 | 54 | 9 |
| library-grammar · value-only | 54 (28 + 26) | 0 | 17 | 0 | 9 |
| library-grammar · structure | 53 (27 + 26) | 0 | 17 | 1 | 9 |
| library-grammar · strict | 1 (1 + 0) | 0 | 17 | 53 | 9 |
| library-grammar · strict+agree | 1 (1 + 0) | 0 | 17 | 53 | 9 |
| library-grammar · complete | 0 (0 + 0) | 8 | 9 | 54 | 9 |
| library-grammar · complete+nouns | 0 (0 + 0) | 0 | 17 | 54 | 9 |
| host app rule (reference) | 9 (6 + 3) | 7 | 10 | 45 | 9 |

| Reader | Coverage gaps (time words its spans miss, or no mention) |
|---|---|
| recognizers | 26 |
| chrono | 36 |
| duckling | 32 |
| agentfootprint | 40 |
| library-grammar | 44 |

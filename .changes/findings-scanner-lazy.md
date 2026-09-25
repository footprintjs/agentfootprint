---
type: changed
---
**Agents that don't use `.findings()` no longer bundle its answer-text
scanner.** The scanner that strips `_findings` notes from the answer and the
token stream (`findings/answerText.ts`) is now loaded on first use, only
when `.findings()` is on — the way the findings judge already loads. A browser
or edge bundle of a plain agent is about 3 KB gzip smaller. Behaviour is
unchanged for findings agents.

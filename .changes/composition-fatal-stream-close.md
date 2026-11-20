---
type: fixed
---
**Close SSE streams when a composition fails.** Both `toSSE()` formats now close
on a composition's fatal error, including when the first step fails before any
Agent turn ends. The run's promise still rejects with its error.

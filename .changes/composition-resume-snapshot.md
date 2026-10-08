---
type: fixed
---
**A composition's records after `resume()` describe the leg that resumed.** `Sequence`,
`Parallel`, `Loop` and `Conditional` ran a resumed leg on an executor of its own but kept pointing
at the paused one, so `getLastSnapshot()`, `getSnapshot()`, a trace and `exportBugReport(runner)`
taken after a resume described the leg that paused, not the one that finished. They now hand back
the resumed leg's, as an `Agent`, `LLMCall`, `LlmRouter`, `Graph` and `Workflow` already did.

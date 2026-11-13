---
type: fixed
---
**Doc comments and folder pages now say what the code checks, with the limits.** A pass over the
documentation found sentences that promised more than the code does. They now state the code's
real behaviour: `PermissionDecision.tellLLM` names both defaults (a deny shows its `rationale` to
the model; a halt uses the generic sentence); `PendingQuestionError` and `Agent.abandonPause()`
say that `abandonPause()` emits no pause event and writes no run record (it does release the
paused run's call- and run-scoped tool teardowns, which emit `agentfootprint.tools.session_closed`
/ `session_close_failed` as any teardown does) and returns the dropped question for the app to log; `FoldedSpan`'s summary fingerprint is a 32-bit join key,
not proof against a crafted message; `flowchartAsTool` says a pause inside the wrapped chart is not bridged to the agent (inside an Agent it becomes a
tool error the model reads, and the checkpoint reaches only a direct caller of `execute`); and
the `agentfootprint.integrity.context_error` payload no longer promises a `duplicate-execution`
finding or canary findings, which no check files. No behaviour changed.

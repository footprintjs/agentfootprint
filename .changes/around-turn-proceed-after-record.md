---
type: fixed
---
**`.aroundTurn`: `proceed` now resolves after the turn's record is filed.** The run's finalizers — the turn's recording under `artifacts: { recordings }`, run-scoped resource cleanup — now run once, inside the wrapper's async context, before `proceed` settles, on every door: `run`, `runTyped`, `followUp`, `resumeOnError`, `resume`, and a hosted run or resume. An `AsyncLocalStorage` an app holds around `proceed` now sees the recording being filed. Failed, cancelled and paused turns are finalized with the end they had; a turn that fails in the agent's own work around a run that settled is still finalized as failed, by the lease, after the wrapper. An agent with no wrapper is unchanged. Needs footprintjs 11.1.0 (`OwnedRun.finish()`).

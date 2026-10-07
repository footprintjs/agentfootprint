---
type: fixed
---

**An abort mid-call is no longer filed as a reliability fail-fast.** With `.reliability(...)` configured, a run cancelled during a model call had its abort routed like a provider failure. It emitted a stray `reliability.fail_fast` event, and in `'classic'` and `'dynamic'` it also wrote the fail-fast record into the snapshot. A rule that retries any error re-asked the cancelled run up to the loop's cap of 50. Now once the run's signal has fired the loop leaves at its next step and rethrows the abort as it came: no rule, no retry, no circuit-breaker count, no `reliability.*` event, no record, the same in all three `reactMode`s. Behaviour change: a signal passed as `agent.run(input, { signal })` (or to `resume`) now also reaches the stages as `env.signal`, as `{ env: { signal } }` already did, so tools see it as `ctx.signal` too.

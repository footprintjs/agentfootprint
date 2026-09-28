---
type: changed
---
**agentfootprint now requires footprintjs 9.28.0 — a paused agent inside a composition resumes with the composition's continuation.**
footprintjs 9.28.0 resumes by walking the real chart instead of a stand-in for
the paused stage. What you will see:

- A paused agent inside a `Conditional` or `Parallel` that is a step of a
  `Sequence` now finishes the composition on resume: `Sequence(Conditional(agent))`
  runs its Finalize (and the steps after it), `Sequence(Parallel(agent, other))`
  runs its Merge once, after the answer. Before, the resumed run ended without
  the composition's result.
- A pause inside a CONCURRENT `graph()` level resumes that node and then runs
  the later levels (before, only the paused node finished).
- When an `LLMCall` run loops back to its client stage, the commit log now
  names the real node (`stage: 'Client'`, its display name) where it wrote the
  stage id (`'client'`) — one field of one bundle; nothing else in the record
  moved.

The `peerDependencies` range and the development dependency move to `^9.28.0`.

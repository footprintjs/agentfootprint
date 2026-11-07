---
type: added
---
**`.aroundTurn({ name, around })`: the supported place for work around a whole turn.** Since 14.0.0 a hosted turn does not call a replaced `agent.run` or `agent.resume`: `standingAgent` dispatches through a private port, so an app that replaced those methods to do awaited work or hold an `AsyncLocalStorage` was skipped with no error. `.aroundTurn` on the builder is the supported place for that work. `around(turn, proceed)` wraps every top-level turn (`run`, `runTyped`, `followUp`, `resumeOnError`, `resume`, a hosted run or resume, the stream handler), after the host's identity, admission and session ownership checks. `proceed()` runs the turn and resolves to nothing, so the wrapper cannot change how the turn ended; `proceed({ time })` sets a new turn's clock through the normal path, and a resume accepts no change.

Misuse is refused by name (`AroundTurnError`). A failure after a good `proceed` leaves the outcome standing and goes on the new event `agentfootprint.agent.around_turn_failed`, with the wrapper's name and the error's class, never its message. A mounted agent with a wrapper is refused when its chart is entered, never skipped.

**`standingAgent` now refuses a replaced method.** An agent whose `run` or `resume` is not the class's own, as an own property or a subclass override, is refused with `ReplacedRunnerMethodError`, which names `.aroundTurn`. Move that work into the wrapper.

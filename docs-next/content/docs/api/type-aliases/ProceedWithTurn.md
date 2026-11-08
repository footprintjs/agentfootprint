---
title: ProceedWithTurn
---

# Type Alias: ProceedWithTurn

> **ProceedWithTurn** = (`changes?`) => `Promise`\<`void`\>

Defined in: [src/core/agent/aroundTurn/types.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L63)

Runs the turn. Resolves to nothing: the output, the pause and the checkpoint
stay with the library. Rejects with the run's own error when the run fails.
When the run completed, paused, failed or was cancelled, it settles only
after the run's finalizers have settled inside the wrapper's context, and
any recording due by then has been filed. A paused run files none yet: its
run-scoped resources stay open and its one recording is filed when the
resumed turn ends. When the turn
fails in the agent's own work around a run that settled (a typed run that
refuses a pause, for example), it rejects first, and those finalizers run
after the wrapper returns, outside its context, so the end stays failed.
The stored recording covers the turn up to this point: a failure the wrapper
raises after `proceed` resolves goes on the live
`agentfootprint.agent.around_turn_failed` event only, not into the record.
Call it once, while the wrapper is still running.

## Parameters

### changes?

[`TurnChanges`](/docs/api/interfaces/TurnChanges)

## Returns

`Promise`\<`void`\>

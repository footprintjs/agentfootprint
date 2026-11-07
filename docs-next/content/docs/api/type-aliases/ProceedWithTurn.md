---
title: ProceedWithTurn
---

# Type Alias: ProceedWithTurn

> **ProceedWithTurn** = (`changes?`) => `Promise`\<`void`\>

Defined in: [src/core/agent/aroundTurn/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L54)

Runs the turn. Resolves to nothing: the output, the pause and the checkpoint
stay with the library. Rejects with the run's own error when the run fails.
It settles only after the turn's record is filed: the run's finalizers (its
recording, resource cleanup) run inside the wrapper's context first.
Call it once, while the wrapper is still running.

## Parameters

### changes?

[`TurnChanges`](/docs/api/interfaces/TurnChanges)

## Returns

`Promise`\<`void`\>

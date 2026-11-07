---
title: ProceedWithTurn
---

# Type Alias: ProceedWithTurn

> **ProceedWithTurn** = (`changes?`) => `Promise`\<`void`\>

Defined in: [src/core/agent/aroundTurn/types.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L52)

Runs the turn. Resolves to nothing: the output, the pause and the checkpoint
stay with the library. Rejects with the run's own error when the run fails.
Call it once, while the wrapper is still running.

## Parameters

### changes?

[`TurnChanges`](/docs/api/interfaces/TurnChanges)

## Returns

`Promise`\<`void`\>

---
title: ConflictRow
---

# Interface: ConflictRow

Defined in: [src/core/agent/findings/types.ts:198](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L198)

The algebra's fact at the write that created it: two stood-on readings on
one key disagree. Written from `conflictsOf`'s output only, once per key.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:203](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L203)

***

### key

> `readonly` **key**: `string`

Defined in: [src/core/agent/findings/types.ts:201](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L201)

The `assertionKey` the readings share.

***

### kind

> `readonly` **kind**: `"conflict"`

Defined in: [src/core/agent/findings/types.ts:199](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L199)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L210)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### witnesses

> `readonly` **witnesses**: readonly [`ConflictWitness`](/docs/api/interfaces/ConflictWitness)[]

Defined in: [src/core/agent/findings/types.ts:202](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L202)

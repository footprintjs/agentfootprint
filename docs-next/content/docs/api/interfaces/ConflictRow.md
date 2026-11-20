---
title: ConflictRow
---

# Interface: ConflictRow

Defined in: [src/core/agent/findings/types.ts:234](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L234)

The algebra's fact at the write that created it: two stood-on readings on
one key disagree. Written from `conflictsOf`'s output only, once per key.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:239](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L239)

***

### key

> `readonly` **key**: `string`

Defined in: [src/core/agent/findings/types.ts:237](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L237)

The `assertionKey` the readings share.

***

### kind

> `readonly` **kind**: `"conflict"`

Defined in: [src/core/agent/findings/types.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L235)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L246)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### witnesses

> `readonly` **witnesses**: readonly [`ConflictWitness`](/docs/api/interfaces/ConflictWitness)[]

Defined in: [src/core/agent/findings/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L238)

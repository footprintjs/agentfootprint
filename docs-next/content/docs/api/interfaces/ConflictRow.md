---
title: ConflictRow
---

# Interface: ConflictRow

Defined in: [src/core/agent/findings/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L214)

The algebra's fact at the write that created it: two stood-on readings on
one key disagree. Written from `conflictsOf`'s output only, once per key.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L219)

***

### key

> `readonly` **key**: `string`

Defined in: [src/core/agent/findings/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L217)

The `assertionKey` the readings share.

***

### kind

> `readonly` **kind**: `"conflict"`

Defined in: [src/core/agent/findings/types.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L215)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:226](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L226)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### witnesses

> `readonly` **witnesses**: readonly [`ConflictWitness`](/docs/api/interfaces/ConflictWitness)[]

Defined in: [src/core/agent/findings/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L218)

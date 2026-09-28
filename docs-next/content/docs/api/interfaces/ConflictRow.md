---
title: ConflictRow
---

# Interface: ConflictRow

Defined in: [src/core/agent/findings/types.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L204)

The algebra's fact at the write that created it: two stood-on readings on
one key disagree. Written from `conflictsOf`'s output only, once per key.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L209)

***

### key

> `readonly` **key**: `string`

Defined in: [src/core/agent/findings/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L207)

The `assertionKey` the readings share.

***

### kind

> `readonly` **kind**: `"conflict"`

Defined in: [src/core/agent/findings/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L205)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L216)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### witnesses

> `readonly` **witnesses**: readonly [`ConflictWitness`](/docs/api/interfaces/ConflictWitness)[]

Defined in: [src/core/agent/findings/types.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L208)

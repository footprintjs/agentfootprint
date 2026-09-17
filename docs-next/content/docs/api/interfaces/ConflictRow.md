---
title: ConflictRow
---

# Interface: ConflictRow

Defined in: [src/core/agent/findings/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L180)

The algebra's fact at the write that created it: two stood-on readings on
one key disagree. Written from `conflictsOf`'s output only, once per key.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L185)

***

### key

> `readonly` **key**: `string`

Defined in: [src/core/agent/findings/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L183)

The `assertionKey` the readings share.

***

### kind

> `readonly` **kind**: `"conflict"`

Defined in: [src/core/agent/findings/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L181)

***

### witnesses

> `readonly` **witnesses**: readonly [`ConflictWitness`](/docs/api/interfaces/ConflictWitness)[]

Defined in: [src/core/agent/findings/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L184)

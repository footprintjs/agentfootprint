[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ConflictRow

# Interface: ConflictRow

Defined in: [src/core/agent/findings/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/findings/types.ts#L181)

The algebra's fact at the write that created it: two stood-on readings on
one key disagree. Written from `conflictsOf`'s output only, once per key.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:186](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/findings/types.ts#L186)

***

### key

> `readonly` **key**: `string`

Defined in: [src/core/agent/findings/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/findings/types.ts#L184)

The `assertionKey` the readings share.

***

### kind

> `readonly` **kind**: `"conflict"`

Defined in: [src/core/agent/findings/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/findings/types.ts#L182)

***

### witnesses

> `readonly` **witnesses**: readonly [`ConflictWitness`](/agentfootprint/api/generated/interfaces/ConflictWitness.md)[]

Defined in: [src/core/agent/findings/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/findings/types.ts#L185)

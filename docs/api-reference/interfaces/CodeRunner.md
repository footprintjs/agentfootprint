[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeRunner

# Interface: CodeRunner

Defined in: [src/adapters/types.ts:1027](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L1027)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:1030](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L1030)

Stable id — reported on every `agentfootprint.tools.session_*` event so a
 row names its backend, not just its tool.

## Methods

### start()

> **start**(`req`): `Promise`\<[`CodeSession`](/agentfootprint/api/generated/interfaces/CodeSession.md)\>

Defined in: [src/adapters/types.ts:1037](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L1037)

Open a session.

`key` is the ISOLATION key the caller derived (see `toolSessionKey`). An
adapter may use it to name the remote session; it must never widen it.

#### Parameters

##### req

###### key

`string`

###### language?

`string`

###### signal?

`AbortSignal`

#### Returns

`Promise`\<[`CodeSession`](/agentfootprint/api/generated/interfaces/CodeSession.md)\>

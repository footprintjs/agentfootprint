---
title: CodeRunner
---

# Interface: CodeRunner

Defined in: [src/provider-contract/types.ts:1092](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1092)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/provider-contract/types.ts:1095](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1095)

Stable id — reported on every `agentfootprint.tools.session_*` event so a
 row names its backend, not just its tool.

## Methods

### start()

> **start**(`req`): `Promise`\<[`CodeSession`](/docs/api/interfaces/CodeSession)\>

Defined in: [src/provider-contract/types.ts:1102](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1102)

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

`Promise`\<[`CodeSession`](/docs/api/interfaces/CodeSession)\>

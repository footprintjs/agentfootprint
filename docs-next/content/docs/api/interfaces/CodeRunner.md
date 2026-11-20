---
title: CodeRunner
---

# Interface: CodeRunner

Defined in: [src/provider-contract/types.ts:1055](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1055)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/provider-contract/types.ts:1058](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1058)

Stable id — reported on every `agentfootprint.tools.session_*` event so a
 row names its backend, not just its tool.

## Methods

### start()

> **start**(`req`): `Promise`\<[`CodeSession`](/docs/api/interfaces/CodeSession)\>

Defined in: [src/provider-contract/types.ts:1065](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1065)

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

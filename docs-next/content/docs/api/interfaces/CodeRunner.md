---
title: CodeRunner
---

# Interface: CodeRunner

Defined in: [src/adapters/types.ts:1047](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1047)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:1050](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1050)

Stable id — reported on every `agentfootprint.tools.session_*` event so a
 row names its backend, not just its tool.

## Methods

### start()

> **start**(`req`): `Promise`\<[`CodeSession`](/docs/api/interfaces/CodeSession)\>

Defined in: [src/adapters/types.ts:1057](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1057)

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

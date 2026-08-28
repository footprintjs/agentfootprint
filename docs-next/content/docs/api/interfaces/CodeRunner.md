---
title: CodeRunner
---

# Interface: CodeRunner

Defined in: [src/adapters/types.ts:981](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L981)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:984](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L984)

Stable id — reported on every `agentfootprint.tools.session_*` event so a
 row names its backend, not just its tool.

## Methods

### start()

> **start**(`req`): `Promise`\<[`CodeSession`](/docs/api/interfaces/CodeSession)\>

Defined in: [src/adapters/types.ts:991](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L991)

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

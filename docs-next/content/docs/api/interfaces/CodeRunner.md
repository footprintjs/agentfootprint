---
title: CodeRunner
---

# Interface: CodeRunner

Defined in: [src/adapters/types.ts:1143](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1143)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:1146](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1146)

Stable id — reported on every `agentfootprint.tools.session_*` event so a
 row names its backend, not just its tool.

## Methods

### start()

> **start**(`req`): `Promise`\<[`CodeSession`](/docs/api/interfaces/CodeSession)\>

Defined in: [src/adapters/types.ts:1153](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1153)

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

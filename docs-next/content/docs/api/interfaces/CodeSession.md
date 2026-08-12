---
title: CodeSession
---

# Interface: CodeSession

Defined in: [src/adapters/types.ts:778](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L778)

One live session. `stop()` is idempotent and tolerates "already gone".

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:780](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L780)

The backend's own id for this session, when it has one.

## Methods

### execute()

> **execute**(`req`): `Promise`\<[`CodeResult`](/docs/api/interfaces/CodeResult)\>

Defined in: [src/adapters/types.ts:781](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L781)

#### Parameters

##### req

###### code

`string`

###### language?

`string`

###### signal?

`AbortSignal`

###### timeoutMs?

`number`

#### Returns

`Promise`\<[`CodeResult`](/docs/api/interfaces/CodeResult)\>

***

### stop()

> **stop**(): `Promise`\<`void`\>

Defined in: [src/adapters/types.ts:794](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L794)

Release the session.

Must tolerate a session the far side already reaped — an idle timeout is
the reality on every managed backend, and a `Stop` on a dead session is a
no-op, not an error.

#### Returns

`Promise`\<`void`\>

---
title: SqliteArtifacts
---

# Interface: SqliteArtifacts

Defined in: [src/artifacts/sqliteArtifacts.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sqliteArtifacts.ts#L101)

The store, plus the three things a real file store owes beyond the port.

## Extends

- [`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

## Properties

### journalMode

> `readonly` **journalMode**: `string`

Defined in: [src/artifacts/sqliteArtifacts.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sqliteArtifacts.ts#L103)

The journal mode the file ACTUALLY has, read back from SQLite.

## Methods

### close()

> **close**(): `void`

Defined in: [src/artifacts/sqliteArtifacts.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sqliteArtifacts.ts#L105)

Close the file. Idempotent; using the store afterwards refuses by name.

#### Returns

`void`

***

### delete()

> **delete**(`scope`, `ref`): `Promise`\<`void`\>

Defined in: [src/artifacts/types.ts:257](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L257)

Remove one artifact. No-op when it does not exist — deleting an absence
 is not an error, it is agreement.

#### Parameters

##### scope

`MemoryIdentity`

##### ref

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore).[`delete`](/docs/api/interfaces/ArtifactStore#delete)

***

### get()

> **get**(`scope`, `ref`): `Promise`\<[`ArtifactRecord`](/docs/api/interfaces/ArtifactRecord) \| `null`\>

Defined in: [src/artifacts/types.ts:253](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L253)

The ticket and the payload. `null` for missing-or-expired. When the meta
carries a `digest`, the payload is re-verified here — a mismatch throws
[ArtifactIntegrityError](/docs/api/classes/ArtifactIntegrityError), never returns corrupt bytes as if whole.

#### Parameters

##### scope

`MemoryIdentity`

##### ref

`string`

#### Returns

`Promise`\<[`ArtifactRecord`](/docs/api/interfaces/ArtifactRecord) \| `null`\>

#### Inherited from

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore).[`get`](/docs/api/interfaces/ArtifactStore#get)

***

### getStream()?

> `optional` **getStream**(`scope`, `ref`): `Promise`\<[`ArtifactStreamRecord`](/docs/api/interfaces/ArtifactStreamRecord) \| `null`\>

Defined in: [src/artifacts/types.ts:288](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L288)

OPTIONAL — read a payload as a stream of its canonical bytes. `null` for
missing-or-expired, exactly like `get`. Absent on stores that would have
to read the payload whole to answer; detect with
`canGetArtifactStream(store)`.

A `digest` on the meta is NOT re-verified here — verification needs the
whole payload, which is the thing this member exists to avoid. `get`
remains the verifying read, and the difference is stated rather than
silently traded.

#### Parameters

##### scope

`MemoryIdentity`

##### ref

`string`

#### Returns

`Promise`\<[`ArtifactStreamRecord`](/docs/api/interfaces/ArtifactStreamRecord) \| `null`\>

#### Inherited from

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore).[`getStream`](/docs/api/interfaces/ArtifactStore#getstream)

***

### head()

> **head**(`scope`, `ref`): `Promise`\<[`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta) \| `null`\>

Defined in: [src/artifacts/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L246)

The ticket without the payload — the render-by-ref decision. `null` for
missing-or-expired (the deliberate ambiguity; both mean "no data").

#### Parameters

##### scope

`MemoryIdentity`

##### ref

`string`

#### Returns

`Promise`\<[`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta) \| `null`\>

#### Inherited from

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore).[`head`](/docs/api/interfaces/ArtifactStore#head)

***

### list()

> **list**(`scope`, `options?`): `Promise`\<[`ArtifactListResult`](/docs/api/interfaces/ArtifactListResult)\>

Defined in: [src/artifacts/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L260)

Page through this scope's tickets, newest first.

#### Parameters

##### scope

`MemoryIdentity`

##### options?

[`ArtifactListOptions`](/docs/api/interfaces/ArtifactListOptions)

#### Returns

`Promise`\<[`ArtifactListResult`](/docs/api/interfaces/ArtifactListResult)\>

#### Inherited from

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore).[`list`](/docs/api/interfaces/ArtifactStore#list)

***

### put()

> **put**(`scope`, `input`): `Promise`\<[`ArtifactPutResult`](/docs/api/interfaces/ArtifactPutResult)\>

Defined in: [src/artifacts/types.ts:240](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L240)

Store a payload; mint and return the ticket. Validates the input (a
malformed put is refused by name), validates `parentRefs` resolve in the
SAME scope, measures, optionally digests, stamps `expiresAt` from the
store's retention — and reports what retention swept to make room.

#### Parameters

##### scope

`MemoryIdentity`

##### input

[`PutArtifactInput`](/docs/api/interfaces/PutArtifactInput)

#### Returns

`Promise`\<[`ArtifactPutResult`](/docs/api/interfaces/ArtifactPutResult)\>

#### Inherited from

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore).[`put`](/docs/api/interfaces/ArtifactStore#put)

***

### putStream()?

> `optional` **putStream**(`scope`, `input`, `body`): `Promise`\<[`ArtifactPutResult`](/docs/api/interfaces/ArtifactPutResult)\>

Defined in: [src/artifacts/types.ts:271](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L271)

OPTIONAL — store a payload the caller streams, without either side
holding it whole. Absent on stores that cannot honor that promise; detect
with `canPutArtifactStream(store)` before calling.

The stream is consumed exactly once. Everything else is `put`'s law:
`parentRefs` are proven first, retention plans against the DECLARED
`bytes`, and the sweep rides the result.

#### Parameters

##### scope

`MemoryIdentity`

##### input

[`ArtifactStreamPutInput`](/docs/api/interfaces/ArtifactStreamPutInput)

##### body

`ReadableStream`\<`Uint8Array`\>

#### Returns

`Promise`\<[`ArtifactPutResult`](/docs/api/interfaces/ArtifactPutResult)\>

#### Inherited from

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore).[`putStream`](/docs/api/interfaces/ArtifactStore#putstream)

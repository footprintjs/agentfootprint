---
title: InMemoryArtifacts
---

# Interface: InMemoryArtifacts

Defined in: [src/artifacts/inMemoryArtifacts.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/inMemoryArtifacts.ts#L75)

The in-memory store, plus the accounting a bounded store owes its owner.

## Extends

- [`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

## Properties

### dropped

> `readonly` **dropped**: `number`

Defined in: [src/artifacts/inMemoryArtifacts.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/inMemoryArtifacts.ts#L79)

Artifacts evicted by the byte/row budgets since construction (TTL expiry
 is the calendar doing its job and is not counted here). Non-zero means
 "resolve sooner, or raise the budget".

***

### retention

> `readonly` **retention**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/inMemoryArtifacts.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/inMemoryArtifacts.ts#L81)

The dials in force, defaults included.

## Methods

### delete()

> **delete**(`scope`, `ref`): `Promise`\<`void`\>

Defined in: [src/artifacts/types.ts:264](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L264)

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

Defined in: [src/artifacts/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L260)

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

Defined in: [src/artifacts/types.ts:295](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L295)

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

Defined in: [src/artifacts/types.ts:253](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L253)

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

Defined in: [src/artifacts/types.ts:267](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L267)

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

Defined in: [src/artifacts/types.ts:247](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L247)

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

Defined in: [src/artifacts/types.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L278)

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

***

### scopeBudget()?

> `optional` **scopeBudget**(`scope`): `Promise`\<[`ArtifactScopeBudget`](/docs/api/interfaces/ArtifactScopeBudget) \| `null`\>

Defined in: [src/artifacts/types.ts:303](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L303)

OPTIONAL — the budget `put` enforces in `scope`: the most bytes and the
most artifacts the scope may hold. `null` when neither binds. A statement
of the store's retention, never a reservation: other writers may still
fill the scope, and a put may still evict older artifacts to make room.

#### Parameters

##### scope

`MemoryIdentity`

#### Returns

`Promise`\<[`ArtifactScopeBudget`](/docs/api/interfaces/ArtifactScopeBudget) \| `null`\>

#### Inherited from

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore).[`scopeBudget`](/docs/api/interfaces/ArtifactStore#scopebudget)

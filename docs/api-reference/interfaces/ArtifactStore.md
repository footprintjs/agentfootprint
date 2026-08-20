[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactStore

# Interface: ArtifactStore

Defined in: [src/artifacts/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L225)

The port — five verbs, scope first, vendor-neutral, plus two optional
streaming members. Adapters are the vendor layer; every backend
(in-process, on-disk, embedded database, remote object storage) implements
exactly this.

## Extended by

- [`InMemoryArtifacts`](/agentfootprint/api/generated/interfaces/InMemoryArtifacts.md)
- [`SqliteArtifacts`](/agentfootprint/api/generated/interfaces/SqliteArtifacts.md)

## Methods

### delete()

> **delete**(`scope`, `ref`): `Promise`\<`void`\>

Defined in: [src/artifacts/types.ts:249](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L249)

Remove one artifact. No-op when it does not exist — deleting an absence
 is not an error, it is agreement.

#### Parameters

##### scope

`MemoryIdentity`

##### ref

`string`

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`scope`, `ref`): `Promise`\<[`ArtifactRecord`](/agentfootprint/api/generated/interfaces/ArtifactRecord.md) \| `null`\>

Defined in: [src/artifacts/types.ts:245](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L245)

The ticket and the payload. `null` for missing-or-expired. When the meta
carries a `digest`, the payload is re-verified here — a mismatch throws
[ArtifactIntegrityError](/agentfootprint/api/generated/classes/ArtifactIntegrityError.md), never returns corrupt bytes as if whole.

#### Parameters

##### scope

`MemoryIdentity`

##### ref

`string`

#### Returns

`Promise`\<[`ArtifactRecord`](/agentfootprint/api/generated/interfaces/ArtifactRecord.md) \| `null`\>

***

### getStream()?

> `optional` **getStream**(`scope`, `ref`): `Promise`\<[`ArtifactStreamRecord`](/agentfootprint/api/generated/interfaces/ArtifactStreamRecord.md) \| `null`\>

Defined in: [src/artifacts/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L280)

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

`Promise`\<[`ArtifactStreamRecord`](/agentfootprint/api/generated/interfaces/ArtifactStreamRecord.md) \| `null`\>

***

### head()

> **head**(`scope`, `ref`): `Promise`\<[`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md) \| `null`\>

Defined in: [src/artifacts/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L238)

The ticket without the payload — the render-by-ref decision. `null` for
missing-or-expired (the deliberate ambiguity; both mean "no data").

#### Parameters

##### scope

`MemoryIdentity`

##### ref

`string`

#### Returns

`Promise`\<[`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md) \| `null`\>

***

### list()

> **list**(`scope`, `options?`): `Promise`\<[`ArtifactListResult`](/agentfootprint/api/generated/interfaces/ArtifactListResult.md)\>

Defined in: [src/artifacts/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L252)

Page through this scope's tickets, newest first.

#### Parameters

##### scope

`MemoryIdentity`

##### options?

[`ArtifactListOptions`](/agentfootprint/api/generated/interfaces/ArtifactListOptions.md)

#### Returns

`Promise`\<[`ArtifactListResult`](/agentfootprint/api/generated/interfaces/ArtifactListResult.md)\>

***

### put()

> **put**(`scope`, `input`): `Promise`\<[`ArtifactPutResult`](/agentfootprint/api/generated/interfaces/ArtifactPutResult.md)\>

Defined in: [src/artifacts/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L232)

Store a payload; mint and return the ticket. Validates the input (a
malformed put is refused by name), validates `parentRefs` resolve in the
SAME scope, measures, optionally digests, stamps `expiresAt` from the
store's retention — and reports what retention swept to make room.

#### Parameters

##### scope

`MemoryIdentity`

##### input

[`PutArtifactInput`](/agentfootprint/api/generated/interfaces/PutArtifactInput.md)

#### Returns

`Promise`\<[`ArtifactPutResult`](/agentfootprint/api/generated/interfaces/ArtifactPutResult.md)\>

***

### putStream()?

> `optional` **putStream**(`scope`, `input`, `body`): `Promise`\<[`ArtifactPutResult`](/agentfootprint/api/generated/interfaces/ArtifactPutResult.md)\>

Defined in: [src/artifacts/types.ts:263](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L263)

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

[`ArtifactStreamPutInput`](/agentfootprint/api/generated/interfaces/ArtifactStreamPutInput.md)

##### body

`ReadableStream`\<`Uint8Array`\>

#### Returns

`Promise`\<[`ArtifactPutResult`](/agentfootprint/api/generated/interfaces/ArtifactPutResult.md)\>

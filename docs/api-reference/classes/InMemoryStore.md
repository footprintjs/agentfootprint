[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InMemoryStore

# Class: InMemoryStore

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:38](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L38)

## Implements

- `MemoryStore`

## Constructors

### Constructor

> **new InMemoryStore**(): `InMemoryStore`

#### Returns

`InMemoryStore`

## Methods

### delete()

> **delete**(`identity`, `id`): `Promise`\<`void`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:160](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L160)

Remove one entry. No-op if the entry doesn't exist.

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### id

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`MemoryStore.delete`

***

### feedback()

> **feedback**(`identity`, `id`, `usefulness`): `Promise`\<`void`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:176](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L176)

Record usefulness feedback for an entry. `usefulness` in `[-1, 1]`:
  -1 = retrieved but harmful / misleading
   0 = retrieved but not used (neutral)
   1 = retrieved AND used in the final answer

Non-finite values (NaN / ±Infinity) MUST be rejected by adapters —
they poison the aggregate. Caller should pass a finite number in
`[-1, 1]`; adapters clamp to the valid range for hardening.

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### id

`string`

##### usefulness

`number`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`MemoryStore.feedback`

***

### forget()

> **forget**(`identity`): `Promise`\<`void`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:203](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L203)

GDPR — remove ALL entries for the given identity.
Must be implementable in one operation per backend (DELETE WHERE prefix).

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

`MemoryStore.forget`

***

### get()

> **get**\<`T`\>(`identity`, `id`): `Promise`\<`MemoryEntry`\<`T`\> \| `null`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:65](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L65)

Fetch one entry by id within the given identity's namespace.
Returns `null` when the entry doesn't exist OR has expired (TTL).
Callers should not distinguish — both mean "no data."

Side effect: adapters MAY increment `accessCount` and update
`lastAccessedAt` when returning the entry (decay signals).

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### id

`string`

#### Returns

`Promise`\<`MemoryEntry`\<`T`\> \| `null`\>

#### Implementation of

`MemoryStore.get`

***

### getFeedback()

> **getFeedback**(`identity`, `id`): `Promise`\<\{ `average`: `number`; `count`: `number`; \} \| `null`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:194](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L194)

Read-side of feedback — aggregated usefulness for an entry. Returns
`null` when no feedback has been recorded (distinct from "neutral
average of 0" — callers often want to treat the two differently).
Retrieval stages consume this to feedback-weight rankings.

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### id

`string`

#### Returns

`Promise`\<\{ `average`: `number`; `count`: `number`; \} \| `null`\>

#### Implementation of

`MemoryStore.getFeedback`

***

### list()

> **list**\<`T`\>(`identity`, `options?`): `Promise`\<`ListResult`\<`T`\>\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:131](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L131)

Page through entries in the identity's namespace. Ordered by adapter's
choice (usually most-recently-updated first) — consumers that care
about order should filter client-side.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### options?

`ListOptions`

#### Returns

`Promise`\<`ListResult`\<`T`\>\>

#### Implementation of

`MemoryStore.list`

***

### put()

> **put**\<`T`\>(`identity`, `entry`): `Promise`\<`void`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:85](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L85)

Unconditional write — overwrites any existing entry with the same id.
Prefer `putIfVersion` in multi-writer scenarios.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### entry

`MemoryEntry`\<`T`\>

#### Returns

`Promise`\<`void`\>

#### Implementation of

`MemoryStore.put`

***

### putIfVersion()

> **putIfVersion**\<`T`\>(`identity`, `entry`, `expectedVersion`): `Promise`\<`PutIfVersionResult`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:106](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L106)

Optimistic-concurrency write. Writes only if the stored version equals
`expectedVersion`, OR if no entry exists at all AND `expectedVersion`
is `0` (first-write sentinel).

Returns `{ applied: true }` on success, `{ applied: false, currentVersion }`
when the caller's assumed version is stale.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### entry

`MemoryEntry`\<`T`\>

##### expectedVersion

`number`

#### Returns

`Promise`\<`PutIfVersionResult`\>

#### Implementation of

`MemoryStore.putIfVersion`

***

### putMany()

> **putMany**\<`T`\>(`identity`, `entries`): `Promise`\<`void`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:95](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L95)

Batched write — resolves the slot once and writes each entry into the
same Map. Saves N-1 slot lookups vs. calling `put()` in a loop, and
gives network-backed adapters a place to pipeline round-trips.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### entries

readonly `MemoryEntry`\<`T`\>[]

#### Returns

`Promise`\<`void`\>

#### Implementation of

`MemoryStore.putMany`

***

### recordSignature()

> **recordSignature**(`identity`, `signature`): `Promise`\<`void`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:172](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L172)

Write-side of the recognition set — adds a signature so subsequent
`seen()` calls return `true`. Stages register signatures as entries
are written (content hashes, canonicalized facts). Separate from the
entry store: a signature outlives the entry that produced it, so
dedup survives garbage collection.

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### signature

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`MemoryStore.recordSignature`

***

### search()

> **search**\<`T`\>(`identity`, `query`, `options?`): `Promise`\<readonly `ScoredEntry`\<`T`\>[]\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:220](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L220)

O(n) linear scan over identity-scoped entries. Fine for dev / tests
— for production, plug in a real vector backend (pgvector, Pinecone,
Qdrant) that implements the same interface.

Semantics per the `MemoryStore.search?` contract:
  - Entries without `embedding` are skipped (ignored, not errored).
  - Entries with `embedding.length` mismatching the query are
    skipped (cosine would throw — silent-skip avoids poisoning top-k).
  - TTL-expired entries are omitted.
  - Optional `tiers` / `minScore` / `embedderId` filters applied.
  - Returns descending by score; ties broken by id for determinism.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### query

readonly `number`[]

##### options?

`SearchOptions`

#### Returns

`Promise`\<readonly `ScoredEntry`\<`T`\>[]\>

#### Implementation of

`MemoryStore.search`

***

### seen()

> **seen**(`identity`, `signature`): `Promise`\<`boolean`\>

Defined in: [agentfootprint/src/memory/store/InMemoryStore.ts:168](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/store/InMemoryStore.ts#L168)

Cheap "have we processed this signature before?" check. Useful for
deduplication, idempotent writes, and cognitive-arch-style recognition
vs. recall. Signature is an opaque string the caller controls
(content hash, canonicalized fact, etc.).

#### Parameters

##### identity

[`MemoryIdentity`](/agentfootprint/api/generated/interfaces/MemoryIdentity.md)

##### signature

`string`

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

`MemoryStore.seen`

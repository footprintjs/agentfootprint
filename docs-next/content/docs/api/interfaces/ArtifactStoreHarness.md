---
title: ArtifactStoreHarness
---

# Interface: ArtifactStoreHarness

Defined in: [src/artifacts/conformance/types.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L74)

How the battery reaches one store.

A factory rather than an instance, because most of the battery needs a store
with NOTHING in it — a listing case that saw another case's rows would be
asserting on somebody else's fixtures — and because a store that has been
closed, or whose directory was removed, cannot be reset in place. One store
per case, disposed after it, is the only shape that holds for a `Map`, a
directory, an embedded database and a bucket at once.

## Properties

### declared?

> `readonly` `optional` **declared?**: `Partial`\<`Record`\<[`ArtifactStoreCaseName`](/docs/api/type-aliases/ArtifactStoreCaseName), `string`\>\>

Defined in: [src/artifacts/conformance/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L134)

Cases this store cannot satisfy, BY NAME, each with the reason.

The reason is required, and it is the point. A store may legitimately be
unable to satisfy a case — a `Map` closed over by its factory genuinely
cannot be corrupted from outside — and the honest way to record that is a
sentence somebody can disagree with. A silent skip is a pass with the
evidence removed.

A declared case still RUNS. If it turns out to pass, the report says so,
and the declaration is stale: a gate that absolves itself is worth
catching, and so is a gate nobody needed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/artifacts/conformance/types.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L76)

What this store is called in a report.

## Methods

### advanceTime()?

> `optional` **advanceTime**(`store`, `ms`): `void` \| `Promise`\<`void`\>

Defined in: [src/artifacts/conformance/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L101)

Move THIS store's clock forward by `ms`.

Expiry is the one law that cannot be observed without time passing, and
sleeping for it would make the battery slow enough that somebody deletes
the case. A store built on an injectable clock implements this in one
line; a store whose time comes from a service it does not control must
DECLARE the cases below by name.

#### Parameters

##### store

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

##### ms

`number`

#### Returns

`void` \| `Promise`\<`void`\>

***

### boundedStore()?

> `optional` **boundedStore**(`maxBytesPerScope`): [`ArtifactStore`](/docs/api/interfaces/ArtifactStore) \| `Promise`\<[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)\>

Defined in: [src/artifacts/conformance/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L120)

A fresh, empty store whose per-scope byte budget is `maxBytesPerScope`.

The ceiling law needs a ceiling small enough to hit in a test, and a
budget is configuration rather than a verb — there is no way to ask for it
through the port. A store with no configurable ceiling declares the case.

#### Parameters

##### maxBytesPerScope

`number`

#### Returns

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore) \| `Promise`\<[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)\>

***

### corrupt()?

> `optional` **corrupt**(`store`, `scope`, `ref`): `void` \| `Promise`\<`void`\>

Defined in: [src/artifacts/conformance/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L112)

Replace one artifact's stored PAYLOAD with different, well-formed bytes,
behind the store's back — the artifact must still be readable, just no
longer what was put.

There is no portable way to do this — it is a poke at the file, the row,
or the object — so it is the harness's job. It is what makes the integrity
law observable at all: `get` re-hashes and must refuse. A store nothing
outside it can reach must DECLARE those cases with the reason.

#### Parameters

##### store

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

##### scope

`MemoryIdentity`

##### ref

`string`

#### Returns

`void` \| `Promise`\<`void`\>

***

### createStore()

> **createStore**(): [`ArtifactStore`](/docs/api/interfaces/ArtifactStore) \| `Promise`\<[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)\>

Defined in: [src/artifacts/conformance/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L84)

A fresh store holding no artifacts. Called once per case.

May be sync or async: some stores open a file, some await a connection,
and a battery that demanded one shape would exclude half the stores it is
here to check.

#### Returns

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore) \| `Promise`\<[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)\>

***

### disposeStore()?

> `optional` **disposeStore**(`store`): `void` \| `Promise`\<`void`\>

Defined in: [src/artifacts/conformance/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L91)

Release what `createStore` (or [boundedStore](/docs/api/interfaces/ArtifactStoreHarness#boundedstore)) acquired. Called
after every case, including the ones that failed — a store left open by a
failing case is a handle leak that surfaces three cases later as a
confusing second failure.

#### Parameters

##### store

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

#### Returns

`void` \| `Promise`\<`void`\>

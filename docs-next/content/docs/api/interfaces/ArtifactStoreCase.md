---
title: ArtifactStoreCase
---

# Interface: ArtifactStoreCase

Defined in: src/artifacts/conformance/types.ts:171

One case in the battery.

## Properties

### harnessNeeds?

> `readonly` `optional` **harnessNeeds?**: readonly [`ArtifactStoreHarnessHook`](/docs/api/type-aliases/ArtifactStoreHarnessHook)[]

Defined in: src/artifacts/conformance/types.ts:178

Harness hooks without which this case cannot run at all.

***

### law

> `readonly` **law**: `string`

Defined in: src/artifacts/conformance/types.ts:174

The law it holds, in one sentence — printed beside a failure.

***

### members?

> `readonly` `optional` **members?**: readonly [`ArtifactStoreMember`](/docs/api/type-aliases/ArtifactStoreMember)[]

Defined in: src/artifacts/conformance/types.ts:176

Optional port members without which this case does not apply.

***

### name

> `readonly` **name**: [`ArtifactStoreCaseName`](/docs/api/type-aliases/ArtifactStoreCaseName)

Defined in: src/artifacts/conformance/types.ts:172

## Methods

### run()

> **run**(`store`, `kit`): `Promise`\<`void`\>

Defined in: src/artifacts/conformance/types.ts:179

#### Parameters

##### store

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

##### kit

[`ArtifactConformanceKit`](/docs/api/interfaces/ArtifactConformanceKit)

#### Returns

`Promise`\<`void`\>

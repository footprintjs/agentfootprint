[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactStoreCase

# Interface: ArtifactStoreCase

Defined in: [src/artifacts/conformance/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L171)

One case in the battery.

## Properties

### harnessNeeds?

> `readonly` `optional` **harnessNeeds?**: readonly [`ArtifactStoreHarnessHook`](/agentfootprint/api/generated/type-aliases/ArtifactStoreHarnessHook.md)[]

Defined in: [src/artifacts/conformance/types.ts:178](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L178)

Harness hooks without which this case cannot run at all.

***

### law

> `readonly` **law**: `string`

Defined in: [src/artifacts/conformance/types.ts:174](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L174)

The law it holds, in one sentence — printed beside a failure.

***

### members?

> `readonly` `optional` **members?**: readonly [`ArtifactStoreMember`](/agentfootprint/api/generated/type-aliases/ArtifactStoreMember.md)[]

Defined in: [src/artifacts/conformance/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L176)

Optional port members without which this case does not apply.

***

### name

> `readonly` **name**: [`ArtifactStoreCaseName`](/agentfootprint/api/generated/type-aliases/ArtifactStoreCaseName.md)

Defined in: [src/artifacts/conformance/types.ts:172](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L172)

## Methods

### run()

> **run**(`store`, `kit`): `Promise`\<`void`\>

Defined in: [src/artifacts/conformance/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L179)

#### Parameters

##### store

[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

##### kit

[`ArtifactConformanceKit`](/agentfootprint/api/generated/interfaces/ArtifactConformanceKit.md)

#### Returns

`Promise`\<`void`\>

---
title: DatasetResultPlan<TProjected>
---

# Interface: DatasetResultPlan\<TProjected\>

Defined in: [src/artifacts/datasetResult.ts:27](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/datasetResult.ts#L27)

Projection owns field meanings, coverage envelopes and inline policy; receipts contain no rows.

## Type Parameters

### TProjected

`TProjected` = `unknown`

## Properties

### datasets

> `readonly` **datasets**: readonly [`DatasetArtifactInput`](/docs/api/interfaces/DatasetArtifactInput)[]

Defined in: [src/artifacts/datasetResult.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/datasetResult.ts#L28)

## Methods

### project()

> **project**(`publications`): `TProjected` \| `Promise`\<`TProjected`\>

Defined in: [src/artifacts/datasetResult.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/datasetResult.ts#L29)

#### Parameters

##### publications

readonly [`DatasetPublication`](/docs/api/interfaces/DatasetPublication)[]

#### Returns

`TProjected` \| `Promise`\<`TProjected`\>

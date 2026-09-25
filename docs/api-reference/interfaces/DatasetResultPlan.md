[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DatasetResultPlan

# Interface: DatasetResultPlan\<TProjected\>

Defined in: [src/artifacts/datasetResult.ts:29](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/datasetResult.ts#L29)

Projection owns field meanings, coverage envelopes and inline policy; receipts contain no rows.

## Type Parameters

### TProjected

`TProjected` = `unknown`

## Properties

### datasets

> `readonly` **datasets**: readonly [`DatasetArtifactInput`](/agentfootprint/api/generated/interfaces/DatasetArtifactInput.md)[]

Defined in: [src/artifacts/datasetResult.ts:30](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/datasetResult.ts#L30)

## Methods

### project()

> **project**(`publications`): `TProjected` \| `Promise`\<`TProjected`\>

Defined in: [src/artifacts/datasetResult.ts:31](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/datasetResult.ts#L31)

#### Parameters

##### publications

readonly [`DatasetPublication`](/agentfootprint/api/generated/interfaces/DatasetPublication.md)[]

#### Returns

`TProjected` \| `Promise`\<`TProjected`\>

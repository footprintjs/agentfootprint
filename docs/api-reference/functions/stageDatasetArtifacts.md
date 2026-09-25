[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / stageDatasetArtifacts

# Function: stageDatasetArtifacts()

> **stageDatasetArtifacts**(`datasets`, `artifacts`): `Promise`\<readonly [`DatasetPublication`](/agentfootprint/api/generated/interfaces/DatasetPublication.md)[]\>

Defined in: [src/artifacts/datasetResult.ts:85](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/datasetResult.ts#L85)

The same staging step for an existing tool pipeline that already owns execution and projection.

## Parameters

### datasets

readonly [`DatasetArtifactInput`](/agentfootprint/api/generated/interfaces/DatasetArtifactInput.md)[]

### artifacts

[`ToolArtifacts`](/agentfootprint/api/generated/interfaces/ToolArtifacts.md)

## Returns

`Promise`\<readonly [`DatasetPublication`](/agentfootprint/api/generated/interfaces/DatasetPublication.md)[]\>

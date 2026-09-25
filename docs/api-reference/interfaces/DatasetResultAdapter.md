[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DatasetResultAdapter

# Interface: DatasetResultAdapter\<TArgs, TResult, TProjected\>

Defined in: [src/artifacts/datasetResult.ts:34](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/datasetResult.ts#L34)

## Type Parameters

### TArgs

`TArgs` = `Record`\<`string`, `unknown`\>

### TResult

`TResult` = `unknown`

### TProjected

`TProjected` = `unknown`

## Methods

### describe()

> **describe**(`result`, `args`): [`DatasetResultPlan`](/agentfootprint/api/generated/interfaces/DatasetResultPlan.md)\<`TProjected`\> \| `Promise`\<[`DatasetResultPlan`](/agentfootprint/api/generated/interfaces/DatasetResultPlan.md)\<`TProjected`\> \| `undefined`\> \| `undefined`

Defined in: [src/artifacts/datasetResult.ts:40](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/datasetResult.ts#L40)

Undefined is an intentional pass-through (for example a declared absence).

#### Parameters

##### result

`TResult`

##### args

`TArgs`

#### Returns

[`DatasetResultPlan`](/agentfootprint/api/generated/interfaces/DatasetResultPlan.md)\<`TProjected`\> \| `Promise`\<[`DatasetResultPlan`](/agentfootprint/api/generated/interfaces/DatasetResultPlan.md)\<`TProjected`\> \| `undefined`\> \| `undefined`

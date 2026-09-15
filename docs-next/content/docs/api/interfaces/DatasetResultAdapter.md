---
title: DatasetResultAdapter<TArgs, TResult, TProjected>
---

# Interface: DatasetResultAdapter\<TArgs, TResult, TProjected\>

Defined in: src/artifacts/datasetResult.ts:34

## Type Parameters

### TArgs

`TArgs` = `Record`\<`string`, `unknown`\>

### TResult

`TResult` = `unknown`

### TProjected

`TProjected` = `unknown`

## Methods

### describe()

> **describe**(`result`, `args`): [`DatasetResultPlan`](/docs/api/interfaces/DatasetResultPlan)\<`TProjected`\> \| `Promise`\<[`DatasetResultPlan`](/docs/api/interfaces/DatasetResultPlan)\<`TProjected`\> \| `undefined`\> \| `undefined`

Defined in: src/artifacts/datasetResult.ts:40

Undefined is an intentional pass-through (for example a declared absence).

#### Parameters

##### result

`TResult`

##### args

`TArgs`

#### Returns

[`DatasetResultPlan`](/docs/api/interfaces/DatasetResultPlan)\<`TProjected`\> \| `Promise`\<[`DatasetResultPlan`](/docs/api/interfaces/DatasetResultPlan)\<`TProjected`\> \| `undefined`\> \| `undefined`

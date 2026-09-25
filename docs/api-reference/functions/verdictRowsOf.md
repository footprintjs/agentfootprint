[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / verdictRowsOf

# Function: verdictRowsOf()

> **verdictRowsOf**(`state`): [`VerdictRow`](/agentfootprint/api/generated/interfaces/VerdictRow.md)[]

Defined in: [src/core/runbook/verdicts.ts:80](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/runbook/verdicts.ts#L80)

Read the rowset off the final state's `verdicts` key — an array of bags
 each carrying a string `verdict`. Anything else reads as "no rowset".

## Parameters

### state

`Readonly`\<`Record`\<`string`, `unknown`\>\>

## Returns

[`VerdictRow`](/agentfootprint/api/generated/interfaces/VerdictRow.md)[]

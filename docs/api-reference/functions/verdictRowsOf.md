[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / verdictRowsOf

# Function: verdictRowsOf()

> **verdictRowsOf**(`state`): [`VerdictRow`](/agentfootprint/api/generated/interfaces/VerdictRow.md)[]

Defined in: [src/core/runbook/verdicts.ts:80](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/runbook/verdicts.ts#L80)

Read the rowset off the final state's `verdicts` key — an array of bags
 each carrying a string `verdict`. Anything else reads as "no rowset".

## Parameters

### state

`Readonly`\<`Record`\<`string`, `unknown`\>\>

## Returns

[`VerdictRow`](/agentfootprint/api/generated/interfaces/VerdictRow.md)[]

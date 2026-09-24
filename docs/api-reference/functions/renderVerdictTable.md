[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / renderVerdictTable

# Function: renderVerdictTable()

> **renderVerdictTable**(`rows`): `string`

Defined in: [src/core/runbook/verdicts.ts:109](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/runbook/verdicts.ts#L109)

Render the shown rows as one markdown table. Columns are the FIRST row's
own keys in declaration order — the chart writes its rows, so the chart
owns the column vocabulary; the bridge only renders it.

## Parameters

### rows

readonly [`VerdictRow`](/agentfootprint/api/generated/interfaces/VerdictRow.md)[]

## Returns

`string`

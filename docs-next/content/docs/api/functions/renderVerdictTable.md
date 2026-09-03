---
title: renderVerdictTable
---

# Function: renderVerdictTable()

> **renderVerdictTable**(`rows`): `string`

Defined in: [src/core/runbook/verdicts.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/verdicts.ts#L106)

Render the shown rows as one markdown table. Columns are the FIRST row's
own keys in declaration order — the chart writes its rows, so the chart
owns the column vocabulary; the bridge only renders it.

## Parameters

### rows

readonly [`VerdictRow`](/docs/api/interfaces/VerdictRow)[]

## Returns

`string`

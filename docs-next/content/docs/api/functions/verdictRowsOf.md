---
title: verdictRowsOf
---

# Function: verdictRowsOf()

> **verdictRowsOf**(`state`): [`VerdictRow`](/docs/api/interfaces/VerdictRow)[]

Defined in: src/core/runbook/verdicts.ts:80

Read the rowset off the final state's `verdicts` key — an array of bags
 each carrying a string `verdict`. Anything else reads as "no rowset".

## Parameters

### state

`Readonly`\<`Record`\<`string`, `unknown`\>\>

## Returns

[`VerdictRow`](/docs/api/interfaces/VerdictRow)[]

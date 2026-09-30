---
title: assertResultColumns
---

# Function: assertResultColumns()

> **assertResultColumns**(`toolName`, `columns`): `void`

Defined in: [src/integrity/column-types/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/column-types/types.ts#L138)

Refuse a `resultColumns` this library cannot honour, at definition time —
naming the tool, the column and the fix.

Exported beside [ColumnType](/docs/api/type-aliases/ColumnType) and called from `defineTool`, so a
misspelled type fails on the line that wrote it rather than at the first
rowset of the first armed run. Also called by the MCP ingest
(`readToolExtras`) on a bag from a server this process does not control —
which is why every read below goes through a fallback: a `null`, a number
or an array must reach the teaching refusal, never blow up on the way to
it.

## Parameters

### toolName

`string`

### columns

`unknown`

## Returns

`void`

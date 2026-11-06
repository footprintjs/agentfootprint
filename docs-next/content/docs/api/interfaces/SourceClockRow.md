---
title: SourceClockRow
---

# Interface: SourceClockRow

Defined in: [src/time/rows/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L219)

A wall-clock source (§ 9.6, step T8): the call minted a dataset whose
declared time axis (`axis.ts` · `DatasetTimeAxis`, its `zone`) says its rows are
wall times in `zone`. One row per call and zone. A period's offset is never
read as a clock — only a declared axis zone files this row.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L222)

***

### kind

> `readonly` **kind**: `"source-clock"`

Defined in: [src/time/rows/types.ts:220](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L220)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/time/rows/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L223)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/time/rows/types.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L224)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L221)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/rows/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L225)

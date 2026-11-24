---
title: SourceClockRow
---

# Interface: SourceClockRow

Defined in: [src/time/rows/types.ts:226](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L226)

A wall-clock source (§ 9.6, step T8): the call minted a dataset whose
declared time axis (`axis.ts` · `DatasetTimeAxis`, its `zone`) says its rows are
wall times in `zone`. One row per call and zone. A period's offset is never
read as a clock — only a declared axis zone files this row.

## Extends

- `TimeCallIdentity`

## Properties

### callOccurrenceKey?

> `readonly` `optional` **callOccurrenceKey?**: `CallOccurrenceKey`

Defined in: [src/time/rows/types.ts:44](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L44)

#### Inherited from

`TimeCallIdentity.callOccurrenceKey`

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L229)

***

### kind

> `readonly` **kind**: `"source-clock"`

Defined in: [src/time/rows/types.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L227)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/time/rows/types.ts:42](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L42)

#### Inherited from

`TimeCallIdentity.toolCallId`

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/time/rows/types.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L43)

#### Inherited from

`TimeCallIdentity.toolName`

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L228)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/rows/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L230)

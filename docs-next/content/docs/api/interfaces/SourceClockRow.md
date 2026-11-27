---
title: SourceClockRow
---

# Interface: SourceClockRow

Defined in: [src/time/rows/types.ts:256](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L256)

A wall-clock source (§ 9.6, step T8): the call minted a dataset whose
declared time axis (`axis.ts` · `DatasetTimeAxis`, its `zone`) says its rows are
wall times in `zone`. One row per call and zone. A period's offset is never
read as a clock — only a declared axis zone files this row.

## Extends

- `TimeCallIdentity`

## Properties

### callOccurrenceKey?

> `readonly` `optional` **callOccurrenceKey?**: `CallOccurrenceKey`

Defined in: [src/time/rows/types.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L49)

#### Inherited from

`TimeCallIdentity.callOccurrenceKey`

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:259](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L259)

***

### kind

> `readonly` **kind**: `"source-clock"`

Defined in: [src/time/rows/types.ts:257](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L257)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/time/rows/types.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L47)

#### Inherited from

`TimeCallIdentity.toolCallId`

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/time/rows/types.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L48)

#### Inherited from

`TimeCallIdentity.toolName`

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L258)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/rows/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L260)

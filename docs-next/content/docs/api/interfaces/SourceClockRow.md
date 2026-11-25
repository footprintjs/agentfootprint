---
title: SourceClockRow
---

# Interface: SourceClockRow

Defined in: [src/time/rows/types.ts:245](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L245)

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

Defined in: [src/time/rows/types.ts:248](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L248)

***

### kind

> `readonly` **kind**: `"source-clock"`

Defined in: [src/time/rows/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L246)

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

Defined in: [src/time/rows/types.ts:247](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L247)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/rows/types.ts:249](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L249)

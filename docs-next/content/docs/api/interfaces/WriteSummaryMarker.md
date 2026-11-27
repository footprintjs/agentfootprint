---
title: WriteSummaryMarker
---

# Interface: WriteSummaryMarker

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:54

Marker recorded in `StageSnapshot.stageWrites` (and the commit observer's
mutations payload) under `writeTracking: 'summary'` (#13c-A). Same fields
and cost contract as [ReadSummaryMarker](/docs/api/interfaces/ReadSummaryMarker); distinct brand so consumers
can tell which dial produced an entry.

## Extends

- `ValueSummary`

## Properties

### \_\_writeSummary

> **\_\_writeSummary**: `true`

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:56

Discriminant — lets snapshot consumers detect marker entries.

***

### preview?

> `optional` **preview?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:32

First SUMMARY\_PREVIEW\_LENGTH chars — primitives and strings only.

#### Inherited from

`ValueSummary.preview`

***

### size?

> `optional` **size?**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:30

Size proxy: string length, array length, or object key count.

#### Inherited from

`ValueSummary.size`

***

### type

> **type**: `SummaryValueType`

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:28

`typeof` result, refined to 'array' / 'null' for objects.

#### Inherited from

`ValueSummary.type`

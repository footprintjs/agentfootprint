---
title: ReadSummaryMarker
---

# Interface: ReadSummaryMarker

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:41

Marker recorded in `StageSnapshot.stageReads` under `readTracking: 'summary'`.

Honest cost note: `size` is a cheap proxy (string length / array length /
object key count), NOT a serialized byte count — computing real byte size
would require an O(value) serialization, which is exactly the cost the
summary mode removes. `preview` is only produced for primitives and strings
(first SUMMARY\_PREVIEW\_LENGTH characters); objects and arrays carry
no preview for the same reason.

## Extends

- `ValueSummary`

## Properties

### \_\_readSummary

> **\_\_readSummary**: `true`

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:43

Discriminant — lets snapshot consumers detect marker entries.

***

### preview?

> `optional` **preview?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:29

First SUMMARY\_PREVIEW\_LENGTH chars — primitives and strings only.

#### Inherited from

`ValueSummary.preview`

***

### size?

> `optional` **size?**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:27

Size proxy: string length, array length, or object key count.

#### Inherited from

`ValueSummary.size`

***

### type

> **type**: `SummaryValueType`

Defined in: node\_modules/footprintjs/dist/types/lib/capture/summarize.d.ts:25

`typeof` result, refined to 'array' / 'null' for objects.

#### Inherited from

`ValueSummary.type`

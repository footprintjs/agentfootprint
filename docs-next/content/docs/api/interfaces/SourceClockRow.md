---
title: SourceClockRow
---

# Interface: SourceClockRow

Defined in: src/core/time/rows.ts:256

A wall-clock source (§ 9.6, step T8): the call minted a dataset whose
declared time axis (`axis.ts` · `DatasetTimeAxis`, its `zone`) says its rows are
wall times in `zone`. One row per call and zone. A period's offset is never
read as a clock — only a declared axis zone files this row.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/time/rows.ts:259

***

### kind

> `readonly` **kind**: `"source-clock"`

Defined in: src/core/time/rows.ts:257

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: src/core/time/rows.ts:260

***

### toolName

> `readonly` **toolName**: `string`

Defined in: src/core/time/rows.ts:261

***

### turn

> `readonly` **turn**: `number`

Defined in: src/core/time/rows.ts:258

***

### zone

> `readonly` **zone**: `string`

Defined in: src/core/time/rows.ts:262

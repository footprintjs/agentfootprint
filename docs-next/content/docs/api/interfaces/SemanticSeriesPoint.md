---
title: SemanticSeriesPoint
---

# Interface: SemanticSeriesPoint

Defined in: src/lib/semantics/types.ts:55

One measured point. `t` is the tool's own clock words (an ISO string or an
epoch number — the library never reinterprets it), `entity` is what was
measured, `metric` names the measurement, `value` is the reading.

## Properties

### entity

> `readonly` **entity**: `string`

Defined in: src/lib/semantics/types.ts:57

***

### metric

> `readonly` **metric**: `string`

Defined in: src/lib/semantics/types.ts:58

***

### t

> `readonly` **t**: `string` \| `number`

Defined in: src/lib/semantics/types.ts:56

***

### value

> `readonly` **value**: `string` \| `number` \| `boolean` \| `null`

Defined in: src/lib/semantics/types.ts:59

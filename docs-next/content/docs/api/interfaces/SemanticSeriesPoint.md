---
title: SemanticSeriesPoint
---

# Interface: SemanticSeriesPoint

Defined in: [src/lib/semantics/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L55)

One measured point. `t` is the tool's own clock words (an ISO string or an
epoch number — the library never reinterprets it), `entity` is what was
measured, `metric` names the measurement, `value` is the reading.

## Properties

### entity

> `readonly` **entity**: `string`

Defined in: [src/lib/semantics/types.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L57)

***

### metric

> `readonly` **metric**: `string`

Defined in: [src/lib/semantics/types.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L58)

***

### t

> `readonly` **t**: `string` \| `number`

Defined in: [src/lib/semantics/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L56)

***

### value

> `readonly` **value**: `string` \| `number` \| `boolean` \| `null`

Defined in: [src/lib/semantics/types.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L59)

---
title: AllowOutcome<T>
---

# Interface: AllowOutcome\<T\>

Defined in: [src/core/agent/middleware/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L86)

Let the call through — optionally with a replacement for what the chain
carries forward.

`allow()` passes the value along untouched. `allow(value, why)` replaces
it and says why; the `why` is not decoration, it is the row the ledger
shows a person asking "who changed this, and what did it look like
before?".

## Type Parameters

### T

`T`

## Properties

### kind

> `readonly` **kind**: `"allow"`

Defined in: [src/core/agent/middleware/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L87)

***

### value?

> `readonly` `optional` **value?**: `T`

Defined in: [src/core/agent/middleware/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L89)

The replacement value. Absent = pass through unchanged.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/middleware/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L91)

Why the value changed. Present whenever `value` is.

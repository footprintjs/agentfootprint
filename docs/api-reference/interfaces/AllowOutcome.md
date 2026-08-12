[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AllowOutcome

# Interface: AllowOutcome\<T\>

Defined in: [src/core/agent/middleware/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/agent/middleware/types.ts#L85)

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

Defined in: [src/core/agent/middleware/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/agent/middleware/types.ts#L86)

***

### value?

> `readonly` `optional` **value?**: `T`

Defined in: [src/core/agent/middleware/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/agent/middleware/types.ts#L88)

The replacement value. Absent = pass through unchanged.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/middleware/types.ts:90](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/agent/middleware/types.ts#L90)

Why the value changed. Present whenever `value` is.

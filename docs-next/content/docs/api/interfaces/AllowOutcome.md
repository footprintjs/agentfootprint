---
title: AllowOutcome<T>
---

# Interface: AllowOutcome\<T\>

Defined in: [src/core/agent/middleware/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L88)

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

### from?

> `readonly` `optional` **from?**: `Readonly`\<`Record`\<`string`, `"person"` \| `"default"` \| `"app"`\>\>

Defined in: [src/core/agent/middleware/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L102)

WHERE the rewritten arguments' values came from, per argument name — the
middleware's own declaration (`allow(args, why, { from })`), recorded on
the decision row. Read by the answer's standing for an argument a tool's
`askOrAssume` rules (honesty layer 2): a rewrite with no declared origin,
or with `'default'`, reads as ASSUMED; `'person'` and `'app'` do not.
Declared, never inferred. Present only when the middleware declared it.

***

### kind

> `readonly` **kind**: `"allow"`

Defined in: [src/core/agent/middleware/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L89)

***

### value?

> `readonly` `optional` **value?**: `T`

Defined in: [src/core/agent/middleware/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L91)

The replacement value. Absent = pass through unchanged.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/middleware/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L93)

Why the value changed. Present whenever `value` is.

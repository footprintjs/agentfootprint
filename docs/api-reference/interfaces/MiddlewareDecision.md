[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MiddlewareDecision

# Interface: MiddlewareDecision

Defined in: src/core/agent/middleware/types.ts:192

One row per middleware decision, committed to `scope.middlewareDecisions`.

Every decision files a row, including the pass-throughs. A chain that
only recorded its refusals would leave you unable to tell "the middleware
looked and was fine with it" apart from "the middleware never ran" — and
those are different facts about a run.

## Properties

### after?

> `readonly` `optional` **after?**: `unknown`

Defined in: src/core/agent/middleware/types.ts:213

The value after this middleware. Present only when `changed`.

***

### at

> `readonly` **at**: `"tool"` \| `"message"`

Defined in: src/core/agent/middleware/types.ts:196

Which chain this row came from.

***

### before?

> `readonly` `optional` **before?**: `unknown`

Defined in: src/core/agent/middleware/types.ts:211

The value before this middleware. Present only when `changed`.

***

### changed

> `readonly` **changed**: `boolean`

Defined in: src/core/agent/middleware/types.ts:207

True when this row changed the value the chain carries forward.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/middleware/types.ts:204

ReAct iteration. `0` for the `'input'` phase, which runs before iter 1.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: src/core/agent/middleware/types.ts:194

The middleware's `name`.

***

### outcome

> `readonly` **outcome**: `"allow"` \| `"deny"` \| `"ask"`

Defined in: src/core/agent/middleware/types.ts:205

***

### phase?

> `readonly` `optional` **phase?**: `"input"` \| `"output"`

Defined in: src/core/agent/middleware/types.ts:198

Message chain only.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: src/core/agent/middleware/types.ts:202

Tool chain only.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: src/core/agent/middleware/types.ts:200

Tool chain only.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: src/core/agent/middleware/types.ts:209

The transform's `why`, the denial's `reason`, or the ask's `question`.

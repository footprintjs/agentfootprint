---
title: MiddlewareDecision
---

# Interface: MiddlewareDecision

Defined in: [src/core/agent/middleware/types.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L192)

One row per middleware decision, committed to `scope.middlewareDecisions`.

Every decision files a row, including the pass-throughs. A chain that
only recorded its refusals would leave you unable to tell "the middleware
looked and was fine with it" apart from "the middleware never ran" — and
those are different facts about a run.

## Properties

### after?

> `readonly` `optional` **after?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L213)

The value after this middleware. Present only when `changed`.

***

### at

> `readonly` **at**: `"tool"` \| `"message"`

Defined in: [src/core/agent/middleware/types.ts:196](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L196)

Which chain this row came from.

***

### before?

> `readonly` `optional` **before?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L211)

The value before this middleware. Present only when `changed`.

***

### changed

> `readonly` **changed**: `boolean`

Defined in: [src/core/agent/middleware/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L207)

True when this row changed the value the chain carries forward.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L204)

ReAct iteration. `0` for the `'input'` phase, which runs before iter 1.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: [src/core/agent/middleware/types.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L194)

The middleware's `name`.

***

### outcome

> `readonly` **outcome**: `"allow"` \| `"deny"` \| `"ask"`

Defined in: [src/core/agent/middleware/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L205)

***

### phase?

> `readonly` `optional` **phase?**: `"input"` \| `"output"`

Defined in: [src/core/agent/middleware/types.ts:198](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L198)

Message chain only.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/middleware/types.ts:202](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L202)

Tool chain only.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/middleware/types.ts:200](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L200)

Tool chain only.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/middleware/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L209)

The transform's `why`, the denial's `reason`, or the ask's `question`.

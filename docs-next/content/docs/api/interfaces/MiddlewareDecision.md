---
title: MiddlewareDecision
---

# Interface: MiddlewareDecision

Defined in: [src/core/agent/middleware/types.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L204)

One row per middleware decision, committed to `scope.middlewareDecisions`.

Every decision files a row, including the pass-throughs. A chain that
only recorded its refusals would leave you unable to tell "the middleware
looked and was fine with it" apart from "the middleware never ran" — and
those are different facts about a run.

## Properties

### after?

> `readonly` `optional` **after?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L225)

The value after this middleware. Present only when `changed`.

***

### at

> `readonly` **at**: `"tool"` \| `"message"`

Defined in: [src/core/agent/middleware/types.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L208)

Which chain this row came from.

***

### before?

> `readonly` `optional` **before?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L223)

The value before this middleware. Present only when `changed`.

***

### changed

> `readonly` **changed**: `boolean`

Defined in: [src/core/agent/middleware/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L219)

True when this row changed the value the chain carries forward.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L216)

ReAct iteration. `0` for the `'input'` phase, which runs before iter 1.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: [src/core/agent/middleware/types.ts:206](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L206)

The middleware's `name`.

***

### outcome

> `readonly` **outcome**: `"allow"` \| `"deny"` \| `"ask"`

Defined in: [src/core/agent/middleware/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L217)

***

### phase?

> `readonly` `optional` **phase?**: `"input"` \| `"output"`

Defined in: [src/core/agent/middleware/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L210)

Message chain only.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/middleware/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L214)

Tool chain only.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/middleware/types.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L212)

Tool chain only.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/middleware/types.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L221)

The transform's `why`, the denial's `reason`, or the ask's `question`.

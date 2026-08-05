---
title: ActOptions
---

# Interface: ActOptions

Defined in: [src/core/agent/act.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L45)

The whole steering wheel: one key per moment of the loop, each optional.

The declaration order below is the order the loop reaches them.

## Properties

### afterTool?

> `readonly` `optional` **afterTool?**: readonly [`ToolMiddleware`](/docs/api/type-aliases/ToolMiddleware)[]

Defined in: [src/core/agent/act.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L51)

Every tool result, after the tool ran and before the model reads it.

***

### beforeTool?

> `readonly` `optional` **beforeTool?**: readonly [`ToolMiddleware`](/docs/api/type-aliases/ToolMiddleware)[]

Defined in: [src/core/agent/act.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L49)

Every tool call, before it is dispatched.

***

### input?

> `readonly` `optional` **input?**: readonly [`MessageMiddleware`](/docs/api/interfaces/MessageMiddleware)[]

Defined in: [src/core/agent/act.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L47)

The user's message, before the run commits it.

***

### output?

> `readonly` `optional` **output?**: readonly [`MessageMiddleware`](/docs/api/interfaces/MessageMiddleware)[]

Defined in: [src/core/agent/act.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L55)

The final answer, before the caller receives it.

***

### window?

> `readonly` `optional` **window?**: [`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

Defined in: [src/core/agent/act.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L53)

What the live context window keeps, at each iteration boundary.

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

Defined in: [src/core/agent/act.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L52)

Every tool result, after the tool ran and before the model reads it.

***

### beforeTool?

> `readonly` `optional` **beforeTool?**: readonly [`ToolMiddleware`](/docs/api/type-aliases/ToolMiddleware)[]

Defined in: [src/core/agent/act.ts:50](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L50)

Every tool call, before it is dispatched.

***

### input?

> `readonly` `optional` **input?**: readonly [`MessageMiddleware`](/docs/api/interfaces/MessageMiddleware)[]

Defined in: [src/core/agent/act.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L48)

The user's message, before the run commits it. Input-only rules do not
 withhold provider draft streaming.

***

### output?

> `readonly` `optional` **output?**: readonly [`MessageMiddleware`](/docs/api/interfaces/MessageMiddleware)[]

Defined in: [src/core/agent/act.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L58)

The answer before final capture. A nonempty output chain withholds
 provider drafts and releases the captured answer once after acceptance;
 refusal stops delivery and final memory writes. Not audit erasure.

***

### window?

> `readonly` `optional` **window?**: [`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

Defined in: [src/core/agent/act.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/act.ts#L54)

What the live context window keeps, at each iteration boundary.

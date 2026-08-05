[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ActOptions

# Interface: ActOptions

Defined in: src/core/agent/act.ts:45

The whole steering wheel: one key per moment of the loop, each optional.

The declaration order below is the order the loop reaches them.

## Properties

### afterTool?

> `readonly` `optional` **afterTool?**: readonly [`ToolMiddleware`](/agentfootprint/api/generated/type-aliases/ToolMiddleware.md)[]

Defined in: src/core/agent/act.ts:51

Every tool result, after the tool ran and before the model reads it.

***

### beforeTool?

> `readonly` `optional` **beforeTool?**: readonly [`ToolMiddleware`](/agentfootprint/api/generated/type-aliases/ToolMiddleware.md)[]

Defined in: src/core/agent/act.ts:49

Every tool call, before it is dispatched.

***

### input?

> `readonly` `optional` **input?**: readonly [`MessageMiddleware`](/agentfootprint/api/generated/interfaces/MessageMiddleware.md)[]

Defined in: src/core/agent/act.ts:47

The user's message, before the run commits it.

***

### output?

> `readonly` `optional` **output?**: readonly [`MessageMiddleware`](/agentfootprint/api/generated/interfaces/MessageMiddleware.md)[]

Defined in: src/core/agent/act.ts:55

The final answer, before the caller receives it.

***

### window?

> `readonly` `optional` **window?**: [`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

Defined in: src/core/agent/act.ts:53

What the live context window keeps, at each iteration boundary.

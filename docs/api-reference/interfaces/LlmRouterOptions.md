[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LlmRouterOptions

# Interface: LlmRouterOptions

Defined in: [src/patterns/LlmRouter.ts:141](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/patterns/LlmRouter.ts#L141)

## Properties

### agents

> `readonly` **agents**: readonly [`RouterAgent`](/agentfootprint/api/generated/interfaces/RouterAgent.md)[]

Defined in: [src/patterns/LlmRouter.ts:147](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/patterns/LlmRouter.ts#L147)

The roster. Two or more agents; ids must be unique.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/patterns/LlmRouter.ts:161](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/patterns/LlmRouter.ts#L161)

Stable id used in events + stage ids. Default `'router'`.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/patterns/LlmRouter.ts:153](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/patterns/LlmRouter.ts#L153)

Extra authored framing, placed before the roster ("Prefer billing for
anything money-shaped"). Your words, trusted — unlike descriptions,
which ride as data.

***

### model

> `readonly` **model**: `string`

Defined in: [src/patterns/LlmRouter.ts:145](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/patterns/LlmRouter.ts#L145)

Model to ask.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/patterns/LlmRouter.ts:163](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/patterns/LlmRouter.ts#L163)

Display name. Default `'Router'`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/patterns/LlmRouter.ts:143](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/patterns/LlmRouter.ts#L143)

The LLM that makes the decision.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/patterns/LlmRouter.ts:159](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/patterns/LlmRouter.ts#L159)

Sampling temperature for the routing call. Defaults to `0` — routing
is a classification, and the same message should reach the same
specialist twice running.

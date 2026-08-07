[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LlmRouterOptions

# Interface: LlmRouterOptions

Defined in: [src/patterns/LlmRouter.ts:142](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/patterns/LlmRouter.ts#L142)

## Properties

### agents

> `readonly` **agents**: readonly [`RouterAgent`](/agentfootprint/api/generated/interfaces/RouterAgent.md)[]

Defined in: [src/patterns/LlmRouter.ts:148](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/patterns/LlmRouter.ts#L148)

The roster. Two or more agents; ids must be unique.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/patterns/LlmRouter.ts:162](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/patterns/LlmRouter.ts#L162)

Stable id used in events + stage ids. Default `'router'`.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/patterns/LlmRouter.ts:154](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/patterns/LlmRouter.ts#L154)

Extra authored framing, placed before the roster ("Prefer billing for
anything money-shaped"). Your words, trusted — unlike descriptions,
which ride as data.

***

### model

> `readonly` **model**: `string`

Defined in: [src/patterns/LlmRouter.ts:146](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/patterns/LlmRouter.ts#L146)

Model to ask.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/patterns/LlmRouter.ts:164](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/patterns/LlmRouter.ts#L164)

Display name. Default `'Router'`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/patterns/LlmRouter.ts:144](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/patterns/LlmRouter.ts#L144)

The LLM that makes the decision.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/patterns/LlmRouter.ts:160](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/patterns/LlmRouter.ts#L160)

Sampling temperature for the routing call. Defaults to `0` — routing
is a classification, and the same message should reach the same
specialist twice running.

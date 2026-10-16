---
title: LlmRouterOptions
---

# Interface: LlmRouterOptions

Defined in: [src/patterns/LlmRouter.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L144)

## Properties

### agents

> `readonly` **agents**: readonly [`RouterAgent`](/docs/api/interfaces/RouterAgent)[]

Defined in: [src/patterns/LlmRouter.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L150)

The roster. Two or more agents; ids must be unique.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/patterns/LlmRouter.ts:164](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L164)

Stable id used in events + stage ids. Default `'router'`.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/patterns/LlmRouter.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L156)

Extra authored framing, placed before the roster ("Prefer billing for
anything money-shaped"). Your words, trusted — unlike descriptions,
which ride as data.

***

### model

> `readonly` **model**: `string`

Defined in: [src/patterns/LlmRouter.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L148)

Model to ask.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/patterns/LlmRouter.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L166)

Display name. Default `'Router'`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/patterns/LlmRouter.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L146)

The LLM that makes the decision.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/patterns/LlmRouter.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L162)

Sampling temperature for the routing call. Defaults to `0` — routing
is a classification, and the same message should reach the same
specialist twice running.

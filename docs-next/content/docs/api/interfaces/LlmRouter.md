---
title: LlmRouter
---

# Interface: LlmRouter

Defined in: [src/patterns/LlmRouter.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L69)

A typed routing strategy with bounded observation-only history.

## Extends

- [`RoutingStrategy`](/docs/api/interfaces/RoutingStrategy)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/patterns/LlmRouter.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L70)

***

### step

> `readonly` **step**: [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, [`RoutingDecision`](/docs/api/interfaces/RoutingDecision)\>

Defined in: [src/patterns/LlmRouter.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L72)

#### Overrides

[`RoutingStrategy`](/docs/api/interfaces/RoutingStrategy).[`step`](/docs/api/interfaces/RoutingStrategy#step)

***

### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [src/patterns/LlmRouter.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L71)

## Methods

### decisionFor()

> **decisionFor**(`message`): [`RoutingDecision`](/docs/api/interfaces/RoutingDecision) \| `undefined`

Defined in: [src/patterns/LlmRouter.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L76)

Most recent observed decision for this text; not a run or invocation identity.

#### Parameters

##### message

`string`

#### Returns

[`RoutingDecision`](/docs/api/interfaces/RoutingDecision) \| `undefined`

***

### decisions()

> **decisions**(): readonly [`RoutingDecision`](/docs/api/interfaces/RoutingDecision)[]

Defined in: [src/patterns/LlmRouter.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L74)

Detached recent decisions, oldest first. Never consulted by dispatch.

#### Returns

readonly [`RoutingDecision`](/docs/api/interfaces/RoutingDecision)[]

[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LlmRouter

# Interface: LlmRouter

Defined in: [src/patterns/LlmRouter.ts:170](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/patterns/LlmRouter.ts#L170)

A packaged routing decision-maker. Hold one per swarm.

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/patterns/LlmRouter.ts:172](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/patterns/LlmRouter.ts#L172)

Stable id (also the `conditionalId` on its `route_decided` events).

***

### route

> `readonly` **route**: (`input`) => `string` \| `undefined`

Defined in: [src/patterns/LlmRouter.ts:191](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/patterns/LlmRouter.ts#L191)

The sync seam `swarm({ route })` wants. Returns the agent id decided
FOR THAT EXACT message, or `undefined` (which halts the swarm) when no
decision was recorded for it. Never calls an LLM, never guesses.
Pre-bound — pass it directly as `route`.

#### Parameters

##### input

###### message

`string`

#### Returns

`string` \| `undefined`

***

### step

> `readonly` **step**: [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/LlmRouter.ts:184](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/patterns/LlmRouter.ts#L184)

The runner that MAKES a decision: one LLM call, parsed and validated.
Returns the decision's `message`, so it drops into any chain that
passes text along. Pre-bound — safe to pass around.

***

### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [src/patterns/LlmRouter.ts:178](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/patterns/LlmRouter.ts#L178)

The compiled system prompt — the authored frame with the roster
encoded inside it. Byte-stable for the same options, so you can diff
it in a test or paste it in a bug report.

## Methods

### decisionFor()

> **decisionFor**(`message`): [`RoutingDecision`](/agentfootprint/api/generated/interfaces/RoutingDecision.md) \| `undefined`

Defined in: [src/patterns/LlmRouter.ts:195](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/patterns/LlmRouter.ts#L195)

The decision recorded for a message, if there is one.

#### Parameters

##### message

`string`

#### Returns

[`RoutingDecision`](/agentfootprint/api/generated/interfaces/RoutingDecision.md) \| `undefined`

***

### decisions()

> **decisions**(): readonly [`RoutingDecision`](/agentfootprint/api/generated/interfaces/RoutingDecision.md)[]

Defined in: [src/patterns/LlmRouter.ts:193](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/patterns/LlmRouter.ts#L193)

Every decision this router has made, oldest first (recent window).

#### Returns

readonly [`RoutingDecision`](/agentfootprint/api/generated/interfaces/RoutingDecision.md)[]

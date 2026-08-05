[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LlmRouter

# Interface: LlmRouter

Defined in: [src/patterns/LlmRouter.ts:169](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/patterns/LlmRouter.ts#L169)

A packaged routing decision-maker. Hold one per swarm.

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/patterns/LlmRouter.ts:171](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/patterns/LlmRouter.ts#L171)

Stable id (also the `conditionalId` on its `route_decided` events).

***

### route

> `readonly` **route**: (`input`) => `string` \| `undefined`

Defined in: [src/patterns/LlmRouter.ts:190](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/patterns/LlmRouter.ts#L190)

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

Defined in: [src/patterns/LlmRouter.ts:183](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/patterns/LlmRouter.ts#L183)

The runner that MAKES a decision: one LLM call, parsed and validated.
Returns the decision's `message`, so it drops into any chain that
passes text along. Pre-bound — safe to pass around.

***

### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [src/patterns/LlmRouter.ts:177](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/patterns/LlmRouter.ts#L177)

The compiled system prompt — the authored frame with the roster
encoded inside it. Byte-stable for the same options, so you can diff
it in a test or paste it in a bug report.

## Methods

### decisionFor()

> **decisionFor**(`message`): [`RoutingDecision`](/agentfootprint/api/generated/interfaces/RoutingDecision.md) \| `undefined`

Defined in: [src/patterns/LlmRouter.ts:194](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/patterns/LlmRouter.ts#L194)

The decision recorded for a message, if there is one.

#### Parameters

##### message

`string`

#### Returns

[`RoutingDecision`](/agentfootprint/api/generated/interfaces/RoutingDecision.md) \| `undefined`

***

### decisions()

> **decisions**(): readonly [`RoutingDecision`](/agentfootprint/api/generated/interfaces/RoutingDecision.md)[]

Defined in: [src/patterns/LlmRouter.ts:192](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/patterns/LlmRouter.ts#L192)

Every decision this router has made, oldest first (recent window).

#### Returns

readonly [`RoutingDecision`](/agentfootprint/api/generated/interfaces/RoutingDecision.md)[]

---
title: AroundTurn
---

# Interface: AroundTurn

Defined in: [src/core/agent/aroundTurn/types.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L65)

Work that must wrap a whole turn: awaited preparation before it, an
`AsyncLocalStorage` held around it, cleanup after it. Declared with
`.aroundTurn()` on the builder.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/aroundTurn/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L67)

Named on every refusal and on `agentfootprint.agent.around_turn_failed`.

## Methods

### around()

> **around**(`turn`, `proceed`): `void` \| `Promise`\<`void`\>

Defined in: [src/core/agent/aroundTurn/types.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L69)

Do the work and call `proceed` once. Its return value is ignored.

#### Parameters

##### turn

[`AgentTurn`](/docs/api/type-aliases/AgentTurn)

##### proceed

[`ProceedWithTurn`](/docs/api/type-aliases/ProceedWithTurn)

#### Returns

`void` \| `Promise`\<`void`\>

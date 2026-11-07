---
title: AroundTurn
---

# Interface: AroundTurn

Defined in: [src/core/agent/aroundTurn/types.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L59)

Work that must wrap a whole turn: awaited preparation before it, an
`AsyncLocalStorage` held around it, cleanup after it. Declared with
`.aroundTurn()` on the builder.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/aroundTurn/types.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L61)

Named on every refusal and on `agentfootprint.agent.around_turn_failed`.

## Methods

### around()

> **around**(`turn`, `proceed`): `void` \| `Promise`\<`void`\>

Defined in: [src/core/agent/aroundTurn/types.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L63)

Do the work and call `proceed` once. Its return value is ignored.

#### Parameters

##### turn

[`AgentTurn`](/docs/api/type-aliases/AgentTurn)

##### proceed

[`ProceedWithTurn`](/docs/api/type-aliases/ProceedWithTurn)

#### Returns

`void` \| `Promise`\<`void`\>

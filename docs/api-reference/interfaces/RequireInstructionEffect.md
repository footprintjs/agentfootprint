[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RequireInstructionEffect

# Interface: RequireInstructionEffect

Defined in: [src/core/agent/toolEffects.ts:83](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/toolEffects.ts#L83)

A tool pushes a registered instruction into the coming iteration(s).

## Properties

### deliveryLease

> `readonly` **deliveryLease**: [`InstructionDeliveryLease`](/agentfootprint/api/generated/type-aliases/InstructionDeliveryLease.md)

Defined in: [src/core/agent/toolEffects.ts:91](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/toolEffects.ts#L91)

`'next-call'` — exactly the next LLM call; `'until-skill-exit'` — every
 call while the tenure that granted it holds (the skill the cursor was
 on when the tool returned).

***

### instructionId

> `readonly` **instructionId**: `string`

Defined in: [src/core/agent/toolEffects.ts:87](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/toolEffects.ts#L87)

A REGISTERED injection id (a skill or an instruction). Unknown ids are
 refused teachingly — the push door serves the declared catalog only.

***

### kind

> `readonly` **kind**: `"require-instruction"`

Defined in: [src/core/agent/toolEffects.ts:84](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/toolEffects.ts#L84)

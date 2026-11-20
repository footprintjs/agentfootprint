---
title: RequireInstructionEffect
---

# Interface: RequireInstructionEffect

Defined in: [src/semantics/toolEffects.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L87)

A tool pushes a registered instruction into the coming iteration(s).

## Properties

### deliveryLease

> `readonly` **deliveryLease**: [`InstructionDeliveryLease`](/docs/api/type-aliases/InstructionDeliveryLease)

Defined in: [src/semantics/toolEffects.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L95)

`'next-call'` — exactly the next LLM call; `'until-skill-exit'` — every
 call while the tenure that granted it holds (the skill the cursor was
 on when the tool returned).

***

### instructionId

> `readonly` **instructionId**: `string`

Defined in: [src/semantics/toolEffects.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L91)

A REGISTERED injection id (a skill or an instruction). Unknown ids are
 refused teachingly — the push door serves the declared catalog only.

***

### kind

> `readonly` **kind**: `"require-instruction"`

Defined in: [src/semantics/toolEffects.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L88)

---
title: ReadToolResultEnvelope
---

# Interface: ReadToolResultEnvelope

Defined in: [src/semantics/toolEffects.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L127)

A recognized envelope, read: content unwrapped, VALID effects listed,
 malformed ones named (one teaching entry per bad effect).

## Properties

### content

> `readonly` **content**: `unknown`

Defined in: [src/semantics/toolEffects.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L128)

***

### effects

> `readonly` **effects**: readonly [`ProposedEffect`](/docs/api/type-aliases/ProposedEffect)[]

Defined in: [src/semantics/toolEffects.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L129)

***

### malformed

> `readonly` **malformed**: readonly `object`[]

Defined in: [src/semantics/toolEffects.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L133)

Effects that carried a known `kind` with malformed fields — refused
 loudly (recorded + a teaching sentence), never half-applied.

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/docs/api/type-aliases/ToolResultStatus)

Defined in: [src/semantics/toolEffects.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L130)

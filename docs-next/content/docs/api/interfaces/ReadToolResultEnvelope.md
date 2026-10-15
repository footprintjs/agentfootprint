---
title: ReadToolResultEnvelope
---

# Interface: ReadToolResultEnvelope

Defined in: [src/semantics/toolEffects.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L124)

A recognized envelope, read: content unwrapped, VALID effects listed,
 malformed ones named (one teaching entry per bad effect).

## Properties

### content

> `readonly` **content**: `unknown`

Defined in: [src/semantics/toolEffects.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L125)

***

### effects

> `readonly` **effects**: readonly [`ProposedEffect`](/docs/api/type-aliases/ProposedEffect)[]

Defined in: [src/semantics/toolEffects.ts:126](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L126)

***

### malformed

> `readonly` **malformed**: readonly `object`[]

Defined in: [src/semantics/toolEffects.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L130)

Effects that carried a known `kind` with malformed fields — refused
 loudly (recorded + a teaching sentence), never half-applied.

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/docs/api/type-aliases/ToolResultStatus)

Defined in: [src/semantics/toolEffects.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L127)

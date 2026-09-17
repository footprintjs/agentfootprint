---
title: ReadToolResultEnvelope
---

# Interface: ReadToolResultEnvelope

Defined in: [src/core/agent/toolEffects.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolEffects.ts#L123)

A recognized envelope, read: content unwrapped, VALID effects listed,
 malformed ones named (one teaching entry per bad effect).

## Properties

### content

> `readonly` **content**: `unknown`

Defined in: [src/core/agent/toolEffects.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolEffects.ts#L124)

***

### effects

> `readonly` **effects**: readonly [`ProposedEffect`](/docs/api/type-aliases/ProposedEffect)[]

Defined in: [src/core/agent/toolEffects.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolEffects.ts#L125)

***

### malformed

> `readonly` **malformed**: readonly `object`[]

Defined in: [src/core/agent/toolEffects.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolEffects.ts#L129)

Effects that carried a known `kind` with malformed fields — refused
 loudly (recorded + a teaching sentence), never half-applied.

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/docs/api/type-aliases/ToolResultStatus)

Defined in: [src/core/agent/toolEffects.ts:126](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolEffects.ts#L126)

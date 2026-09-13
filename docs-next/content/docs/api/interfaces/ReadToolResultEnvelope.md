---
title: ReadToolResultEnvelope
---

# Interface: ReadToolResultEnvelope

Defined in: src/core/agent/toolEffects.ts:123

A recognized envelope, read: content unwrapped, VALID effects listed,
 malformed ones named (one teaching entry per bad effect).

## Properties

### content

> `readonly` **content**: `unknown`

Defined in: src/core/agent/toolEffects.ts:124

***

### effects

> `readonly` **effects**: readonly [`ProposedEffect`](/docs/api/type-aliases/ProposedEffect)[]

Defined in: src/core/agent/toolEffects.ts:125

***

### malformed

> `readonly` **malformed**: readonly `object`[]

Defined in: src/core/agent/toolEffects.ts:129

Effects that carried a known `kind` with malformed fields — refused
 loudly (recorded + a teaching sentence), never half-applied.

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/docs/api/type-aliases/ToolResultStatus)

Defined in: src/core/agent/toolEffects.ts:126

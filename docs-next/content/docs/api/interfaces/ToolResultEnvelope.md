---
title: ToolResultEnvelope
---

# Interface: ToolResultEnvelope

Defined in: [src/semantics/toolEffects.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L114)

What a tool handler returns to opt into the channel:
`{ content, effects, status? }`. `content` is what the model reads (any
value — strings pass through, objects stringify exactly as a bare return
would). Returning anything else keeps today's path, byte for byte.

`effects` is REQUIRED — it is the envelope marker itself. The recognizer
refuses to treat a value without an `effects` array as an envelope (that
strictness IS the zero-cost guarantee: `{ content, status: 'success' }`
is a shape a domain object could already have), so the type says exactly
what the recognizer accepts. Status-only is spelled `effects: []` — the
explicit marker when only `status` matters.

## Properties

### content

> `readonly` **content**: `unknown`

Defined in: [src/semantics/toolEffects.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L115)

***

### effects

> `readonly` **effects**: readonly [`ProposedEffect`](/docs/api/type-aliases/ProposedEffect)[]

Defined in: [src/semantics/toolEffects.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L116)

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/docs/api/type-aliases/ToolResultStatus)

Defined in: [src/semantics/toolEffects.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L117)

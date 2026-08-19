[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolResultEnvelope

# Interface: ToolResultEnvelope

Defined in: [src/core/agent/toolEffects.ts:110](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/toolEffects.ts#L110)

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

Defined in: [src/core/agent/toolEffects.ts:111](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/toolEffects.ts#L111)

***

### effects

> `readonly` **effects**: readonly [`ProposedEffect`](/agentfootprint/api/generated/type-aliases/ProposedEffect.md)[]

Defined in: [src/core/agent/toolEffects.ts:112](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/toolEffects.ts#L112)

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/agentfootprint/api/generated/type-aliases/ToolResultStatus.md)

Defined in: [src/core/agent/toolEffects.ts:113](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/toolEffects.ts#L113)

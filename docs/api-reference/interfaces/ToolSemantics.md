[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolSemantics

# Interface: ToolSemantics

Defined in: [src/lib/semantics/types.ts:195](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L195)

The rendered semantic envelope — the exact object a tool hands back.
Field names are snake_case and English on purpose (the `ToolAbsence`
precedent): this value is read by a language model far more often than by
code, and `af_semantics` is the only field that exists for the machine.

## Properties

### af\_semantics

> `readonly` **af\_semantics**: `true`

Defined in: [src/lib/semantics/types.ts:196](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L196)

***

### clarify?

> `readonly` `optional` **clarify?**: [`SemanticClarify`](/agentfootprint/api/generated/interfaces/SemanticClarify.md) \| `null`

Defined in: [src/lib/semantics/types.ts:206](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L206)

***

### coverage?

> `readonly` `optional` **coverage?**: [`SemanticCoverage`](/agentfootprint/api/generated/interfaces/SemanticCoverage.md)

Defined in: [src/lib/semantics/types.ts:202](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L202)

***

### edges?

> `readonly` `optional` **edges?**: readonly [`SemanticEdge`](/agentfootprint/api/generated/interfaces/SemanticEdge.md)[]

Defined in: [src/lib/semantics/types.ts:199](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L199)

***

### facts?

> `readonly` `optional` **facts?**: readonly [`SemanticFact`](/agentfootprint/api/generated/interfaces/SemanticFact.md)[]

Defined in: [src/lib/semantics/types.ts:198](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L198)

***

### grain?

> `readonly` `optional` **grain?**: [`SemanticGrain`](/agentfootprint/api/generated/interfaces/SemanticGrain.md)

Defined in: [src/lib/semantics/types.ts:200](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L200)

***

### not\_covered?

> `readonly` `optional` **not\_covered?**: readonly `string`[]

Defined in: [src/lib/semantics/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L205)

DERIVED from `coverage` (not checked + cannot cover), one prose line
 per item — never author-set, so the list and the lists cannot drift.

***

### note

> `readonly` **note**: `string`

Defined in: [src/lib/semantics/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L209)

The static sentence. Never interpolated — see `envelope.ts`.

***

### provenance?

> `readonly` `optional` **provenance?**: [`SemanticProvenance`](/agentfootprint/api/generated/interfaces/SemanticProvenance.md)

Defined in: [src/lib/semantics/types.ts:201](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L201)

***

### render?

> `readonly` `optional` **render?**: [`SemanticRender`](/agentfootprint/api/generated/interfaces/SemanticRender.md)

Defined in: [src/lib/semantics/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L207)

***

### series?

> `readonly` `optional` **series?**: readonly [`SemanticSeriesPoint`](/agentfootprint/api/generated/interfaces/SemanticSeriesPoint.md)[]

Defined in: [src/lib/semantics/types.ts:197](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L197)

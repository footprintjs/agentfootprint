[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SemanticDeclaration

# Interface: SemanticDeclaration

Defined in: [src/lib/semantics/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L175)

What a tool author passes to `semantic()`. At least one of `series`,
`facts`, `edges` or a non-null `clarify` must be present — an envelope
with no data and no question declares nothing.

`not_covered` is deliberately NOT here: the prose list on the rendered
envelope is DERIVED from `coverage` (not checked + cannot cover), so the
two can never disagree. Declaring coverage is how not_covered is said.

## Properties

### clarify?

> `readonly` `optional` **clarify?**: [`SemanticClarify`](/agentfootprint/api/generated/interfaces/SemanticClarify.md) \| `null`

Defined in: [src/lib/semantics/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L185)

`null` states "ambiguity was considered; there is none" — a fact, kept
 on the record. Omit the field to say nothing.

***

### coverage?

> `readonly` `optional` **coverage?**: [`CoverageDeclaration`](/agentfootprint/api/generated/interfaces/CoverageDeclaration.md)

Defined in: [src/lib/semantics/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L182)

The coverage()-vocabulary declaration this envelope absorbs.

***

### edges?

> `readonly` `optional` **edges?**: readonly [`SemanticEdge`](/agentfootprint/api/generated/interfaces/SemanticEdge.md)[]

Defined in: [src/lib/semantics/types.ts:178](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L178)

***

### facts?

> `readonly` `optional` **facts?**: readonly [`SemanticFact`](/agentfootprint/api/generated/interfaces/SemanticFact.md)[]

Defined in: [src/lib/semantics/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L177)

***

### grain?

> `readonly` `optional` **grain?**: [`SemanticGrain`](/agentfootprint/api/generated/interfaces/SemanticGrain.md)

Defined in: [src/lib/semantics/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L179)

***

### provenance?

> `readonly` `optional` **provenance?**: [`SemanticProvenance`](/agentfootprint/api/generated/interfaces/SemanticProvenance.md)

Defined in: [src/lib/semantics/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L180)

***

### render?

> `readonly` `optional` **render?**: [`SemanticRender`](/agentfootprint/api/generated/interfaces/SemanticRender.md)

Defined in: [src/lib/semantics/types.ts:186](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L186)

***

### series?

> `readonly` `optional` **series?**: readonly [`SemanticSeriesPoint`](/agentfootprint/api/generated/interfaces/SemanticSeriesPoint.md)[]

Defined in: [src/lib/semantics/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L176)

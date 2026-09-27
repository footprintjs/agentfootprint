---
title: SemanticDeclaration
---

# Interface: SemanticDeclaration

Defined in: [src/lib/semantics/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L177)

What a tool author passes to `semantic()` — the deprecated name; new code
passes a [DescribedResultDeclaration](/docs/api/type-aliases/DescribedResultDeclaration) to `describedResult()`, which
mints the same envelope from camelCase names. At least one of `series`,
`facts`, `edges` or a non-null `clarify` must be present — an envelope
with no data and no question declares nothing.

`not_covered` is deliberately NOT here: the prose list on the rendered
envelope is DERIVED from `coverage` (not checked + cannot cover), so the
two can never disagree. Declaring coverage is how not_covered is said.

## Properties

### clarify?

> `readonly` `optional` **clarify?**: [`SemanticClarify`](/docs/api/interfaces/SemanticClarify) \| `null`

Defined in: [src/lib/semantics/types.ts:187](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L187)

`null` states "ambiguity was considered; there is none" — a fact, kept
 on the record. Omit the field to say nothing.

***

### coverage?

> `readonly` `optional` **coverage?**: [`CoverageDeclaration`](/docs/api/interfaces/CoverageDeclaration)

Defined in: [src/lib/semantics/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L184)

The coverage()-vocabulary declaration this envelope absorbs.

***

### edges?

> `readonly` `optional` **edges?**: readonly [`SemanticEdge`](/docs/api/interfaces/SemanticEdge)[]

Defined in: [src/lib/semantics/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L180)

***

### facts?

> `readonly` `optional` **facts?**: readonly [`SemanticFact`](/docs/api/interfaces/SemanticFact)[]

Defined in: [src/lib/semantics/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L179)

***

### grain?

> `readonly` `optional` **grain?**: [`SemanticGrain`](/docs/api/interfaces/SemanticGrain)

Defined in: [src/lib/semantics/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L181)

***

### provenance?

> `readonly` `optional` **provenance?**: [`SemanticProvenance`](/docs/api/interfaces/SemanticProvenance)

Defined in: [src/lib/semantics/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L182)

***

### render?

> `readonly` `optional` **render?**: [`SemanticRender`](/docs/api/interfaces/SemanticRender)

Defined in: [src/lib/semantics/types.ts:188](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L188)

***

### series?

> `readonly` `optional` **series?**: readonly [`SemanticSeriesPoint`](/docs/api/interfaces/SemanticSeriesPoint)[]

Defined in: [src/lib/semantics/types.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L178)

---
title: ToolSemantics
---

# Interface: ToolSemantics

Defined in: [src/semantics/types.ts:304](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L304)

The rendered semantic envelope — the exact object a tool hands back.
Field names are snake_case and English on purpose (the `ToolAbsence`
precedent): this value is read by a language model far more often than by
code, and `af_semantics` is the only field that exists for the machine.

## Properties

### af\_semantics

> `readonly` **af\_semantics**: `true`

Defined in: [src/semantics/types.ts:305](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L305)

***

### clarify?

> `readonly` `optional` **clarify?**: [`SemanticClarify`](/docs/api/interfaces/SemanticClarify) \| `null`

Defined in: [src/semantics/types.ts:322](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L322)

***

### coverage?

> `readonly` `optional` **coverage?**: [`SemanticCoverage`](/docs/api/interfaces/SemanticCoverage)

Defined in: [src/semantics/types.ts:318](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L318)

***

### edges?

> `readonly` `optional` **edges?**: readonly [`SemanticEdge`](/docs/api/interfaces/SemanticEdge)[]

Defined in: [src/semantics/types.ts:308](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L308)

***

### facts?

> `readonly` `optional` **facts?**: readonly [`SemanticFact`](/docs/api/interfaces/SemanticFact)[]

Defined in: [src/semantics/types.ts:307](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L307)

***

### grain?

> `readonly` `optional` **grain?**: [`SemanticGrain`](/docs/api/interfaces/SemanticGrain)

Defined in: [src/semantics/types.ts:309](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L309)

***

### not\_covered?

> `readonly` `optional` **not\_covered?**: readonly `string`[]

Defined in: [src/semantics/types.ts:321](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L321)

DERIVED from `coverage` (not checked + cannot cover), one prose line
 per item — never author-set, so the list and the lists cannot drift.

***

### note

> `readonly` **note**: `string`

Defined in: [src/semantics/types.ts:325](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L325)

The static sentence. Never interpolated — see `envelope.ts`.

***

### paging?

> `readonly` `optional` **paging?**: `PagingDeclaration`

Defined in: [src/semantics/types.ts:317](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L317)

Whether there is a next page, as declared.

***

### period?

> `readonly` `optional` **period?**: `object`

Defined in: [src/semantics/types.ts:313](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L313)

What the read behind the data covered in time — honesty step 7b; minted
 only by `describedResult()`. The model reads it as declared.

#### held

> `readonly` **held**: `"unknown"` \| \{ `from`: `string`; `to`: `string`; \}

#### queried

> `readonly` **queried**: `object`

##### queried.from

> `readonly` **from**: `string`

##### queried.to

> `readonly` **to**: `string`

#### read\_at?

> `readonly` `optional` **read\_at?**: `string`

***

### provenance?

> `readonly` `optional` **provenance?**: [`SemanticProvenance`](/docs/api/interfaces/SemanticProvenance)

Defined in: [src/semantics/types.ts:310](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L310)

***

### render?

> `readonly` `optional` **render?**: [`SemanticRender`](/docs/api/interfaces/SemanticRender)

Defined in: [src/semantics/types.ts:323](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L323)

***

### resolved?

> `readonly` `optional` **resolved?**: readonly `ResolvedDeclaration`[]

Defined in: [src/semantics/types.ts:315](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L315)

The entity each population value resolved to, as declared.

***

### series?

> `readonly` `optional` **series?**: readonly [`SemanticSeriesPoint`](/docs/api/interfaces/SemanticSeriesPoint)[]

Defined in: [src/semantics/types.ts:306](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/types.ts#L306)

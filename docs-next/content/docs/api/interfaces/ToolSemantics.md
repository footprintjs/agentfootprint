---
title: ToolSemantics
---

# Interface: ToolSemantics

Defined in: [src/lib/semantics/types.ts:324](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L324)

The rendered semantic envelope — the exact object a tool hands back.
Field names are snake_case and English on purpose (the `ToolAbsence`
precedent): this value is read by a language model far more often than by
code, and `af_semantics` is the only field that exists for the machine.

## Properties

### af\_semantics

> `readonly` **af\_semantics**: `true`

Defined in: [src/lib/semantics/types.ts:325](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L325)

***

### clarify?

> `readonly` `optional` **clarify?**: [`SemanticClarify`](/docs/api/interfaces/SemanticClarify) \| `null`

Defined in: [src/lib/semantics/types.ts:338](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L338)

***

### coverage?

> `readonly` `optional` **coverage?**: [`SemanticCoverage`](/docs/api/interfaces/SemanticCoverage)

Defined in: [src/lib/semantics/types.ts:334](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L334)

***

### edges?

> `readonly` `optional` **edges?**: readonly [`SemanticEdge`](/docs/api/interfaces/SemanticEdge)[]

Defined in: [src/lib/semantics/types.ts:328](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L328)

***

### facts?

> `readonly` `optional` **facts?**: readonly [`SemanticFact`](/docs/api/interfaces/SemanticFact)[]

Defined in: [src/lib/semantics/types.ts:327](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L327)

***

### grain?

> `readonly` `optional` **grain?**: [`SemanticGrain`](/docs/api/interfaces/SemanticGrain)

Defined in: [src/lib/semantics/types.ts:329](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L329)

***

### not\_covered?

> `readonly` `optional` **not\_covered?**: readonly `string`[]

Defined in: [src/lib/semantics/types.ts:337](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L337)

DERIVED from `coverage` (not checked + cannot cover), one prose line
 per item — never author-set, so the list and the lists cannot drift.

***

### note

> `readonly` **note**: `string`

Defined in: [src/lib/semantics/types.ts:341](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L341)

The static sentence. Never interpolated — see `envelope.ts`.

***

### period?

> `readonly` `optional` **period?**: `object`

Defined in: [src/lib/semantics/types.ts:333](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L333)

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

Defined in: [src/lib/semantics/types.ts:330](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L330)

***

### render?

> `readonly` `optional` **render?**: [`SemanticRender`](/docs/api/interfaces/SemanticRender)

Defined in: [src/lib/semantics/types.ts:339](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L339)

***

### series?

> `readonly` `optional` **series?**: readonly [`SemanticSeriesPoint`](/docs/api/interfaces/SemanticSeriesPoint)[]

Defined in: [src/lib/semantics/types.ts:326](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L326)

---
title: ToolSemantics
---

# Interface: ToolSemantics

Defined in: [src/lib/semantics/types.ts:315](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L315)

The rendered semantic envelope — the exact object a tool hands back.
Field names are snake_case and English on purpose (the `ToolAbsence`
precedent): this value is read by a language model far more often than by
code, and `af_semantics` is the only field that exists for the machine.

## Properties

### af\_semantics

> `readonly` **af\_semantics**: `true`

Defined in: [src/lib/semantics/types.ts:316](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L316)

***

### clarify?

> `readonly` `optional` **clarify?**: [`SemanticClarify`](/docs/api/interfaces/SemanticClarify) \| `null`

Defined in: [src/lib/semantics/types.ts:326](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L326)

***

### coverage?

> `readonly` `optional` **coverage?**: [`SemanticCoverage`](/docs/api/interfaces/SemanticCoverage)

Defined in: [src/lib/semantics/types.ts:322](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L322)

***

### edges?

> `readonly` `optional` **edges?**: readonly [`SemanticEdge`](/docs/api/interfaces/SemanticEdge)[]

Defined in: [src/lib/semantics/types.ts:319](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L319)

***

### facts?

> `readonly` `optional` **facts?**: readonly [`SemanticFact`](/docs/api/interfaces/SemanticFact)[]

Defined in: [src/lib/semantics/types.ts:318](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L318)

***

### grain?

> `readonly` `optional` **grain?**: [`SemanticGrain`](/docs/api/interfaces/SemanticGrain)

Defined in: [src/lib/semantics/types.ts:320](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L320)

***

### not\_covered?

> `readonly` `optional` **not\_covered?**: readonly `string`[]

Defined in: [src/lib/semantics/types.ts:325](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L325)

DERIVED from `coverage` (not checked + cannot cover), one prose line
 per item — never author-set, so the list and the lists cannot drift.

***

### note

> `readonly` **note**: `string`

Defined in: [src/lib/semantics/types.ts:329](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L329)

The static sentence. Never interpolated — see `envelope.ts`.

***

### provenance?

> `readonly` `optional` **provenance?**: [`SemanticProvenance`](/docs/api/interfaces/SemanticProvenance)

Defined in: [src/lib/semantics/types.ts:321](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L321)

***

### render?

> `readonly` `optional` **render?**: [`SemanticRender`](/docs/api/interfaces/SemanticRender)

Defined in: [src/lib/semantics/types.ts:327](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L327)

***

### series?

> `readonly` `optional` **series?**: readonly [`SemanticSeriesPoint`](/docs/api/interfaces/SemanticSeriesPoint)[]

Defined in: [src/lib/semantics/types.ts:317](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L317)

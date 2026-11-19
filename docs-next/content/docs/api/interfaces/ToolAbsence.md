---
title: ToolAbsence
---

# Interface: ToolAbsence

Defined in: [src/semantics/coverage/types.ts:392](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L392)

The rendered absence — the exact object a tool hands back and the model
reads. Field names are snake_case and English on purpose: this value is
read by a language model far more often than by code, and `af_absent` is
the only field here that exists for the machine.

The `af_absent` key is RESERVED vocabulary on the tool-result wire (the
`propose-transition` / `require-instruction` precedent): a plain object
carrying it is an absence, and nothing else in this library will treat any
other shape as one.

## Properties

### af\_absent

> `readonly` **af\_absent**: `true`

Defined in: [src/semantics/coverage/types.ts:393](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L393)

***

### cannot\_cover?

> `readonly` `optional` **cannot\_cover?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/semantics/coverage/types.ts:400](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L400)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/semantics/coverage/types.ts:398](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L398)

***

### looked\_for

> `readonly` **looked\_for**: `string`

Defined in: [src/semantics/coverage/types.ts:397](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L397)

***

### not\_checked?

> `readonly` `optional` **not\_checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/semantics/coverage/types.ts:399](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L399)

***

### note

> `readonly` **note**: `string`

Defined in: [src/semantics/coverage/types.ts:421](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L421)

The static sentence. Never interpolated — see `absent.ts`.

***

### outcome

> `readonly` **outcome**: `"nothing_found"`

Defined in: [src/semantics/coverage/types.ts:396](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L396)

The plain-English handle. Present so a model that skims one key still
 reads the outcome rather than inferring it from a missing field.

***

### paging?

> `readonly` `optional` **paging?**: `PagingDeclaration`

Defined in: [src/semantics/coverage/types.ts:419](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L419)

Whether there is a next page, as declared.

***

### period?

> `readonly` `optional` **period?**: `object`

Defined in: [src/semantics/coverage/types.ts:415](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L415)

What the search's read covered in time — `queried`, `held` (or
 `'unknown'`), `read_at` — honesty step 7b.

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

Defined in: [src/semantics/coverage/types.ts:412](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L412)

Where the search looked and when that source was measured — the wire
 `describedResult()` mints (`measured_at`, `source`, …), honesty step 7b.

***

### resolved?

> `readonly` `optional` **resolved?**: readonly `ResolvedDeclaration`[]

Defined in: [src/semantics/coverage/types.ts:417](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L417)

The entity each population value resolved to, as declared.

***

### retry\_returns\_the\_same

> `readonly` **retry\_returns\_the\_same**: `true`

Defined in: [src/semantics/coverage/types.ts:403](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L403)

Stated as data as well as prose — the note can be skimmed past, a
 `true` in a field named for the question cannot.

***

### try\_instead?

> `readonly` `optional` **try\_instead?**: `string`

Defined in: [src/semantics/coverage/types.ts:406](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L406)

The author's sentence. A string, always — the typed tool rides its own
 key, so a reader of this one never has to narrow it.

***

### try\_instead\_tool?

> `readonly` `optional` **try\_instead\_tool?**: [`TryInsteadTool`](/docs/api/interfaces/TryInsteadTool)

Defined in: [src/semantics/coverage/types.ts:409](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L409)

The typed tool the suggestion points at (9.113.0), as declared — the
 author's words, `{ tool, why? }`. The model reads it as written.

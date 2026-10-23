---
title: ToolAbsence
---

# Interface: ToolAbsence

Defined in: [src/semantics/coverage/types.ts:365](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L365)

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

Defined in: [src/semantics/coverage/types.ts:366](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L366)

***

### cannot\_cover?

> `readonly` `optional` **cannot\_cover?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/semantics/coverage/types.ts:373](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L373)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/semantics/coverage/types.ts:371](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L371)

***

### known\_names?

> `readonly` `optional` **known\_names?**: [`KnownNames`](/docs/api/interfaces/KnownNames)

Defined in: [src/semantics/coverage/types.ts:391](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L391)

What the model may know of the list an `among` miss searched — the
 count, and the nearest names only for the caller. Model-only.

***

### looked\_for

> `readonly` **looked\_for**: `string`

Defined in: [src/semantics/coverage/types.ts:370](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L370)

***

### not\_checked?

> `readonly` `optional` **not\_checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/semantics/coverage/types.ts:372](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L372)

***

### note

> `readonly` **note**: `string`

Defined in: [src/semantics/coverage/types.ts:393](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L393)

The static sentence. Never interpolated — see `absent.ts`.

***

### outcome

> `readonly` **outcome**: `"nothing_found"`

Defined in: [src/semantics/coverage/types.ts:369](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L369)

The plain-English handle. Present so a model that skims one key still
 reads the outcome rather than inferring it from a missing field.

***

### period?

> `readonly` `optional` **period?**: `object`

Defined in: [src/semantics/coverage/types.ts:388](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L388)

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

Defined in: [src/semantics/coverage/types.ts:385](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L385)

Where the search looked and when that source was measured — the wire
 `describedResult()` mints (`measured_at`, `source`, …), honesty step 7b.

***

### retry\_returns\_the\_same

> `readonly` **retry\_returns\_the\_same**: `true`

Defined in: [src/semantics/coverage/types.ts:376](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L376)

Stated as data as well as prose — the note can be skimmed past, a
 `true` in a field named for the question cannot.

***

### try\_instead?

> `readonly` `optional` **try\_instead?**: `string`

Defined in: [src/semantics/coverage/types.ts:379](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L379)

The author's sentence. A string, always — the typed tool rides its own
 key, so a reader of this one never has to narrow it.

***

### try\_instead\_tool?

> `readonly` `optional` **try\_instead\_tool?**: [`TryInsteadTool`](/docs/api/interfaces/TryInsteadTool)

Defined in: [src/semantics/coverage/types.ts:382](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L382)

The typed tool the suggestion points at (9.113.0), as declared — the
 author's words, `{ tool, why? }`. The model reads it as written.

---
title: ToolAbsence
---

# Interface: ToolAbsence

Defined in: [src/core/agent/coverage/types.ts:261](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L261)

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

Defined in: [src/core/agent/coverage/types.ts:262](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L262)

***

### cannot\_cover?

> `readonly` `optional` **cannot\_cover?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:269](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L269)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:267](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L267)

***

### looked\_for

> `readonly` **looked\_for**: `string`

Defined in: [src/core/agent/coverage/types.ts:266](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L266)

***

### not\_checked?

> `readonly` `optional` **not\_checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:268](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L268)

***

### note

> `readonly` **note**: `string`

Defined in: [src/core/agent/coverage/types.ts:286](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L286)

The static sentence. Never interpolated — see `absent.ts`.

***

### outcome

> `readonly` **outcome**: `"nothing_found"`

Defined in: [src/core/agent/coverage/types.ts:265](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L265)

The plain-English handle. Present so a model that skims one key still
 reads the outcome rather than inferring it from a missing field.

***

### period?

> `readonly` `optional` **period?**: `object`

Defined in: [src/core/agent/coverage/types.ts:284](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L284)

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

Defined in: [src/core/agent/coverage/types.ts:281](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L281)

Where the search looked and when that source was measured — the wire
 `describedResult()` mints (`measured_at`, `source`, …), honesty step 7b.

***

### retry\_returns\_the\_same

> `readonly` **retry\_returns\_the\_same**: `true`

Defined in: [src/core/agent/coverage/types.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L272)

Stated as data as well as prose — the note can be skimmed past, a
 `true` in a field named for the question cannot.

***

### try\_instead?

> `readonly` `optional` **try\_instead?**: `string`

Defined in: [src/core/agent/coverage/types.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L275)

The author's sentence. A string, always — the typed tool rides its own
 key, so a reader of this one never has to narrow it.

***

### try\_instead\_tool?

> `readonly` `optional` **try\_instead\_tool?**: [`TryInsteadTool`](/docs/api/interfaces/TryInsteadTool)

Defined in: [src/core/agent/coverage/types.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L278)

The typed tool the suggestion points at (9.113.0), as declared — the
 author's words, `{ tool, why? }`. The model reads it as written.

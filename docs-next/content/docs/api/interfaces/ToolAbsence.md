---
title: ToolAbsence
---

# Interface: ToolAbsence

Defined in: [src/core/agent/coverage/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L175)

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

Defined in: [src/core/agent/coverage/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L176)

***

### cannot\_cover?

> `readonly` `optional` **cannot\_cover?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L183)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L181)

***

### looked\_for

> `readonly` **looked\_for**: `string`

Defined in: [src/core/agent/coverage/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L180)

***

### not\_checked?

> `readonly` `optional` **not\_checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L182)

***

### note

> `readonly` **note**: `string`

Defined in: [src/core/agent/coverage/types.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L194)

The static sentence. Never interpolated — see `absent.ts`.

***

### outcome

> `readonly` **outcome**: `"nothing_found"`

Defined in: [src/core/agent/coverage/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L179)

The plain-English handle. Present so a model that skims one key still
 reads the outcome rather than inferring it from a missing field.

***

### retry\_returns\_the\_same

> `readonly` **retry\_returns\_the\_same**: `true`

Defined in: [src/core/agent/coverage/types.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L186)

Stated as data as well as prose — the note can be skimmed past, a
 `true` in a field named for the question cannot.

***

### try\_instead?

> `readonly` `optional` **try\_instead?**: `string`

Defined in: [src/core/agent/coverage/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L189)

The author's sentence. A string, always — the typed tool rides its own
 key, so a reader of this one never has to narrow it.

***

### try\_instead\_tool?

> `readonly` `optional` **try\_instead\_tool?**: [`TryInsteadTool`](/docs/api/interfaces/TryInsteadTool)

Defined in: [src/core/agent/coverage/types.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L192)

The typed tool the suggestion points at (9.113.0), as declared — the
 author's words, `{ tool, why? }`. The model reads it as written.

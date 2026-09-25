[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolAbsence

# Interface: ToolAbsence

Defined in: [src/core/agent/coverage/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L144)

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

Defined in: [src/core/agent/coverage/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L145)

***

### cannot\_cover?

> `readonly` `optional` **cannot\_cover?**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/coverage/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L152)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/coverage/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L150)

***

### looked\_for

> `readonly` **looked\_for**: `string`

Defined in: [src/core/agent/coverage/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L149)

***

### not\_checked?

> `readonly` `optional` **not\_checked?**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/coverage/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L151)

***

### note

> `readonly` **note**: `string`

Defined in: [src/core/agent/coverage/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L163)

The static sentence. Never interpolated — see `absent.ts`.

***

### outcome

> `readonly` **outcome**: `"nothing_found"`

Defined in: [src/core/agent/coverage/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L148)

The plain-English handle. Present so a model that skims one key still
 reads the outcome rather than inferring it from a missing field.

***

### retry\_returns\_the\_same

> `readonly` **retry\_returns\_the\_same**: `true`

Defined in: [src/core/agent/coverage/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L155)

Stated as data as well as prose — the note can be skimmed past, a
 `true` in a field named for the question cannot.

***

### try\_instead?

> `readonly` `optional` **try\_instead?**: `string`

Defined in: [src/core/agent/coverage/types.ts:158](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L158)

The author's sentence. A string, always — the typed tool rides its own
 key, so a reader of this one never has to narrow it.

***

### try\_instead\_tool?

> `readonly` `optional` **try\_instead\_tool?**: [`TryInsteadTool`](/agentfootprint/api/generated/interfaces/TryInsteadTool.md)

Defined in: [src/core/agent/coverage/types.ts:161](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/coverage/types.ts#L161)

The typed tool the suggestion points at (9.113.0), as declared — the
 author's words, `{ tool, why? }`. The model reads it as written.

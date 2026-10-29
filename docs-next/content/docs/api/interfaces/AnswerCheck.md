---
title: AnswerCheck
---

# Interface: AnswerCheck

Defined in: [src/answer-validation/types.ts:6](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L6)

One named obligation. Only checked-pass/checked-fail count as checks run.

## Properties

### disposition

> `readonly` **disposition**: `Disposition`

Defined in: [src/answer-validation/types.ts:8](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L8)

***

### evidenceRefs?

> `readonly` `optional` **evidenceRefs?**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:13](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L13)

Must have resolved through this validation's artifact capability.

***

### id

> `readonly` **id**: `string`

Defined in: [src/answer-validation/types.ts:7](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L7)

***

### path?

> `readonly` `optional` **path?**: `string`

Defined in: [src/answer-validation/types.ts:11](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L11)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:10](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L10)

Short diagnostic data, never interpreted as an instruction.

***

### tools?

> `readonly` `optional` **tools?**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:23](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L23)

The registered names of the tools a LIBRARY row is about: present only on a
`.negativeClaims()` row (`agent:negative-claims:…`) that names one, beside its
code in `reason` — the tools whose reads a typed negative cited, or the tool
whose refusal said more than it read (`reason: 'declaration-overclaimed'`;
the answer's standing rests on that tool's calls). Names only, never a value.
An app validator's row never carries it: its rows are read as `id`,
`disposition`, `reason`, `path` and `evidenceRefs` only.

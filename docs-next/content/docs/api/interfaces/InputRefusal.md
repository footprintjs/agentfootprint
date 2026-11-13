---
title: InputRefusal
---

# Interface: InputRefusal

Defined in: [src/tools/inputRequest.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/inputRequest.ts#L89)

An app's refusal of the previous answer to the same ask — see `InputRequestDeclaration.refused`.

## Properties

### answer?

> `readonly` `optional` **answer?**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/tools/inputRequest.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/inputRequest.ts#L91)

The refused values, field id → value, as the person gave them.

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/tools/inputRequest.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/inputRequest.ts#L93)

Why it was refused, in the app's own words — or, for a time field the library checked, its catalog's (non-blank, at most 4096 characters).

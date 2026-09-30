---
title: InputRefusal
---

# Interface: InputRefusal

Defined in: [src/core/inputRequest.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L88)

An app's refusal of the previous answer to the same ask — see `InputRequestDeclaration.refused`.

## Properties

### answer?

> `readonly` `optional` **answer?**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/core/inputRequest.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L90)

The refused values, field id → value, as the person gave them.

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/inputRequest.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L92)

Why it was refused, in the app's own words — or, for a time field the library checked, its catalog's (non-blank, at most 4096 characters).

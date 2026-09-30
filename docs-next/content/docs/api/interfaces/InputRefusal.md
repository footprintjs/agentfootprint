---
title: InputRefusal
---

# Interface: InputRefusal

Defined in: src/core/inputRequest.ts:51

An app's refusal of the previous answer to the same ask — see `InputRequestDeclaration.refused`.

## Properties

### answer?

> `readonly` `optional` **answer?**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: src/core/inputRequest.ts:53

The refused values, field id → value, as the person gave them.

***

### reason

> `readonly` **reason**: `string`

Defined in: src/core/inputRequest.ts:55

Why it was refused, in the app's own words (non-blank, at most 4096 characters).
